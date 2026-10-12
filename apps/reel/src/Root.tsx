import { Composition } from "remotion";
import { Reel } from "./Reel.tsx";
import { fps, height, totalFrames, width } from "./timeline.ts";

export const Root = () => (
  <Composition
    id="reel"
    component={Reel}
    durationInFrames={totalFrames}
    fps={fps}
    width={width}
    height={height}
  />
);
