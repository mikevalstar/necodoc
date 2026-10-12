import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { freePort, root, startStack } from "@necodoc/bench/stack";

// Spec: docs/features/demo-data-and-screenshots.md (Where it runs). The demo instance: the
// benchmark's private Postgres cluster, kept in .demo/ between runs, or DEMO_DATABASE_URL; an API,
// workers and optionally the app's dev server, all on unused ports.

export const demoDir = process.env.DEMO_DIR ?? join(root, ".demo");
/** What Admin › System shows as the output directory: a link into .demo/, not a home path. */
const OUTPUTS = "/var/tmp/necodoc-demo/outputs";
/** Preferred so the API reference's server URL is the same every run. */
const APP_PORT = 5190;

/** Pod-style host names, so no screen shows the machine it ran on. */
const hostnames: Record<string, string> = {
  api: "necodoc-api-6f9c7d-q4zrt",
  "worker-2-1": "necodoc-worker-7d9f4c-x2k8p",
  "worker-2-2": "necodoc-worker-7d9f4c-m7wn3",
};

/** Kept between runs so a reseed and a later capture agree on signed links. */
function secret() {
  const path = join(demoDir, "secret");
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("hex"));
  return readFileSync(path, "utf8").trim();
}

/** The private cluster's output directory, emptied with its database on a reset. */
function outputs(reset: boolean) {
  const target = join(demoDir, "outputs");
  if (reset) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  mkdirSync(dirname(OUTPUTS), { recursive: true });
  rmSync(OUTPUTS, { force: true });
  symlinkSync(target, OUTPUTS);
  return OUTPUTS;
}

/**
 * Storage settings and secrets from the environment, for DEMO_DATABASE_URL deployments: what the
 * seed writes must work for the live instance (the public demo's nightly reset, ADR 0045).
 */
const passThrough = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        /^(STORAGE_|S3_|AZURE_|BETTER_AUTH_SECRET$|DOWNLOAD_SIGNING_SECRET$)/.test(entry[0]) &&
        entry[1] !== undefined,
    ),
  );

/**
 * Refuses the dev database, wherever DEMO_DATABASE_URL came from. On the public demo's host
 * apps/api/.env is the demo's own, and says so with DEMO_MODE.
 */
function checkTarget(url: string | undefined) {
  if (!url) return;
  const envFile = join(root, "apps/api/.env");
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  if (/^DEMO_MODE=["']?(true|1|yes|on)["']?\s*$/im.test(text)) return;
  const dev = text.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  const norm = (u: string) => {
    const parsed = new URL(u);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  };
  if (dev && norm(dev) === norm(url)) {
    throw new Error("DEMO_DATABASE_URL is the dev database in apps/api/.env; refusing to reset it");
  }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>;

export async function startDemo(options: { app: boolean; workers?: number; reset?: boolean }) {
  mkdirSync(demoDir, { recursive: true });
  const databaseUrl = process.env.DEMO_DATABASE_URL;
  checkTarget(databaseUrl);
  const appPort = options.app ? await preferredPort(APP_PORT) : 0;
  const appUrl = `http://localhost:${appPort}`;
  const version = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const stack = await startStack({
    concurrency: 2,
    logDir: join(demoDir, "logs"),
    database: "necodoc_demo",
    reset: options.reset ?? true,
    ...(databaseUrl ? { databaseUrl } : { dataDir: demoDir }),
    env: {
      BETTER_AUTH_SECRET: secret(),
      ...(options.app ? { BETTER_AUTH_URL: appUrl } : {}),
      STORAGE_DRIVER: "disk",
      STORAGE_DIR: databaseUrl ? join(demoDir, "outputs") : outputs(options.reset ?? true),
      ...(databaseUrl ? passThrough() : {}),
      APP_VERSION: version,
      INSTANCE_NAME: "Harbour Surety",
      INSTANCE_ENV: "prod",
      // Audit entries take the office address the seed sends in X-Forwarded-For.
      TRUST_PROXY: "true",
      // AI shows as configured so its buttons are in the screenshots; nothing calls it.
      ANTHROPIC_KEY: "demo-placeholder-not-a-key",
    },
    perProcess: (name) => ({
      env: { DEMO_HOSTNAME: hostnames[name] ?? `necodoc-${name}` },
      nodeArgs: ["--import", join(import.meta.dirname, "hostname.ts")],
    }),
  });
  try {
    await stack.setWorkers(options.workers ?? 2);
    if (options.app) {
      await stack.spawn(
        "app",
        "pnpm",
        ["exec", "vite", "--port", String(appPort), "--strictPort"],
        {
          cwd: join(root, "apps/app"),
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? "",
            API_PROXY: stack.apiUrl,
          },
          port: appPort,
          url: `${appUrl}/login`,
        },
      );
    }
  } catch (error) {
    await stack.teardown(true);
    throw error;
  }
  return { ...stack, appUrl: options.app ? appUrl : stack.apiUrl };
}

async function preferredPort(port: number) {
  const free = await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  return free ? port : freePort();
}
