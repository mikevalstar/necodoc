import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type AssetLoader, closeBrowser } from "@necodoc/api/render/browser";
import { finishPdf } from "@necodoc/api/render/finish";
import { openPdfjs } from "@necodoc/api/render/pdfjs";
import { type RenderJob, renderPdf } from "@necodoc/api/render/render";
import { type Results, resultsSchema, type Stats } from "@necodoc/bench/schema";
import { ASSET_ORIGIN, type OutputOptions } from "@necodoc/shared";
import { marked } from "marked";
import { z } from "zod";

// Spec: docs/features/architecture-review-pack.md. Builds the review pack from pack.md, the
// site's controls list and the benchmark JSON, and renders it with necodoc's own renderer.
// `--release` refuses a dirty tree, an unpublishable benchmark run or a missing veraPDF.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const at = (path: string) => join(root, path);
const OUT = at("apps/web/public/review-pack/necodoc-architecture-review.pdf");
const release = process.argv.includes("--release");

const fail = (message: string): never => {
  console.error(`review-pack: ${message}`);
  process.exit(1);
};
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const hasVerapdf = (() => {
  try {
    execFileSync("verapdf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// ---- What the pack describes -------------------------------------------------------------

const version =
  readFileSync(at("deploy/helm/necodoc/Chart.yaml"), "utf8").match(
    /^appVersion:\s*"?([^"\n]+)"?/m,
  )?.[1] ?? fail("no appVersion in deploy/helm/necodoc/Chart.yaml");
const sha = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain") !== "";
const today = new Date().toISOString().slice(0, 10);
const specUrl = (path: string) =>
  `https://github.com/mikevalstar/necodoc/blob/${sha}/docs/${path}.md`;

const bench: Results = resultsSchema.parse(
  JSON.parse(readFileSync(at("scripts/bench/results/latest.json"), "utf8")),
);
const benchCaveat = bench.quick
  ? "This is a quick smoke run, not a full benchmark: don't quote these numbers."
  : bench.environment.gitDirty
    ? "This run was made on a tree with uncommitted changes. Rerun from a clean commit before quoting it."
    : null;

if (release) {
  if (dirty) fail("--release needs a clean tree, so the commit on the cover is what's described");
  if (benchCaveat) fail(`--release needs a publishable benchmark run: ${benchCaveat}`);
  if (!hasVerapdf) fail("--release needs veraPDF on PATH to validate PDF/A-2u and PDF/UA-1");
}

/**
 * The security page's controls list, read out of its frontmatter so the site, its CSV and this
 * pack share one list. The page passes `spec()` for proof links; here they point at this commit.
 */
function siteControls() {
  const page = readFileSync(at("apps/web/src/pages/security.astro"), "utf8");
  const start = page.indexOf("const controls");
  const open = page.indexOf("= [", start) + 2;
  const close = page.indexOf("\n];", open) + 2;
  if (start < 0 || open < 2 || close < 2)
    fail("couldn't find `const controls = [...]` in security.astro");
  const spec = (path: string) => specUrl(path);
  const value: unknown = new Function("spec", `return ${page.slice(open, close)};`)(spec);
  return z
    .array(
      z.object({
        group: z.string(),
        rows: z.array(
          z.object({
            control: z.string(),
            how: z.string(),
            proof: z.object({ label: z.string(), href: z.string() }),
          }),
        ),
      }),
    )
    .parse(value);
}

// ---- Generated parts ---------------------------------------------------------------------

const ms = (v: number | null) =>
  v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
const int = (v: number) => Math.round(v).toLocaleString("en-CA");
const table = (head: string[], rows: string[][], numeric = new Set<number>()) =>
  `<table class="keep"><thead><tr>${head.map((h, i) => `<th scope="col"${numeric.has(i) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td${numeric.has(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;

function controlsHtml() {
  const rows = siteControls().flatMap((g) => [
    `<tr class="group"><th colspan="3" scope="colgroup">${esc(g.group)}</th></tr>`,
    ...g.rows.map(
      (r) =>
        `<tr><td>${esc(r.control)}</td><td>${esc(r.how)}</td><td><a href="${esc(r.proof.href)}">${esc(r.proof.label)}</a></td></tr>`,
    ),
  ]);
  return `<table class="controls"><thead><tr><th scope="col" style="width:22%">Control</th><th scope="col">How necodoc does it</th><th scope="col" style="width:20%">Proof</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function benchHtml() {
  const env = bench.environment;
  const s = bench.settings;
  const latencyRow = (l: Results["latency"][number]) => [
    esc(l.label),
    String(l.pages),
    ms(l.roundTrip.p50),
    ms(l.roundTrip.p95),
    ms(l.run.p50),
  ];
  const scale = bench.throughput.map((t) => [
    String(t.workers),
    String(t.concurrency),
    int(t.rows),
    String(t.failed),
    `${(t.wallMs / 1000).toFixed(1)} s`,
    int(t.docsPerMinute),
  ]);
  const one = bench.throughput.find((t) => t.workers === 1);
  const best = bench.throughput.reduce((a, b) => (b.docsPerMinute > a.docsPerMinute ? b : a));
  const html = bench.latency.find((l) => l.id === "html-simple");
  const overlay = bench.latency.find((l) => l.id.startsWith("overlay"));
  const coldRow = (label: string, st: Stats) => [label, String(st.n), ms(st.p50), ms(st.p95)];
  const figure = (v: string, l: string) =>
    `<td><span class="v">${v}</span><span class="l">${l}</span></td>`;
  return [
    `<p>Measured by <code>pnpm bench</code> through the public API, from the run finished ${bench.finishedAt.slice(0, 10)} at commit <code>${env.gitSha.slice(0, 10)}</code>. Latency is the client's round trip, one request at a time. Rerun it on your own hardware with the same command.</p>`,
    benchCaveat ? `<p class="limit"><b>Caveat</b> ${benchCaveat}</p>` : "",
    `<table class="figures keep"><tbody><tr>${[
      html && figure(ms(html.roundTrip.p50), "p50, one-page HTML to PDF"),
      overlay && figure(ms(overlay.roundTrip.p50), "p50, overlay on an existing PDF form"),
      one && figure(int(one.docsPerMinute), "docs/min, 1 worker, batch"),
      figure(int(best.docsPerMinute), `docs/min, ${best.workers} workers on one machine`),
    ]
      .filter(Boolean)
      .join("")}</tr></tbody></table>`,
    "<h2>Latency</h2>",
    table(
      ["Scenario", "Pages", "p50", "p95", "Worker run p50"],
      bench.latency.map(latencyRow),
      new Set([1, 2, 3, 4]),
    ),
    bench.archival
      ? `<p>PDF/A-2b with PDF/UA on the invoice adds ${ms(bench.archival.overheadP50Ms)} at p50 (${ms(bench.archival.plain.roundTrip.p50)} to ${ms(bench.archival.archival.roundTrip.p50)}).</p>`
      : "",
    "<h2>Batch throughput</h2>",
    `<p>A JSON batch of ${int(s.batchRows)} designed surety bonds, timed from the batch's creation to its last row, so it includes the queue. All workers share one machine.</p>`,
    table(
      ["Workers", "Slots each", "Rows", "Failed", "Wall time", "Docs/min"],
      scale,
      new Set([0, 1, 2, 3, 4, 5]),
    ),
    "<h2>Cold start</h2>",
    table(
      ["Measure", "n", "p50", "p95"],
      [
        coldRow("Worker process start to ready", bench.coldWarm.workerStart),
        coldRow("First render on a new worker (launches Chromium)", bench.coldWarm.cold),
        coldRow("Warm render", bench.coldWarm.warm),
      ],
      new Set([1, 2, 3]),
    ),
    "<h2>Environment</h2>",
    table(
      ["Item", "Detail"],
      [
        ["Machine", esc(`${env.cpu}, ${env.cores} cores, ${env.memoryGb} GB, ${env.os}`)],
        [
          "Software",
          esc(`Node ${env.node}, Chromium ${env.chromium}, ${env.postgres.split(" on ")[0]}`),
        ],
        ["Storage", esc(env.storage)],
        [
          "Settings",
          esc(
            `${s.samples} samples after ${s.warmup} warm-up requests; RENDER_CONCURRENCY=${s.concurrency}; latency on ${s.latencyWorkers} worker`,
          ),
        ],
        ["Commit", esc(`${env.gitSha}${env.gitDirty ? " (uncommitted changes)" : ""}`)],
      ],
    ),
    `<p class="limit"><b>Caveats</b> Everything ran on one machine: Postgres with default settings, the disk storage driver, calls over loopback, so there's no network, TLS, proxy or object storage latency. The documents are representative insurance documents, not a worst case. Workers sharing one machine's CPU say little about scaling across nodes: past one worker this laptop's Chromium capacity is the ceiling, not the queue.</p>`,
    `<p class="sources"><span class="label">Specs</span> <a href="${specUrl("features/performance-benchmark")}">Performance benchmark</a></p>`,
  ].join("\n");
}

function diagramHtml() {
  // Inline, so the diagram's text uses the pack's fonts and stays selectable.
  // Chromium tags it as a Figure; its alt text comes from aria-label, not <title>/<desc>.
  const svg = readFileSync(at("apps/web/src/assets/reference-architecture.svg"), "utf8");
  const desc = svg.match(/<desc[^>]*>([^<]+)<\/desc>/)?.[1] ?? fail("the diagram has no <desc>");
  return `<div class="figure">${svg.replace(/aria-labelledby="[^"]*"/, `aria-label="Reference architecture. ${desc}"`)}</div>`;
}

// ---- The document ------------------------------------------------------------------------

type Section = { n: string; title: string; id: string };

function body(pageOf: Map<string, number> | null) {
  const sections: Section[] = [];
  const prose = (
    marked.parse(readFileSync(new URL("../pack.md", import.meta.url), "utf8"), {
      async: false,
    }) as string
  )
    .replace(/<!--\s*@(\w+)\s*-->/g, (_m, name: string) => {
      const part: Record<string, () => string> = {
        newpage: () => '<div class="newpage"></div>',
        diagram: diagramHtml,
        controls: controlsHtml,
        bench: benchHtml,
      };
      return part[name]?.() ?? fail(`unknown part @${name} in pack.md`);
    })
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/href="spec:([^"]+)"/g, (_m, path: string) => `href="${specUrl(path)}"`)
    .replace(
      /<p><a href="https:\/\/github\.com\/mikevalstar\/necodoc\/blob\//g,
      '<p class="sources"><span class="label">Specs</span> <a href="https://github.com/mikevalstar/necodoc/blob/',
    )

    .replace(/<h1>(.*?)<\/h1>/g, (_m, title: string) => {
      const n = String(sections.length + 1).padStart(2, "0");
      const id = `s${n}`;
      sections.push({ n, title, id });
      return `<h1 id="${id}"><span class="num">${n}</span>${title}</h1>`;
    });

  const mark = `<svg viewBox="0 0 64 64" role="img" aria-label="necodoc logo"><path fill="#2f6bff" fill-rule="evenodd" d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"/><path fill="#ffc53d" d="M36 47H40V53H36Z"/></svg>`;
  const meta = [
    ["Version", esc(version)],
    ["Commit", `<code>${sha.slice(0, 10)}</code>${dirty ? " with uncommitted changes" : ""}`],
    ["Generated", today],
    ["Benchmark run", bench.finishedAt.slice(0, 10)],
    ["Licence", "MIT"],
  ];
  const cover = `<div class="cover">
<div class="brand">${mark}<span>necodoc</span></div>
<p class="eyebrow">Architecture review pack</p>
<p class="title">Self-hosted document generation for insurers</p>
<p class="lede">How necodoc is built and deployed, where data goes, which controls it provides and where each one stops. For architecture and security review boards.</p>
<div class="foot"><table class="meta"><tbody>${meta.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>
<p class="made">This PDF was rendered by necodoc's own renderer from the repository at the commit above, as PDF/A-2u and tagged PDF/UA-1.</p></div>
</div>`;
  const toc = `<div class="newpage toc"><h1>Contents</h1><ol>${sections
    .map(
      (s) =>
        `<li><span class="n">${s.n}</span><a href="#${s.id}">${s.title}</a><span class="p">${pageOf?.get(s.id) ?? "00"}</span></li>`,
    )
    .join("")}</ol>
<p class="note">Each section ends with links to the specifications it summarises, at commit <code>${sha.slice(0, 10)}</code>. The specs carry intent and the full list of known limitations.</p></div>`;
  return { html: `${cover}${toc}<div class="newpage"></div>${prose}`, sections };
}

/** Fontsource faces for the site's typefaces, served from the asset origin. */
const fonts = new Map<string, string>();
const require = createRequire(import.meta.url);
const fontCss = (
  [
    [
      "@fontsource-variable/bricolage-grotesque",
      "Bricolage Grotesque Variable",
      "Bricolage Grotesque",
    ],
    ["@fontsource-variable/figtree", "Figtree Variable", "Figtree"],
    ["@fontsource/fragment-mono", "Fragment Mono", "Fragment Mono"],
  ] as const
)
  .map(([pkg, family, as]) => {
    const dir = dirname(require.resolve(`${pkg}/index.css`));
    return readFileSync(join(dir, "index.css"), "utf8")
      .replaceAll(`'${family}'`, `'${as}'`)
      .replace(/url\(\.\/files\/([\w.-]+)\)/g, (_m, file: string) => {
        fonts.set(`pack/fonts/${file}`, join(dir, "files", file));
        return `url(${ASSET_ORIGIN}/pack/fonts/${file})`;
      });
  })
  .join("\n");

const loadAsset: AssetLoader = async (path) => {
  const file = fonts.get(path);
  if (!file) return null;
  return {
    bytes: readFileSync(file),
    mimeType: path.endsWith(".woff") ? "font/woff" : "font/woff2",
  };
};

const output: OutputOptions = { pdfa: "2u", pdfua: true, certify: false, lang: "en-CA" };
const css = `${fontCss}\n${readFileSync(new URL("./pack.css", import.meta.url), "utf8")}`;
const band = (where: "top" | "bottom", left: string, right: string) =>
  `<div class="band ${where}"><span>${left}</span><span>${right}</span></div>`;

const job = (html: string): RenderJob => ({
  html,
  css,
  data: {},
  page: {
    size: "Letter",
    orientation: "portrait",
    margins: { top: 12, right: 20, bottom: 12, left: 20 },
  },
  header: {
    html: band(
      "top",
      "necodoc · Architecture review pack",
      `v${esc(version)} · ${sha.slice(0, 7)}`,
    ),
    firstPageHtml: "",
    height: 9,
  },
  footer: {
    html: band("bottom", `Generated ${today} · MIT licence`, "Page {{ page }} of {{ pages }}"),
    firstPageHtml: "",
    height: 9,
  },
  output,
});

/** Page number (1-based) of each top-level heading, from the PDF's outline. */
async function headingPages(pdf: Uint8Array, sections: Section[]) {
  const doc = await openPdfjs(pdf);
  const pages = new Map<string, number>();
  const norm = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  try {
    for (const item of (await doc.getOutline()) ?? []) {
      const title = norm(item.title);
      const section = sections.find(
        (s) => title === norm(`${s.n}${s.title}`) || title === norm(`${s.n} ${s.title}`),
      );
      if (!section) continue;
      const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
      const ref = dest?.[0];
      if (ref && typeof ref === "object") pages.set(section.id, (await doc.getPageIndex(ref)) + 1);
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  const missing = sections.filter((s) => !pages.has(s.id));
  if (missing.length) fail(`no outline entry for ${missing.map((s) => s.title).join(", ")}`);
  return pages;
}

function verapdf(file: string, flavour: string) {
  let report: string;
  try {
    report = execFileSync("verapdf", ["-f", flavour, file], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    report = String((error as { stdout?: string }).stdout ?? "");
  }
  const failed = [
    ...new Set(
      [...report.matchAll(/clause="([^"]+)" testNumber="(\d+)" status="failed"/g)].map(
        (m) => `${m[1]}-${m[2]}`,
      ),
    ),
  ];
  return { compliant: report.includes('isCompliant="true"'), failed };
}

try {
  // Pass 1 finds where each section lands; pass 2 prints the contents page with those numbers.
  const first = body(null);
  const draft = await renderPdf(job(first.html), loadAsset);
  const pageOf = await headingPages(draft.pdf, first.sections);
  const final = body(pageOf);
  const rendered = await renderPdf(job(final.html), loadAsset);
  if (rendered.pageCount !== draft.pageCount) fail("the contents page changed the page count");
  const check = await headingPages(rendered.pdf, final.sections);
  for (const [id, page] of pageOf)
    if (check.get(id) !== page) fail(`section ${id} moved to page ${check.get(id)}`);

  const finished = await finishPdf(rendered.pdf, {
    output,
    tagged: true,
    title: `necodoc architecture review pack ${version}`,
    preview: true,
    certifier: () => Promise.reject(new Error("The review pack isn't certified")),
  });
  for (const w of finished.warnings) console.warn(`review-pack: warning: ${w}`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, finished.pdf);
  const size = `${(finished.pdf.byteLength / 1024).toFixed(0)} KB`;
  console.log(
    `review-pack: ${relative(root, OUT)}: ${rendered.pageCount} pages, ${size}, v${version} at ${sha.slice(0, 7)}${dirty ? " (dirty tree)" : ""}`,
  );
  if (benchCaveat) console.warn(`review-pack: warning: ${benchCaveat}`);

  if (hasVerapdf) {
    const dir = mkdtempSync(join(tmpdir(), "necodoc-review-pack-"));
    try {
      const file = join(dir, "pack.pdf");
      writeFileSync(file, finished.pdf);
      for (const flavour of ["2u", "ua1"]) {
        const result = verapdf(file, flavour);
        console.log(
          `review-pack: veraPDF ${flavour}: ${result.compliant ? "compliant" : `NOT compliant (${result.failed.join(", ")})`}`,
        );
        if (!result.compliant) process.exitCode = 1;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    console.warn("review-pack: veraPDF isn't on PATH, so PDF/A-2u and PDF/UA-1 weren't validated");
  }
} finally {
  await closeBrowser();
}
