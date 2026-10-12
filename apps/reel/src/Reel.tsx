import type { ComponentType } from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SceneFrame } from "./components/frame.tsx";
import { Api } from "./scenes/api.tsx";
import { Batch } from "./scenes/batch.tsx";
import { Overlay } from "./scenes/overlay.tsx";
import { Closing, Governance, Opener, Signing } from "./scenes/rest.tsx";
import { Conditional, Fill } from "./scenes/templates.tsx";
import { color } from "./theme.ts";
import { type Scene, scenes, starts } from "./timeline.ts";

const views: Record<Scene["id"], ComponentType> = {
  opener: Opener,
  overlay: Overlay,
  conditional: Conditional,
  fill: Fill,
  api: Api,
  batch: Batch,
  signing: Signing,
  governance: Governance,
  closing: Closing,
};

const chapters = scenes.filter((s) => s.chapter).length;

export const Reel = () => (
  <AbsoluteFill style={{ background: color.canvas }}>
    {scenes.map((scene, i) => {
      const View = views[scene.id];
      const index = scenes.slice(0, i + 1).filter((s) => s.chapter).length;
      return (
        <Sequence key={scene.id} from={starts[i]} durationInFrames={scene.frames} name={scene.id}>
          <SceneFrame scene={scene} index={index} total={chapters}>
            <View />
          </SceneFrame>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
