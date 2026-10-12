import { formatMs } from "@necodoc/bench/schema";
// Scene 5: a batch filling up while workers are added; rows and rates from the benchmark (W2).
import { interpolate, useCurrentFrame } from "remotion";
import { bench, count, fastest, runs, workers } from "../bench.ts";
import { useEnter } from "../components/frame.tsx";
import { Card } from "../components/screen.tsx";
import { color, font } from "../theme.ts";
import { benchNote } from "../timeline.ts";

// One cell per row, sized so any batch fits a 720 x 500 grid.
const CELL = Math.floor(Math.sqrt((720 * 500) / fastest.rows));
const GAP = Math.max(1, Math.round(CELL * 0.22));
const DOT = CELL - GAP;
const FILL = [20, 175] as const;
const barAt = (i: number) => 30 + i * 28;

export const Batch = () => {
  const frame = useCurrentFrame();
  const rows = fastest.rows;
  const done = Math.round(
    rows *
      interpolate(frame, [...FILL], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
  );
  const shown = runs.filter((_, i) => frame >= barAt(i));
  const activeWorkers = shown.at(-1)?.workers ?? 0;
  const maxRate = Math.max(...runs.map((r) => r.docsPerMinute));
  const note = useEnter(120);
  return (
    <Card>
      <div style={{ position: "absolute", left: 64, top: 56, width: 720 }}>
        <div style={{ font: `700 34px ${font.display}`, color: color.ink }}>
          Batch · {count(rows)} rows
        </div>
        <div
          style={{
            font: `400 21px ${font.sans}`,
            color: color.ink3,
            marginTop: 6,
            marginBottom: 26,
          }}
        >
          One published template, one PDF per JSON row
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: GAP,
            width: Math.floor(720 / CELL) * CELL,
          }}
        >
          {Array.from({ length: rows }, (_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size grid of identical cells
              key={i}
              style={{
                width: DOT,
                height: DOT,
                borderRadius: 3,
                background: i < done ? color.brand : color.tint,
              }}
            />
          ))}
        </div>
        <div style={{ font: `500 22px ${font.mono}`, color: color.ink2, marginTop: 22 }}>
          {count(done)} of {count(rows)} rendered
        </div>
      </div>
      <div style={{ position: "absolute", left: 860, top: 56, width: 532 }}>
        <div style={{ font: `700 34px ${font.display}`, color: color.ink }}>
          Documents per minute
        </div>
        <div
          style={{
            font: `400 21px ${font.sans}`,
            color: color.ink3,
            marginTop: 6,
            marginBottom: 30,
          }}
        >
          {count(rows)} rows, wall time from the first row to the last
        </div>
        {runs.map((r, i) => (
          <Bar
            key={r.workers}
            label={workers(r.workers)}
            value={`${count(r.docsPerMinute)} / min · ${formatMs(r.wallMs)}`}
            ratio={r.docsPerMinute / maxRate}
            at={barAt(i)}
          />
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 30 }}>
          <span style={{ font: `500 20px ${font.mono}`, color: color.ink3, width: 100 }}>
            Workers
          </span>
          {Array.from({ length: fastest.workers }, (_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: one square per worker
              key={i}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: i < activeWorkers ? color.night : color.tint,
                transition: "none",
              }}
            />
          ))}
        </div>
        <div
          style={{ font: `400 20px/1.4 ${font.sans}`, color: color.ink2, marginTop: 26, ...note }}
        >
          Every worker runs the API image. No licence fee per worker; add them for month-end and
          remove them after.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          bottom: 36,
          font: `400 18px ${font.mono}`,
          color: color.ink3,
        }}
      >
        {benchNote}. All workers on one {bench.environment.cores}-core laptop.
      </div>
    </Card>
  );
};

const Bar = ({
  label,
  value,
  ratio,
  at,
}: {
  label: string;
  value: string;
  ratio: number;
  at: number;
}) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [at, at + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ marginBottom: 20, opacity: Math.min(1, grow * 2) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          font: `600 22px ${font.sans}`,
          color: color.ink,
        }}
      >
        <span>{label}</span>
        <span style={{ font: `400 20px ${font.mono}`, color: color.ink2 }}>{value}</span>
      </div>
      <div style={{ height: 12, borderRadius: 6, background: color.tint, marginTop: 8 }}>
        <div
          style={{
            height: 12,
            borderRadius: 6,
            background: color.brand,
            width: `${ratio * 100 * grow}%`,
          }}
        />
      </div>
    </div>
  );
};
