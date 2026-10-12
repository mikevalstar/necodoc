import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, release, totalmem, type } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import {
  type ApiScope,
  apiScopeSchema,
  type BatchSummary,
  type CreateTemplateInput,
  type PdfSource,
  type RenderTimings,
} from "@necodoc/shared";
import { markdown, stats } from "./report";
import {
  acroformOverlay,
  archivalInvoiceRender,
  bondRow,
  designedBondTemplate,
  FIXTURES,
  flatOverlay,
  invoiceRender,
  overlayRow,
  simpleRender,
} from "./scenarios";
import {
  type Latency,
  type Results,
  resultsSchema,
  SCHEMA_VERSION,
  type Throughput,
} from "./schema";
import { root, type Stack, startStack } from "./stack";

// Spec: docs/features/performance-benchmark.md. `pnpm bench --help` for the flags.

const { values: flags } = parseArgs({
  options: {
    samples: { type: "string", default: "100" },
    warmup: { type: "string", default: "10" },
    rows: { type: "string", default: "1000" },
    workers: { type: "string", default: "1,2,4" },
    concurrency: { type: "string", default: "2" },
    cold: { type: "string", default: "5" },
    "skip-archival": { type: "boolean", default: false },
    quick: { type: "boolean", default: false },
    "keep-logs": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  // pnpm passes a lone `--` through.
  args: process.argv.slice(2).filter((a) => a !== "--"),
});

if (flags.help) {
  console.log(`pnpm bench [flags]

  --samples N        measured requests per latency scenario (default 100)
  --warmup N         unmeasured requests before each scenario (default 10)
  --rows N           rows per throughput batch (default 1000)
  --workers LIST     worker counts for throughput (default 1,2,4)
  --concurrency N    RENDER_CONCURRENCY per worker (default 2)
  --cold N           cold worker starts to measure (default 5)
  --skip-archival    skip the PDF/A + PDF/UA scenario
  --quick            tiny smoke run (results marked not for publishing)
  --keep-logs        keep process logs in scripts/bench/results/logs

Postgres runs as a private cluster in a temp directory, from the binaries pg_config names
(or PG_BINDIR).`);
  process.exit(0);
}

const int = (v: string | undefined, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};
const quick = flags.quick;
const settings = {
  samples: quick ? 5 : int(flags.samples, "samples"),
  warmup: quick ? 2 : int(flags.warmup, "warmup"),
  batchRows: quick ? 40 : Math.max(1, int(flags.rows, "rows")),
  workerCounts: (quick ? "1,2" : (flags.workers ?? ""))
    .split(",")
    .map((w) => Math.max(1, int(w, "workers"))),
  concurrency: Math.max(1, int(flags.concurrency, "concurrency")),
  coldStarts: quick ? 1 : Math.max(1, int(flags.cold, "cold")),
  latencyWorkers: 1,
};

const resultsDir = join(root, "scripts/bench/results");
const log = (message: string) =>
  console.log(`[bench ${new Date().toISOString().slice(11, 19)}] ${message}`);

// ---------------------------------------------------------------------------------------------
// HTTP

class HttpError extends Error {}

/** 202 means a render outlived its wait: a failure for latency, expected for a batch. */
async function ok(res: Response, what: string, accepted = false) {
  if (res.ok && (accepted || res.status !== 202)) return res;
  throw new HttpError(`${what}: ${res.status} ${await res.text()}`);
}

/** The app's own routes, as the signed-in admin (seeding only). */
function appClient(apiUrl: string, cookie: string) {
  return async <T>(
    path: string,
    init: { method?: string; json?: unknown; form?: FormData } = {},
  ) => {
    const res = await fetch(`${apiUrl}/api${path}`, {
      method: init.method ?? (init.json || init.form ? "POST" : "GET"),
      headers: {
        cookie,
        origin: apiUrl,
        ...(init.json ? { "content-type": "application/json" } : {}),
      },
      body: init.form ?? (init.json ? JSON.stringify(init.json) : undefined),
    });
    return (await (await ok(res, path)).json()) as T;
  };
}

type Seeded = {
  key: string;
  templates: { bond: string; acroform: string; flat: string };
};

async function seed(stack: Stack): Promise<Seeded> {
  const signUp = await fetch(`${stack.apiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: stack.apiUrl },
    body: JSON.stringify({
      email: "bench@example.com",
      password: "bench-password-1234",
      name: "Bench",
    }),
  });
  await ok(signUp, "sign-up");
  const cookie = signUp.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const app = appClient(stack.apiUrl, cookie);

  const upload = async (path: string) => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([readFileSync(join(root, path))], { type: "application/pdf" }),
      basename(path),
    );
    return app<PdfSource>("/pdf-sources", { form });
  };
  const publish = async (body: CreateTemplateInput) => {
    const { id } = await app<{ id: string }>("/templates", { json: body });
    await app(`/templates/${id}/publish`, { json: { note: "bench" } });
    return id;
  };

  const acroSource = await upload(FIXTURES.acroform);
  const flatSource = await upload(FIXTURES.flat);
  const templates = {
    bond: await publish(designedBondTemplate),
    acroform: await publish(acroformOverlay(acroSource.id, acroSource.fields)),
    flat: await publish(flatOverlay(flatSource.id, flatSource.pages)),
  };
  const scopes: ApiScope[] = apiScopeSchema.options;
  const { key } = await app<{ key: string }>("/api-keys", {
    json: { name: "bench", scopes, rateLimitPerHour: 360_000 },
  });
  return { key, templates };
}

// ---------------------------------------------------------------------------------------------
// Measuring

type GenerationRow = {
  id: string;
  queueWaitMs: number | null;
  durationMs: number | null;
  totalMs: number | null;
  timings: RenderTimings | null;
  pageCount: number | null;
};

async function generationRows(stack: Stack, ids: string[]) {
  return stack.db<GenerationRow[]>`
    select id, queue_wait_ms as "queueWaitMs", duration_ms as "durationMs", total_ms as "totalMs",
      timings, page_count as "pageCount"
    from generation where id = any(${ids}::uuid[])`;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const present = (values: (number | null)[]) => values.filter((v): v is number => v !== null);

/** Sequential requests: `warmup` unmeasured, then `samples` measured. */
async function latency(
  stack: Stack,
  scenario: { id: string; label: string },
  call: (i: number) => Promise<Response>,
): Promise<Latency> {
  const roundTrips: number[] = [];
  const ids: string[] = [];
  for (let i = 0; i < settings.warmup + settings.samples; i++) {
    const started = performance.now();
    const res = await ok(await call(i), scenario.id);
    await res.arrayBuffer();
    const elapsed = performance.now() - started;
    if (i < settings.warmup) continue;
    roundTrips.push(elapsed);
    const id = res.headers.get("x-generation-id");
    if (id) ids.push(id);
  }
  const rows = await generationRows(stack, ids);
  const timings = rows.flatMap((r) => (r.timings ? [r.timings] : []));
  const result: Latency = {
    ...scenario,
    pages: rows[0]?.pageCount ?? 0,
    warmup: settings.warmup,
    roundTrip: stats(roundTrips),
    queueWait: stats(present(rows.map((r) => r.queueWaitMs))),
    run: stats(present(rows.map((r) => r.durationMs))),
    total: stats(present(rows.map((r) => r.totalMs))),
    breakdown: {
      liquidMs: mean(timings.map((t) => t.liquidMs)),
      chromiumMs: mean(timings.map((t) => t.chromiumMs)),
      bandsMs: mean(timings.map((t) => t.bandsMs)),
      stampMs: mean(timings.map((t) => t.stampMs)),
      finishMs: mean(timings.map((t) => t.finishMs ?? 0)),
    },
  };
  log(
    `${scenario.label}: p50 ${result.roundTrip.p50} ms, p95 ${result.roundTrip.p95} ms (${result.pages} pages, n=${result.roundTrip.n})`,
  );
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One batch from start to its last row; the throughput is the server's own clock. */
async function runBatch(v1: V1, templateId: string, rows: number) {
  const res = await ok(
    await v1(`/templates/${templateId}/versions/latest/batch`, {
      rows: Array.from({ length: rows }, (_, i) => bondRow(i)),
      filename: "bond",
    }),
    "batch",
    true,
  );
  const { id } = (await res.json()) as BatchSummary;
  for (;;) {
    await sleep(250);
    const summary = (await (
      await ok(await v1(`/batches/${id}`), "batch status")
    ).json()) as BatchSummary;
    if (summary.status !== "running") return { id, summary };
  }
}

type V1 = (path: string, json?: unknown) => Promise<Response>;

async function throughput(
  stack: Stack,
  v1: V1,
  templateId: string,
  workers: number,
): Promise<Throughput> {
  await stack.setWorkers(workers);
  // Every worker's Chromium up and warm before the clock starts.
  await runBatch(v1, templateId, workers * settings.concurrency * 3);
  const { id, summary } = await runBatch(v1, templateId, settings.batchRows);
  const wallMs =
    new Date(summary.finishedAt ?? Date.now()).getTime() - new Date(summary.createdAt).getTime();
  const rows = await stack.db<{ queueWaitMs: number | null; durationMs: number | null }[]>`
    select queue_wait_ms as "queueWaitMs", duration_ms as "durationMs"
    from generation where batch_id = ${id} and status = 'success'`;
  const result: Throughput = {
    workers,
    concurrency: settings.concurrency,
    rows: summary.total,
    failed: summary.failed,
    wallMs,
    docsPerMinute: Math.round((summary.done / (wallMs / 60_000)) * 10) / 10,
    queueWait: stats(present(rows.map((r) => r.queueWaitMs))),
    run: stats(present(rows.map((r) => r.durationMs))),
  };
  log(
    `${workers} worker(s): ${result.docsPerMinute} docs/min (${summary.done}/${summary.total} in ${(wallMs / 1000).toFixed(1)} s)`,
  );
  return result;
}

async function coldWarm(stack: Stack, v1: V1) {
  const cold: number[] = [];
  const warm: number[] = [];
  const workerStart: number[] = [];
  const render = async () => {
    const started = performance.now();
    await (await ok(await v1("/render", simpleRender), "render")).arrayBuffer();
    return performance.now() - started;
  };
  for (let i = 0; i < settings.coldStarts; i++) {
    workerStart.push(await stack.restartSingleWorker());
    cold.push(await render());
    for (let w = 0; w < 3; w++) await render();
    for (let w = 0; w < 5; w++) warm.push(await render());
  }
  const result = { cold: stats(cold), warm: stats(warm), workerStart: stats(workerStart) };
  log(`cold first render p50 ${result.cold.p50} ms vs warm p50 ${result.warm.p50} ms`);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Environment

function git(args: string[]) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function environment(postgresVersion: string): Results["environment"] {
  const browsers = JSON.parse(
    readFileSync(join(root, "apps/api/node_modules/playwright-core/browsers.json"), "utf8"),
  ) as { browsers: { name: string; browserVersion?: string }[] };
  const [l1 = 0, l5 = 0, l15 = 0] = loadAverage;
  return {
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    os:
      process.platform === "darwin"
        ? `macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()}`
        : `${type()} ${release()}`,
    node: process.version,
    chromium:
      browsers.browsers.find((b) => b.name === "chromium-headless-shell")?.browserVersion ??
      "unknown",
    postgres: postgresVersion,
    gitSha: git(["rev-parse", "HEAD"]) || "unknown",
    gitDirty: git(["status", "--porcelain"]) !== "",
    loadAverage: [l1, l5, l15].map((l) => Math.round(l * 100) / 100) as [number, number, number],
    storage: "disk (local temp directory)",
  };
}

// ---------------------------------------------------------------------------------------------

const loadAverage = loadavg();
const startedAt = new Date().toISOString();
log(`load average ${loadAverage.map((l) => l.toFixed(2)).join(" ")}; starting the bench stack`);
const logDir = flags["keep-logs"] ? join(resultsDir, "logs") : undefined;
if (logDir) mkdirSync(logDir, { recursive: true });
const stack = await startStack({ concurrency: settings.concurrency, logDir });
let interrupted = false;
const onSignal = () => {
  if (interrupted) return;
  interrupted = true;
  log("interrupted: tearing down");
  void stack.teardown().finally(() => process.exit(130));
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

try {
  const { key, templates } = await seed(stack);
  const v1: V1 = (path, json) =>
    fetch(`${stack.apiUrl}/api/v1${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: {
        "x-api-key": key,
        ...(json === undefined ? {} : { "content-type": "application/json" }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  const generate = (templateId: string, data: Record<string, unknown>) =>
    v1(`/templates/${templateId}/versions/latest/generate`, { data });
  log("seeded; starting latency runs");
  await stack.setWorkers(settings.latencyWorkers);

  const latencyResults = [
    await latency(stack, { id: "html-simple", label: "HTML to PDF, 1 page" }, () =>
      v1("/render", simpleRender),
    ),
    await latency(
      stack,
      { id: "html-invoice", label: "HTML to PDF, invoice with header/footer" },
      () => v1("/render", invoiceRender),
    ),
    await latency(stack, { id: "template-bond", label: "Designed template, surety bond" }, (i) =>
      generate(templates.bond, bondRow(i)),
    ),
    await latency(
      stack,
      { id: "overlay-acroform", label: "Overlay, AcroForm bond (Phoenix AZ)" },
      (i) => generate(templates.acroform, overlayRow(i)),
    ),
    await latency(stack, { id: "overlay-flat", label: "Overlay, flat bond (Rockville MD)" }, (i) =>
      generate(templates.flat, overlayRow(i)),
    ),
  ];

  let archival: Results["archival"] = null;
  if (!flags["skip-archival"]) {
    const archivalRun = await latency(
      stack,
      { id: "html-invoice-pdfa-pdfua", label: "Invoice, PDF/A-2b + PDF/UA" },
      () => v1("/render", archivalInvoiceRender),
    );
    const plain = latencyResults.find((l) => l.id === "html-invoice");
    if (plain) {
      archival = {
        plain,
        archival: archivalRun,
        overheadP50Ms: (archivalRun.roundTrip.p50 ?? 0) - (plain.roundTrip.p50 ?? 0),
      };
    }
  }

  log("cold vs warm Chromium");
  const coldWarmResult = await coldWarm(stack, v1);

  const throughputResults: Throughput[] = [];
  for (const workers of settings.workerCounts) {
    log(`throughput: ${settings.batchRows} rows on ${workers} worker(s)`);
    throughputResults.push(await throughput(stack, v1, templates.bond, workers));
  }

  const results = resultsSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    startedAt,
    finishedAt: new Date().toISOString(),
    quick,
    environment: environment(stack.postgresVersion),
    settings,
    latency: latencyResults,
    throughput: throughputResults,
    coldWarm: coldWarmResult,
    archival,
  } satisfies Results);

  mkdirSync(resultsDir, { recursive: true });
  const json = `${JSON.stringify(results, null, 2)}\n`;
  const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
  writeFileSync(join(resultsDir, `${stamp}${quick ? "-quick" : ""}.json`), json);
  writeFileSync(join(resultsDir, "latest.json"), json);
  writeFileSync(join(resultsDir, "latest.md"), markdown(results));
  log(`wrote ${join(resultsDir, "latest.json")} and latest.md`);
  log("tearing down");
  await stack.teardown();
} catch (error) {
  if (!interrupted) {
    log("failed: tearing down");
    await stack.teardown(true);
  }
  throw error;
}
