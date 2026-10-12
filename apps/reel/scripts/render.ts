// Renders the tour into apps/web/public/reel: MP4 (H.264), WebM (VP9), a poster PNG, a VTT
// caption track and reel.json, which the site's Reel component reads.
// Usage: pnpm --filter @necodoc/reel render [--concurrency 3]
import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { bench } from "../src/bench.ts";
import { cues, fps, scenes, starts, totalFrames } from "../src/timeline.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(root, "../web/public/reel");
const name = "necodoc-tour";

const { values } = parseArgs({ options: { concurrency: { type: "string" } } });
// Modest by default: the machine is usually also running the dev app.
const concurrency = Number(
  values.concurrency ?? Math.max(1, Math.floor(os.availableParallelism() / 3)),
);

if (bench.quick)
  throw new Error("latest.json is a quick smoke run; run a full `pnpm bench` first.");
if (bench.environment.gitDirty) console.warn("! latest.json was measured on an uncommitted tree.");

const clock = (frames: number, precise: boolean) => {
  const total = frames / fps;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (!precise) return `${m}:${String(Math.round(s)).padStart(2, "0")}`;
  return `00:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
};

await mkdir(out, { recursive: true });
console.log("Bundling…");
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "reel" });

const media = [
  // Calm UI footage compresses well; these keep text crisp and the MP4 under 8 MB.
  { file: `${name}.mp4`, codec: "h264", crf: 26, x264Preset: "slow" },
  { file: `${name}.webm`, codec: "vp9", crf: 45 },
] as const;

for (const m of media) {
  console.log(`Rendering ${m.file} (concurrency ${concurrency})…`);
  await renderMedia({
    serveUrl,
    composition,
    codec: m.codec,
    crf: m.crf,
    ...("x264Preset" in m ? { x264Preset: m.x264Preset } : {}),
    muted: true,
    concurrency,
    outputLocation: path.join(out, m.file),
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%`),
  });
  process.stdout.write("\n");
}

// The poster: AI suggestions on the bond, waiting for a person to accept them.
const overlayStart = starts[scenes.findIndex((s) => s.id === "overlay")] ?? 0;
await renderStill({
  serveUrl,
  composition,
  frame: overlayStart + 172,
  imageFormat: "png",
  output: path.join(out, `${name}-poster.png`),
});

const vtt = [
  "WEBVTT",
  "",
  ...cues.map((c, i) => `${i + 1}\n${clock(c.from, true)} --> ${clock(c.to, true)}\n${c.text}\n`),
].join("\n");
await writeFile(path.join(out, `${name}.vtt`), vtt);

const manifest = {
  duration: clock(totalFrames, false),
  mp4: `/reel/${name}.mp4`,
  webm: `/reel/${name}.webm`,
  poster: `/reel/${name}-poster.png`,
  captions: `/reel/${name}.vtt`,
  chapters: scenes.flatMap((s, i) =>
    s.chapter ? [{ label: s.chapter, at: clock(starts[i] ?? 0, false) }] : [],
  ),
  bench: { finishedAt: bench.finishedAt, gitSha: bench.environment.gitSha },
};
await writeFile(path.join(out, "reel.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const f of [...media.map((m) => m.file), `${name}-poster.png`, `${name}.vtt`]) {
  const { size } = await stat(path.join(out, f));
  console.log(`${f}: ${(size / 1024 / 1024).toFixed(2)} MB`);
}
