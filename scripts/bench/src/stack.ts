import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

// Spec: docs/features/performance-benchmark.md (isolated stack). A private Postgres cluster in a
// temp directory, one ROLE=api process and ROLE=worker processes, all on unused ports. Never the
// dev database or :3000. The demo seed (docs/features/demo-data-and-screenshots.md) reuses it with
// a cluster kept between runs, or a database it's given.

export const BENCH_DB = "necodoc_bench";

export const root = join(import.meta.dirname, "../../..");
const apiDir = join(root, "apps/api");

/**
 * Each API or worker process can open about 20 Postgres connections (its own pool plus
 * pg-boss's), so 8 workers outgrow a default server's 100. The private cluster gets room.
 */
const MAX_CONNECTIONS = 400;

/** A port the OS says is free right now (and never the dev server's). */
export async function freePort(): Promise<number> {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
  return port === 3000 ? freePort() : port;
}

type Proc = { name: string; port: number; child: ChildProcess; exited: Promise<void> };
type Role = "api" | "worker";

export type StackOptions = {
  concurrency: number;
  logDir?: string;
  /** Postgres database name in the private cluster. */
  database?: string;
  /** Keep the private cluster here between runs instead of in a temp directory. */
  dataDir?: string;
  /** Use this database instead of a private cluster. Its schemas are dropped first. */
  databaseUrl?: string;
  /** Start from an empty database (default). False keeps what's there (the demo's --no-seed). */
  reset?: boolean;
  /** Extra environment for every API and worker process (wins over the defaults). */
  env?: Record<string, string>;
  /** Extra environment and node flags per process, by name. */
  perProcess?: (name: string, role: Role) => { env?: Record<string, string>; nodeArgs?: string[] };
};

export type Stack = Awaited<ReturnType<typeof startStack>>;

export async function startStack(options: StackOptions) {
  // The same Postgres build as the local server (`pg_config` on PATH, or PG_BINDIR).
  const pg = (tool: string) => {
    const bindir =
      process.env.PG_BINDIR ?? execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
    return join(bindir, tool);
  };

  const persistent = options.dataDir !== undefined;
  const workDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "necodoc-bench-"));
  mkdirSync(workDir, { recursive: true });
  const logDir = options.logDir ?? workDir;
  mkdirSync(logDir, { recursive: true });
  const pgData = join(workDir, "pg");
  const pgPort = options.databaseUrl ? 0 : await freePort();
  const database = options.database ?? BENCH_DB;
  const databaseUrl = options.databaseUrl ?? `postgres://bench@localhost:${pgPort}/${database}`;
  const apiPort = await freePort();
  const apiUrl = `http://localhost:${apiPort}`;
  const baseEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    BETTER_AUTH_URL: apiUrl,
    STORAGE_DRIVER: "disk",
    STORAGE_DIR: join(workDir, "files"),
    RENDER_CONCURRENCY: String(options.concurrency),
    LOG_FORMAT: "json",
    LOG_LEVEL: "warn",
    APP_VERSION: "bench",
    ...options.env,
  };

  const procs = new Set<Proc>();
  const workers: Proc[] = [];

  /** Any process the stack stops at teardown, in its own process group. */
  function spawnTracked(
    name: string,
    port: number,
    command: string,
    args: string[],
    spawnOptions: { cwd: string; env: Record<string, string> },
  ): Proc {
    const log = openSync(join(logDir, `${name}.log`), "a");
    // Its own process group, so a signal to the group reaches Chromium too.
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ["ignore", log, log],
      detached: true,
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const proc = { name, port, child, exited };
    procs.add(proc);
    void exited.then(() => procs.delete(proc));
    return proc;
  }

  function spawnApi(name: string, role: Role, port: number): Proc {
    const extra = options.perProcess?.(name, role) ?? {};
    // One node process (tsx as a loader, not its CLI wrapper).
    return spawnTracked(
      name,
      port,
      process.execPath,
      ["--import", "tsx", ...(extra.nodeArgs ?? []), "src/index.ts"],
      { cwd: apiDir, env: { ...baseEnv, ...extra.env, ROLE: role, PORT: String(port) } },
    );
  }

  async function waitFor(proc: Proc, url: string, ready: (res: Response) => Promise<boolean>) {
    const timeoutMs = 90_000;
    const deadline = Date.now() + timeoutMs;
    let dead = false;
    void proc.exited.then(() => {
      dead = true;
    });
    while (Date.now() < deadline) {
      if (dead) throw new Error(`${proc.name} exited; see ${join(logDir, `${proc.name}.log`)}`);
      try {
        if (await ready(await fetch(url))) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${proc.name} not ready after ${timeoutMs} ms`);
  }

  const waitReady = (proc: Proc) =>
    waitFor(
      proc,
      `http://localhost:${proc.port}/api/health/ready`,
      async (res) => res.ok && ((await res.json()) as { ready?: boolean }).ready === true,
    );

  async function stop(proc: Proc) {
    const pid = proc.child.pid;
    if (pid === undefined || proc.child.exitCode !== null) return;
    const signal = (s: NodeJS.Signals) => {
      try {
        process.kill(-pid, s);
      } catch {
        // Already gone.
      }
    };
    signal("SIGTERM");
    const killed = await Promise.race([
      proc.exited.then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), 20_000)),
    ]);
    // The group may still hold Chromium after node exits.
    signal(killed ? "SIGKILL" : "SIGTERM");
    if (killed) await proc.exited;
  }

  /** Stops every worker, then starts `count` fresh ones and waits for each to be ready. */
  async function setWorkers(count: number) {
    await Promise.all(workers.splice(0).map(stop));
    const started = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const proc = spawnApi(`worker-${count}-${i + 1}`, "worker", await freePort());
        await waitReady(proc);
        return proc;
      }),
    );
    workers.push(...started);
  }

  /** Starts one more worker and returns how long it took to be ready. */
  async function restartSingleWorker() {
    await Promise.all(workers.splice(0).map(stop));
    const begun = performance.now();
    const proc = spawnApi(`worker-cold-${Date.now()}`, "worker", await freePort());
    await waitReady(proc);
    workers.push(proc);
    return performance.now() - begun;
  }

  let pgStarted = false;
  let torn = false;
  async function teardown(failed = false) {
    if (torn) return;
    torn = true;
    await Promise.all([...procs].map(stop));
    if (pgStarted) {
      try {
        execFileSync(pg("pg_ctl"), ["-D", pgData, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
      } catch (error) {
        console.error("stopping the private Postgres failed:", error);
      }
    }
    if (persistent || options.databaseUrl) return;
    rmSync(pgData, { recursive: true, force: true });
    rmSync(join(workDir, "files"), { recursive: true, force: true });
    const keepLogs = failed && !options.logDir;
    if (keepLogs) console.error(`process logs kept in ${logDir}`);
    else rmSync(workDir, { recursive: true, force: true });
  }

  const psql = (sqlText: string, dbName: string) =>
    execFileSync(
      pg("psql"),
      ["-h", "localhost", "-p", String(pgPort), "-U", "bench", "-v", "ON_ERROR_STOP=1"],
      {
        input: sqlText,
        env: { ...process.env, PGDATABASE: dbName },
        stdio: ["pipe", "ignore", "inherit"],
      },
    );

  try {
    const reset = options.reset ?? true;
    if (options.databaseUrl && !reset) {
      // Kept as it is; migrations below are idempotent.
    } else if (options.databaseUrl) {
      // Someone else's database: start from nothing inside it.
      const target = postgres(options.databaseUrl, { max: 1, onnotice: () => {} });
      await target.unsafe(
        "drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public;",
      );
      await target.end();
    } else {
      if (!existsSync(join(pgData, "PG_VERSION"))) {
        rmSync(pgData, { recursive: true, force: true });
        execFileSync(
          pg("initdb"),
          ["-D", pgData, "-U", "bench", "--auth=trust", "-E", "UTF8", "--no-instructions"],
          { stdio: "ignore" },
        );
      }
      if (existsSync(join(pgData, "postmaster.pid"))) {
        // Left running by a run that was killed.
        try {
          execFileSync(pg("pg_ctl"), ["-D", pgData, "-m", "immediate", "-w", "stop"], {
            stdio: "ignore",
          });
        } catch {
          // Not running after all; the stale pid file doesn't stop a start.
        }
      }
      const settings = [
        `-p ${pgPort}`,
        "-c listen_addresses=localhost",
        "-c unix_socket_directories=''",
        `-c max_connections=${MAX_CONNECTIONS}`,
        // Better Auth's tables use timestamp without time zone; UTC keeps now() and app writes alike.
        "-c timezone=UTC",
      ].join(" ");
      execFileSync(
        pg("pg_ctl"),
        ["-D", pgData, "-o", settings, "-l", join(logDir, "postgres.log"), "-w", "start"],
        { stdio: "ignore" },
      );
      pgStarted = true;
      if (reset) {
        psql(
          `drop database if exists ${database} with (force); create database ${database};`,
          "postgres",
        );
      }
    }
    execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
      cwd: apiDir,
      env: { ...baseEnv, ROLE: "api" },
      stdio: ["ignore", "ignore", "inherit"],
    });
    const api = spawnApi("api", "api", apiPort);
    await waitReady(api);
  } catch (error) {
    await teardown(true);
    throw error;
  }

  const db = postgres(databaseUrl, { max: 2, onnotice: () => {} });
  const postgresVersion = (await db<{ v: string }[]>`select version() as v`)[0]?.v ?? "unknown";

  return {
    apiUrl,
    databaseUrl,
    db,
    postgresVersion,
    setWorkers,
    restartSingleWorker,
    /** Starts another process (the app's dev server) and waits until `url` answers. */
    async spawn(
      name: string,
      command: string,
      args: string[],
      spawnOptions: { cwd: string; env: Record<string, string>; port: number; url: string },
    ) {
      const proc = spawnTracked(name, spawnOptions.port, command, args, spawnOptions);
      await waitFor(proc, spawnOptions.url, async (res) => res.ok);
    },
    get workerCount() {
      return workers.length;
    },
    async teardown(failed = false) {
      await db.end().catch(() => {});
      await teardown(failed);
    },
  };
}
