// A real app screenshot in a card, with a slow camera (pan and zoom) and overlays drawn in
// the screenshot's own coordinates. Screenshots were captured at 1600x900 CSS px (2x), and
// every coordinate here is in a 2000x1125 space, the size they were reviewed at.
import { createContext, type ReactNode, useContext } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { color, shadow } from "../theme.ts";

export const IMAGE_W = 2000;
export const IMAGE_H = 1125;
export const CARD = { left: 232, top: 44, width: 1456, height: 819 } as const;

/** Camera target: focus point in image space and zoom (1 = the whole screenshot). */
export type Shot = { at: number; x: number; y: number; zoom: number };

const ScaleContext = createContext(1);
/** Overlays use this to keep strokes and the cursor a constant size on screen. */
export const useScreenScale = () => useContext(ScaleContext);

const ease = Easing.inOut(Easing.cubic);

const camera = (frame: number, shots: Shot[]) => {
  const ats = shots.map((s) => s.at);
  const pick = (k: "x" | "y" | "zoom") =>
    shots.length === 1
      ? (shots[0]?.[k] ?? 0)
      : interpolate(
          frame,
          ats,
          shots.map((s) => s[k]),
          { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
  return { x: pick("x"), y: pick("y"), zoom: pick("zoom") };
};

export const Card = ({ children, dark = false }: { children: ReactNode; dark?: boolean }) => (
  <div
    style={{
      position: "absolute",
      ...CARD,
      borderRadius: 18,
      overflow: "hidden",
      background: dark ? color.night : color.paper,
      boxShadow: shadow,
    }}
  >
    {children}
  </div>
);

export const Screen = ({
  src,
  shots,
  children,
}: {
  src: string;
  shots: Shot[];
  children?: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const { x, y, zoom } = camera(frame, shots);
  const s = (CARD.width / IMAGE_W) * zoom;
  const tx = Math.min(0, Math.max(CARD.width - IMAGE_W * s, CARD.width / 2 - x * s));
  const ty = Math.min(0, Math.max(CARD.height - IMAGE_H * s, CARD.height / 2 - y * s));
  return (
    <Card>
      <div
        style={{
          position: "absolute",
          width: IMAGE_W,
          height: IMAGE_H,
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
        }}
      >
        <Img src={staticFile(src)} style={{ width: IMAGE_W, height: IMAGE_H, display: "block" }} />
        <ScaleContext.Provider value={s}>{children}</ScaleContext.Provider>
      </div>
    </Card>
  );
};

/** A marigold ring around the one thing to look at (the design system's "next step"). */
export const Highlight = ({
  box: [x1, y1, x2, y2],
  from,
  to = 100_000,
}: {
  box: [number, number, number, number];
  from: number;
  to?: number;
}) => {
  const frame = useCurrentFrame();
  const s = useScreenScale();
  const opacity = interpolate(frame, [from, from + 12, to, to + 12], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pad = 8 / s;
  return (
    <div
      style={{
        position: "absolute",
        left: x1 - pad,
        top: y1 - pad,
        width: x2 - x1 + pad * 2,
        height: y2 - y1 + pad * 2,
        border: `${4 / s}px solid ${color.sun}`,
        borderRadius: 12 / s,
        boxShadow: `0 0 0 ${8 / s}px rgba(255, 197, 61, 0.25)`,
        opacity,
      }}
    />
  );
};

/** A pointer that glides between points and presses at the given frames. */
export const Cursor = ({
  path,
  clicks = [],
}: {
  path: { at: number; x: number; y: number }[];
  clicks?: number[];
}) => {
  const frame = useCurrentFrame();
  const s = useScreenScale();
  const first = path[0];
  if (!first || frame < first.at) return null;
  const ats = path.map((p) => p.at);
  const x =
    path.length > 1
      ? interpolate(
          frame,
          ats,
          path.map((p) => p.x),
          { easing: ease, extrapolateRight: "clamp" },
        )
      : first.x;
  const y =
    path.length > 1
      ? interpolate(
          frame,
          ats,
          path.map((p) => p.y),
          { easing: ease, extrapolateRight: "clamp" },
        )
      : first.y;
  const press = clicks.reduce((m, c) => {
    const d = frame - c;
    return d >= 0 && d < 14 ? Math.max(m, 1 - d / 14) : m;
  }, 0);
  const appear = interpolate(frame, [first.at, first.at + 8], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transformOrigin: "0 0",
        transform: `scale(${(1 / s) * (1 - press * 0.12)})`,
        opacity: appear,
      }}
    >
      {press > 0 && (
        <div
          style={{
            position: "absolute",
            left: -22,
            top: -22,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: `3px solid ${color.brand}`,
            opacity: press,
            transform: `scale(${1.6 - press * 0.6})`,
          }}
        />
      )}
      <svg
        width="34"
        height="40"
        viewBox="0 0 34 40"
        style={{ display: "block" }}
        aria-hidden="true"
      >
        <path
          d="M2 2 L2 32 L10 25 L16 38 L22 35 L16 23 L27 23 Z"
          fill={color.ink}
          stroke={color.paper}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
