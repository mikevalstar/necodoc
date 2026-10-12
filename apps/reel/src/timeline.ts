// The storyboard (docs/features/product-tour-reel.md): scene order, lengths and captions.
// The composition, the burned-in captions, the VTT track and the site's chapter list all
// read from here, so they can't drift apart. Plain data: scripts/render.ts imports it in Node.
import { bench, count, fastest, latency, ms, runs, slowest, workers } from "./bench.ts";

export const fps = 30;
export const width = 1920;
export const height = 1080;

type Caption = { at: number; text: string };

export type Scene = {
  id:
    | "opener"
    | "overlay"
    | "conditional"
    | "fill"
    | "api"
    | "batch"
    | "signing"
    | "governance"
    | "closing";
  frames: number;
  /** Shown in the site's chapter list; scenes without one don't get a chapter. */
  chapter?: string;
  /** Frames from the scene start. Title cards carry their text on screen, so their captions only go in the VTT. */
  captions: Caption[];
  burnIn: boolean;
};

const invoice = latency("html-invoice");
const scaling =
  runs.length > 1
    ? `${count(fastest.docsPerMinute)} documents a minute on ${workers(fastest.workers)}, ${count(slowest.docsPerMinute)} on ${slowest.workers === 1 ? "one" : slowest.workers}. No licence fee per worker.`
    : `${count(fastest.docsPerMinute)} documents a minute on ${workers(fastest.workers)}. No licence fee per worker.`;

export const scenes: Scene[] = [
  {
    id: "opener",
    frames: 75,
    burnIn: false,
    captions: [{ at: 0, text: "necodoc: from the obligee's PDF to a renewal run." }],
  },
  {
    id: "overlay",
    frames: 300,
    chapter: "Upload the bond form; AI proposes boxes, you confirm",
    burnIn: true,
    captions: [
      { at: 0, text: "Start from the bond form exactly as the obligee publishes it." },
      { at: 95, text: "AI proposes a box for each blank it finds, with a name and a type." },
      { at: 205, text: "An editor confirms each box in the overlay editor, with a live preview." },
    ],
  },
  {
    id: "conditional",
    frames: 210,
    chapter: "Designed templates with conditional sections",
    burnIn: true,
    captions: [
      {
        at: 0,
        text: "In a designed template, a section can show only when it applies.",
      },
      {
        at: 110,
        text: 'Tick "Add a co-principal" and the bond gets a second principal and a second signature block.',
      },
    ],
  },
  {
    id: "fill",
    frames: 180,
    chapter: "Guided form to finished PDF",
    burnIn: true,
    captions: [
      { at: 0, text: "The person filling it in gets a guided form, one step at a time." },
      { at: 90, text: "The same renderer makes the preview and the finished PDF." },
    ],
  },
  {
    id: "api",
    frames: 180,
    chapter: "HTML to PDF from your policy system",
    burnIn: true,
    captions: [
      {
        at: 0,
        text: "Your policy system can also post HTML and data to the API and get the PDF back.",
      },
      {
        at: 90,
        text: `Measured median: ${ms(invoice.roundTrip.p50)} for a ${invoice.pages}-page invoice with a header and footer.`,
      },
    ],
  },
  {
    id: "batch",
    frames: 240,
    chapter: "Batches that scale out with workers",
    burnIn: true,
    captions: [
      { at: 0, text: `Month-end renewals: one batch of ${count(fastest.rows)} rows.` },
      { at: 110, text: `More workers, more throughput: ${scaling}` },
    ],
  },
  {
    id: "signing",
    frames: 180,
    chapter: "E-signature ready signing packages",
    burnIn: true,
    captions: [
      {
        at: 0,
        text: "E-signature ready: each PDF comes with its signers and the position of every signature box.",
      },
      {
        at: 100,
        text: "Your DocuSign, Dropbox Sign or Adobe Acrobat Sign account runs the signing.",
      },
    ],
  },
  {
    id: "governance",
    frames: 210,
    chapter: "Audit log, generation log, your cloud",
    burnIn: true,
    captions: [
      { at: 0, text: "Every change and sign-in goes into an append-only audit log." },
      { at: 80, text: "The generation log keeps every PDF with its input, output and timing." },
      {
        at: 145,
        text: "necodoc runs in your cloud. PDFs stay in your S3-compatible bucket or Azure Blob container.",
      },
    ],
  },
  {
    id: "closing",
    frames: 120,
    burnIn: false,
    captions: [
      {
        at: 0,
        text: "necodoc. Document generation for insurers, in your own cloud. Self-hosted, open source under MIT. github.com/mikevalstar/necodoc",
      },
    ],
  },
];

export const totalFrames = scenes.reduce((sum, s) => sum + s.frames, 0);

/** Scene start frames, in order. */
export const starts = scenes.map((_, i) =>
  scenes.slice(0, i).reduce((sum, s) => sum + s.frames, 0),
);

/** Every caption with absolute start and end frames. */
export const cues = scenes.flatMap((scene, i) => {
  const start = starts[i] ?? 0;
  return scene.captions.map((c, j) => ({
    from: start + c.at,
    to: start + (scene.captions[j + 1]?.at ?? scene.frames),
    text: c.text,
  }));
});

export const benchNote = `Benchmark ${bench.finishedAt.slice(0, 10)}, ${bench.environment.cpu}, ${bench.environment.cores} cores, commit ${bench.environment.gitSha.slice(0, 7)}`;
