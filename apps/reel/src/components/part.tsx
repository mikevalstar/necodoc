import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";

/** One shot inside a scene, cross-fading with its neighbours. */
export const Part = ({
  from,
  frames,
  children,
  fadeIn = true,
  fadeOut = true,
}: {
  from: number;
  frames: number;
  children: ReactNode;
  fadeIn?: boolean;
  fadeOut?: boolean;
}) => (
  <Sequence from={from} durationInFrames={frames} layout="none">
    <Fade frames={frames} fadeIn={fadeIn} fadeOut={fadeOut}>
      {children}
    </Fade>
  </Sequence>
);

const Fade = ({
  frames,
  fadeIn,
  fadeOut,
  children,
}: {
  frames: number;
  fadeIn: boolean;
  fadeOut: boolean;
  children: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const a = fadeIn ? interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const b = fadeOut
    ? interpolate(frame, [frames - 10, frames], [1, 0], { extrapolateLeft: "clamp" })
    : 1;
  return <AbsoluteFill style={{ opacity: Math.min(a, b) }}>{children}</AbsoluteFill>;
};
