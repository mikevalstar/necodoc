import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, openSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

// Spec: docs/features/performance-benchmark.md (isolated stack). A private Postgres cluster in a
// temp directory, one ROLE=api process and ROLE=worker processes, all on unused ports. Never the
// dev database or :3000.

export const BENCH_DB = "necodoc_bench";

export const root = join(import.meta.dirname, "../../..");
const apiDir = join(root, "apps/api");

/**
 * Each API or worker process can open about 20 Postgres connections (its own pool plus
 * pg-boss's), so 8 workers outgrow a default server's 100. The private cluster gets room.
 */
const MAX_CONNECTIONS = 400;

/** A port the OS says is free right now (and never the dev server's). */
async function freePort(): Promise<number> {
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

export type Stack = Awaited<ReturnType<typeof startStack>>;

export async function startStack(options: { concurrency: number; logDir?: string }) {
  // The same Postgres build as the local server (`pg_config` on PATH, or PG_BINDIR).
  const bindir =
    process.env.PG_BINDIR ?? execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  const pg = (tool: string) => join(bindir, tool);

  const workDir = mkdtempSync(join(tmpdir(), "necodoc-bench-"));
  const logDir = options.logDir ?? workDir;
  const pgData = join(workDir, "pg");
  const pgPort = await freePort();
  const benchUrl = `postgres://bench@localhost:${pgPort}/${BENCH_DB}`;
  const apiPort = await freePort();
  const apiUrl = `http://localhost:${apiPort}`;
  const baseEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    DATABASE_URL: benchUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    BETTER_AUTH_URL: apiUrl,
    STORAGE_DRIVER: "disk",
    STORAGE_DIR: join(workDir, "files"),
    RENDER_CONCURRENCY: String(options.concurrency),
    LOG_FORMAT: "json",
    LOG_LEVEL: "warn",
    APP_VERSION: "bench",
  };

  const procs = new Set<Proc>();
  const workers: Proc[] = [];

  function spawnApi(name: string, role: "api" | "worker", port: number): Proc {
    const log = openSync(join(logDir, `${name}.log`), "a");
    // One node process (tsx as a loader, not its CLI wrapper) in its own process group, so a
    // signal to the group reaches Chromium too.
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: apiDir,
      env: { ...baseEnv, ROLE: role, PORT: String(port) },
      stdio: ["ignore", log, log],
      detached: true,
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const proc = { name, port, child, exited };
    procs.add(proc);
    void exited.then(() => procs.delete(proc));
    return proc;
  }

  async function waitReady(proc: Proc, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let dead = false;
    void proc.exited.then(() => {
      dead = true;
    });
    while (Date.now() < deadline) {
      if (dead) throw new Error(`${proc.name} exited; see ${join(logDir, `${proc.name}.log`)}`);
      try {
        const res = await fetch(`http://localhost:${proc.port}/api/health/ready`);
        if (res.ok && ((await res.json()) as { ready?: boolean }).ready) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${proc.name} not ready after ${timeoutMs} ms`);
  }

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
        console.error("stopping the bench Postgres failed:", error);
      }
    }
    rmSync(pgData, { recursive: true, force: true });
    rmSync(join(workDir, "files"), { recursive: true, force: true });
    const keepLogs = failed && !options.logDir;
    if (keepLogs) console.error(`process logs kept in ${logDir}`);
    else rmSync(workDir, { recursive: true, force: true });
  }

  try {
    execFileSync(
      pg("initdb"),
      ["-D", pgData, "-U", "bench", "--auth=trust", "-E", "UTF8", "--no-instructions"],
      { stdio: "ignore" },
    );
    const settings = [
      `-p ${pgPort}`,
      "-c listen_addresses=localhost",
      "-c unix_socket_directories=''",
      `-c max_connections=${MAX_CONNECTIONS}`,
    ].join(" ");
    execFileSync(
      pg("pg_ctl"),
      ["-D", pgData, "-o", settings, "-l", join(logDir, "postgres.log"), "-w", "start"],
      { stdio: "ignore" },
    );
    pgStarted = true;
    execFileSync(pg("createdb"), [
      "-h",
      "localhost",
      "-p",
      String(pgPort),
      "-U",
      "bench",
      BENCH_DB,
    ]);
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

  const db = postgres(benchUrl, { max: 2, onnotice: () => {} });
  const postgresVersion = (await db<{ v: string }[]>`select version() as v`)[0]?.v ?? "unknown";

  return {
    apiUrl,
    db,
    postgresVersion,
    setWorkers,
    restartSingleWorker,
    get workerCount() {
      return workers.length;
    },
    async teardown(failed = false) {
      await db.end().catch(() => {});
      await teardown(failed);
    },
  };
}
