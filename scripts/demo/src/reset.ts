import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { resetFlagPath } from "@necodoc/api/demo-reset";
import { root } from "@necodoc/bench/stack";
import postgres from "postgres";

// Spec: docs/features/public-demo.md (Nightly reset), ADR 0045. `pnpm demo:reset` rebuilds a
// running public demo from the demo seed, in its own database and storage, behind the flag the
// API answers 503 from. The instance is never left down, whatever fails.

const apiDir = join(root, "apps/api");

/** Templates the site and the reel show; the reset says so loudly if one didn't come out. */
export const REQUIRED_TEMPLATES = [
  "Oregon Contractor License Bond",
  "OR CCB Commercial Surety Bond",
] as const;

export const log = (message: string) =>
  console.log(`[demo:reset ${new Date().toISOString()}] ${message}`);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type ResetSteps = {
  raiseFlag(): void;
  lowerFlag(): void;
  /** Stops the live worker (and anything else that would work the seed's jobs). */
  pause(): Promise<void>;
  /** Restarts the live API and worker on the new database. */
  resume(): Promise<void>;
  clearStorage(): Promise<void>;
  seed(): Promise<void>;
  /** What the seed should have made and didn't. */
  missing(): Promise<string[]>;
  /** An empty, migrated database; the API creates the demo user when it starts. */
  fallback(): Promise<void>;
};

/** The reset's order. True when everything worked; the flag is lowered and resume runs regardless. */
export async function runReset(steps: ResetSteps): Promise<boolean> {
  let ok = true;
  const failed = (step: string, error: unknown) => {
    ok = false;
    log(`!!! ${step} failed: ${message(error)}`);
  };
  steps.raiseFlag();
  log(`resetting flag raised (${resetFlagPath}); the API answers 503`);
  try {
    await steps.pause();
    await steps.clearStorage();
    try {
      await steps.seed();
      const missing = await steps.missing();
      if (missing.length) {
        ok = false;
        log(`!!! seeded, but missing: ${missing.join(", ")}`);
      } else log("seeded; the bond templates are there");
    } catch (error) {
      failed("seed", error);
      log("!!! falling back to an empty, migrated database with only the demo user");
      await steps.fallback();
      log("fallback done: the demo is up but EMPTY");
    }
  } catch (error) {
    failed("reset", error);
  } finally {
    try {
      await steps.resume();
    } catch (error) {
      failed("resume", error);
    }
    steps.lowerFlag();
    log("resetting flag lowered");
  }
  return ok;
}

/** Runs a host command (PM2 on the Beelink) with the caller's environment, not the env file's. */
function hostCommand(command: string, env: NodeJS.ProcessEnv) {
  log(`$ ${command}`);
  return new Promise<void>((done, fail) => {
    const child = spawn("sh", ["-c", command], { stdio: "inherit", env });
    child.once("error", fail);
    child.once("exit", (code) =>
      code === 0 ? done() : fail(new Error(`\`${command}\` exited with ${code}`)),
    );
  });
}

/** Empties the disk storage directory. Thumbnails live in the database. */
function clearDisk(dir: string) {
  const forbidden = [resolve("/"), homedir(), root, apiDir].map((p) => resolve(p));
  if (forbidden.includes(dir)) throw new Error(`refusing to empty ${dir}`);
  if (!existsSync(dir)) return log(`storage ${dir} doesn't exist yet`);
  const entries = readdirSync(dir);
  for (const entry of entries) rmSync(join(dir, entry), { recursive: true, force: true });
  log(`storage ${dir} emptied (${entries.length} entries)`);
}

const truthy = (value: string | undefined) => /^(true|1|yes|on)$/i.test(value?.trim() ?? "");

async function main() {
  const { values } = parseArgs({
    options: {
      // Not --env-file: tsx hands that to node.
      "instance-env": { type: "string" },
      pause: { type: "string" },
      resume: { type: "string" },
    },
  });
  const hostEnv = { ...process.env };
  // The instance's env file; relative to where pnpm was run. Variables already set win.
  const envFile = values["instance-env"];
  if (envFile) process.loadEnvFile(resolve(process.env.INIT_CWD ?? process.cwd(), envFile));
  const env = process.env;
  if (!truthy(env.DEMO_MODE)) {
    throw new Error("demo:reset only resets a public demo: DEMO_MODE=true must be in its env");
  }
  const databaseUrl = env.DEMO_DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) throw new Error("no DATABASE_URL (pass the instance's --instance-env)");
  // The seed's target; it refuses the dev database (instance.ts).
  env.DEMO_DATABASE_URL = databaseUrl;
  const driver = env.STORAGE_DRIVER?.trim() || "disk";
  const storageDir = resolve(apiDir, env.STORAGE_DIR?.trim() || "./data/files");
  const { host, pathname } = new URL(databaseUrl);
  log(`resetting ${host}${pathname}, storage ${driver === "disk" ? storageDir : driver}`);

  const begun = Date.now();
  const ok = await runReset({
    raiseFlag: () => writeFileSync(resetFlagPath, new Date().toISOString()),
    lowerFlag: () => rmSync(resetFlagPath, { force: true }),
    pause: async () => {
      if (values.pause) await hostCommand(values.pause, hostEnv);
      else log("no --pause command: make sure no live worker is running");
    },
    resume: async () => {
      if (values.resume) await hostCommand(values.resume, hostEnv);
      else log("no --resume command: restart the live API and worker yourself");
    },
    clearStorage: async () => {
      if (driver === "disk") clearDisk(storageDir);
      else log(`storage driver ${driver}: old outputs are left to retention`);
    },
    seed: async () => {
      const { resetAndSeed } = await import("./seed.ts");
      await resetAndSeed();
    },
    missing: async () => {
      const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        const rows = await sql<{ name: string }[]>`
          select name from template where name in ${sql([...REQUIRED_TEMPLATES])} and archived_at is null`;
        const found = new Set(rows.map((row) => row.name));
        return REQUIRED_TEMPLATES.filter((name) => !found.has(name));
      } finally {
        await sql.end();
      }
    },
    fallback: async () => {
      const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          "drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public;",
        );
      } finally {
        await sql.end();
      }
      execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
        cwd: apiDir,
        env: { ...env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      });
    },
  });
  log(`${ok ? "done" : "FAILED"} in ${Math.round((Date.now() - begun) / 1000)} s`);
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  await main().catch((error: unknown) => {
    log(`!!! ${message(error)}`);
    process.exitCode = 1;
  });
}
