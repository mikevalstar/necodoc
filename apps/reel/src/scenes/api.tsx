// Scene 4: an HTML to PDF call, with round-trip times from the benchmark (W2).
import { interpolate, useCurrentFrame } from "remotion";
import { bench, latency, ms } from "../bench.ts";
import { useEnter } from "../components/frame.tsx";
import { Card } from "../components/screen.tsx";
import { color, font } from "../theme.ts";
import { benchNote } from "../timeline.ts";

const request = [
  ["POST", " /api/v1/render"],
  ["x-api-key:", " nd_••••••••••••"],
  ["", ""],
  ["{", ""],
  ['  "html":', ' "<h1>Invoice {{ number }}</h1>…",'],
  ['  "data":', ' { "number": "INV-2041", … },'],
  ['  "header":', ' { "html": "…", "height": 18 },'],
  ['  "footer":', ' { "html": "…", "height": 14 },'],
  ['  "filename":', ' "INV-2041.pdf"'],
  ["}", ""],
] as const;

const invoice = latency("html-invoice");
const slowestP50 = Math.max(...bench.latency.map((l) => l.roundTrip.p50 ?? 0));

export const Api = () => {
  const frame = useCurrentFrame();
  const done = useEnter(62);
  return (
    <Card dark>
      <div style={{ position: "absolute", left: 64, top: 60, width: 720 }}>
        <div style={{ font: `500 20px ${font.mono}`, color: color.nightFg2, marginBottom: 24 }}>
          Request
        </div>
        {request.map(([a, b], i) => (
          <div
            key={`${a}${b}`}
            style={{
              font: `400 25px/1.6 ${font.mono}`,
              color: color.nightFg,
              whiteSpace: "pre",
              opacity: interpolate(frame, [6 + i * 4, 14 + i * 4], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <span style={{ color: i < 2 ? "#9db8ff" : color.nightFg2 }}>{a}</span>
            {b}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 830, top: 60, width: 562, ...done }}>
        <div style={{ font: `500 20px ${font.mono}`, color: color.nightFg2, marginBottom: 24 }}>
          Response
        </div>
        <div style={{ font: `500 25px ${font.mono}`, color: "#7ee2b8" }}>
          200 OK · application/pdf · {invoice.pages} pages
        </div>
        <div
          style={{
            font: `700 120px/1 ${font.display}`,
            color: color.paper,
            marginTop: 30,
            letterSpacing: "-0.03em",
          }}
        >
          {ms(invoice.roundTrip.p50)}
        </div>
        <div style={{ font: `400 24px ${font.sans}`, color: color.nightFg2, marginTop: 10 }}>
          median round trip, p95 {ms(invoice.roundTrip.p95)}
        </div>
        <div style={{ marginTop: 40 }}>
          {bench.latency.map((l, i) => (
            <LatencyRow
              key={l.id}
              label={l.label}
              p50={l.roundTrip.p50}
              max={slowestP50}
              at={80 + i * 6}
            />
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          bottom: 36,
          font: `400 18px ${font.mono}`,
          color: color.nightFg2,
          opacity: interpolate(frame, [90, 104], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {benchNote}. Client round trip, p50.
      </div>
    </Card>
  );
};

const LatencyRow = ({
  label,
  p50,
  max,
  at,
}: {
  label: string;
  p50: number | null;
  max: number;
  at: number;
}) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [at, at + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ marginBottom: 14, opacity: Math.min(1, grow * 2) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          font: `400 20px ${font.sans}`,
          color: color.nightFg,
        }}
      >
        <span>{label}</span>
        <span style={{ font: `400 20px ${font.mono}` }}>{ms(p50)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: color.nightHair, marginTop: 6 }}>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: color.brand,
            width: `${((p50 ?? 0) / max) * 100 * grow}%`,
          }}
        />
      </div>
    </div>
  );
};
