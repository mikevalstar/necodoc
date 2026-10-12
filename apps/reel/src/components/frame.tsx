// Scene chrome: a gentle fade between scenes, the chapter eyebrow and the burned-in caption.
import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Scene } from "../timeline.ts";
import { color, font } from "../theme.ts";

const FADE = 12;

export const SceneFrame = ({
  scene,
  index,
  total,
  children,
}: {
  scene: Scene;
  index: number;
  total: number;
  children: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE, scene.frames - FADE, scene.frames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
      {scene.burnIn && <CaptionBand scene={scene} index={index} total={total} />}
    </AbsoluteFill>
  );
};

const CaptionBand = ({ scene, index, total }: { scene: Scene; index: number; total: number }) => {
  const frame = useCurrentFrame();
  const current = scene.captions.findLast((c) => frame >= c.at);
  if (!current) return null;
  const next = scene.captions.find((c) => c.at > current.at);
  const end = next?.at ?? scene.frames;
  // Swap captions with a short cross-fade; never flash.
  const opacity = interpolate(frame, [current.at, current.at + 8, end - 6, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", left: 232, right: 232, top: 896, height: 150 }}>
      <div
        style={{
          font: `500 20px ${font.mono}`,
          color: color.brandInk,
          letterSpacing: "0.04em",
          marginBottom: 12,
        }}
      >
        {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")} · {scene.chapter}
      </div>
      <div
        style={{
          font: `600 42px/1.2 ${font.sans}`,
          color: color.ink,
          letterSpacing: "-0.01em",
          opacity,
          textWrap: "balance",
        }}
      >
        {current.text}
      </div>
    </div>
  );
};

/** The neko mark from apps/web/public/favicon.svg. */
export const Mark = ({ size, ink = color.ink }: { size: number; ink?: string }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <path
      fill={ink}
      fillRule="evenodd"
      d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"
    />
    <path fill={color.brand} d="M36 47H40V53H36Z" />
  </svg>
);

export const Pill = ({
  children,
  tone = "brand",
}: {
  children: ReactNode;
  tone?: "brand" | "ok" | "sun" | "muted";
}) => {
  const tones = {
    brand: [color.brandWash, color.brandInk],
    ok: [color.okWash, color.ok],
    sun: ["#fff0cc", "#8a5600"],
    muted: [color.tint, color.ink2],
  } as const;
  const [bg, fg] = tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        background: bg,
        color: fg,
        font: `600 20px ${font.sans}`,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: fg }} />
      {children}
    </span>
  );
};

/** Fade and lift an element in at a frame. */
export const useEnter = (at: number, length = 14) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { opacity: t, transform: `translateY(${(1 - t) * 14}px)` } as const;
};
