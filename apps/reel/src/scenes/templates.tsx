// Scenes 2 and 3: a designed template's conditional section, then the guided form and its PDF.
// The PDFs are two real renders of one document, with and without the co-principal.
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Part } from "../components/part.tsx";
import { CARD, Cursor, Highlight, Screen, type Shot } from "../components/screen.tsx";
import { color, font } from "../theme.ts";

const TOGGLE_AT = 40;
const pdf: Shot[] = [
  { at: 0, x: 790, y: 700, zoom: 1.35 },
  { at: 100, x: 790, y: 760, zoom: 1.45 },
];

const Toggle = () => {
  const frame = useCurrentFrame();
  const on = frame >= TOGGLE_AT;
  const t = interpolate(frame, [TOGGLE_AT, TOGGLE_AT + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity: 1 - t }}>
      <Screen src="screens/finished-no-coprincipal.jpg" shots={pdf}>
        <Highlight box={[365, 340, 470, 370]} from={0} to={TOGGLE_AT - 10} />
      </Screen>
      {on || <ToggleChip on={false} />}
    </AbsoluteFill>
  );
};

const ToggleOn = () => (
  <>
    <Screen src="screens/finished-coprincipal.jpg" shots={pdf}>
      <Highlight box={[560, 820, 1010, 910]} from={TOGGLE_AT + 10} />
      <Highlight box={[365, 340, 470, 370]} from={TOGGLE_AT + 10} />
    </Screen>
    <ToggleChip on />
  </>
);

const ToggleChip = ({ on }: { on: boolean }) => (
  <div
    style={{
      position: "absolute",
      left: CARD.left + CARD.width - 520,
      top: CARD.top + 40,
      width: 470,
      padding: "22px 26px",
      borderRadius: 16,
      background: color.paper,
      boxShadow: "0 1px 2px rgba(12,18,51,.06), 0 20px 40px -16px rgba(12,18,51,.35)",
      display: "flex",
      alignItems: "center",
      gap: 18,
      font: `600 28px ${font.sans}`,
      color: color.ink,
    }}
  >
    <span
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        display: "grid",
        placeItems: "center",
        background: on ? color.brand : color.paper,
        border: on ? "none" : `2px solid ${color.ink3}`,
        color: color.paper,
        fontSize: 24,
      }}
    >
      {on ? "✓" : ""}
    </span>
    Add a co-principal
  </div>
);

export const Conditional = () => (
  <>
    <Part from={0} frames={120} fadeIn={false}>
      <Screen
        src="screens/template-editor.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 40, x: 830, y: 640, zoom: 1.6 },
          { at: 110, x: 830, y: 660, zoom: 1.65 },
        ]}
      >
        <Highlight box={[618, 525, 1048, 773]} from={40} />
      </Screen>
    </Part>
    <Part from={110} frames={100} fadeOut={false}>
      <AbsoluteFill>
        <ToggleOn />
      </AbsoluteFill>
      <Toggle />
    </Part>
  </>
);

export const Fill = () => (
  <>
    <Part from={0} frames={100} fadeIn={false}>
      <Screen
        src="screens/fill-coprincipal-on.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 35, x: 790, y: 720, zoom: 1.4 },
          { at: 100, x: 790, y: 760, zoom: 1.42 },
        ]}
      >
        <Highlight box={[385, 478, 1195, 516]} from={30} />
      </Screen>
    </Part>
    <Part from={90} frames={90} fadeOut={false}>
      <Screen
        src="screens/finished-coprincipal.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 40, x: 780, y: 560, zoom: 1.3 },
        ]}
      >
        <Highlight box={[597, 243, 782, 292]} from={40} />
        <Cursor
          path={[
            { at: 30, x: 1100, y: 520 },
            { at: 58, x: 700, y: 270 },
          ]}
          clicks={[64]}
        />
      </Screen>
    </Part>
  </>
);
