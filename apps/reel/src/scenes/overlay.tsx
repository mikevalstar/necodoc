// Scene 1: upload an existing surety bond, AI proposes boxes, a person confirms.
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Card, Cursor, Highlight, Screen } from "../components/screen.tsx";
import { Part } from "../components/part.tsx";
import { color, font } from "../theme.ts";
import suggestions from "./bond-boxes.json" with { type: "json" };

// The page is fixtures/pdfs/surety-bonds/or-ccb-commercial-contractor-bond.pdf at 200 dpi;
// bond-boxes.json holds the boxes on page 1 of the "OR CCB commercial bond" template in the
// dev app (PDF points, origin bottom left), with readable names.
const PAGE_PT = { w: 612, h: 792 };
const VIEW = { left: 40, top: 40, width: 780, height: 739 };
const k = VIEW.width / PAGE_PT.w;
const pageHeight = PAGE_PT.h * k;
const ACCEPT_AT = 84;

const Detect = () => {
  const frame = useCurrentFrame();
  const pan = interpolate(frame, [10, 92], [0, VIEW.height - pageHeight], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const accepted = frame >= ACCEPT_AT + 4;
  const appear = (i: number) =>
    interpolate(frame, [12 + i * 5, 22 + i * 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Card>
      <div style={{ position: "absolute", inset: 0, background: color.tint }} />
      <div
        style={{
          position: "absolute",
          ...VIEW,
          overflow: "hidden",
          borderRadius: 10,
          background: color.paper,
          boxShadow: "0 1px 2px rgba(12,18,51,.06), 0 10px 30px -14px rgba(12,18,51,.22)",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: pan, width: VIEW.width, height: pageHeight }}>
          <Img src={staticFile("screens/bond-page.png")} style={{ width: VIEW.width, height: pageHeight }} />
          {suggestions.map((b, i) => (
            <div
              key={b.label}
              style={{
                position: "absolute",
                left: b.x * k,
                top: (PAGE_PT.h - b.y - b.h) * k,
                width: b.w * k,
                height: b.h * k,
                borderRadius: 3,
                border: `2px ${accepted ? "solid" : "dashed"} ${b.type === "signature" ? "#b7791f" : color.brand}`,
                background: accepted ? "rgba(47,107,255,.12)" : "rgba(47,107,255,.05)",
                opacity: appear(i),
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 860, top: 40, width: 556, height: 739 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, font: `700 32px ${font.display}`, color: color.ink }}>
          <Sparkle /> Detect with AI
        </div>
        <div style={{ font: `400 20px ${font.sans}`, color: color.ink3, marginTop: 6, marginBottom: 18 }}>
          {accepted ? `${suggestions.length} boxes accepted on page 1` : "Suggestions stay apart until you accept them"}
        </div>
        {suggestions.map((b, i) => (
          <div
            key={b.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 34,
              borderTop: `1px solid ${color.hair}`,
              font: `500 20px ${font.sans}`,
              color: color.ink,
              opacity: appear(i),
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  display: "grid",
                  placeItems: "center",
                  background: accepted ? color.ok : "transparent",
                  border: accepted ? "none" : `2px dashed ${color.brand}`,
                  color: color.paper,
                  fontSize: 14,
                }}
              >
                {accepted ? "✓" : ""}
              </span>
              {b.label}
            </span>
            <span style={{ font: `400 17px ${font.mono}`, color: color.ink3 }}>{b.type}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
          <div
            style={{
              padding: "12px 22px",
              borderRadius: 10,
              background: accepted ? color.okWash : color.brand,
              color: accepted ? color.ok : color.paper,
              font: `600 20px ${font.sans}`,
            }}
          >
            {accepted ? "Accepted" : "Accept all"}
          </div>
          <div style={{ padding: "12px 22px", borderRadius: 10, background: color.paper, color: color.ink, font: `600 20px ${font.sans}` }}>
            Review one by one
          </div>
        </div>
      </div>
      <CardCursor />
    </Card>
  );
};

// Cursor in card pixels (no camera on this shot).
const CardCursor = () => (
  <Cursor
    path={[
      { at: 50, x: 1300, y: 500 },
      { at: ACCEPT_AT - 6, x: 925, y: 648 },
    ]}
    clicks={[ACCEPT_AT]}
  />
);

const Sparkle = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z" fill={color.brand} />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" fill={color.sun} />
  </svg>
);

export const Overlay = () => (
  <>
    <Part from={0} frames={100} fadeIn={false}>
      <Screen
        src="screens/upload-dialog.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 45, x: 1000, y: 700, zoom: 1.5 },
        ]}
      >
        <Highlight box={[712, 621, 1288, 668]} from={30} to={62} />
        <Cursor
          path={[
            { at: 50, x: 1450, y: 820 },
            { at: 80, x: 1210, y: 985 },
          ]}
          clicks={[86]}
        />
      </Screen>
    </Part>
    <Part from={90} frames={125}>
      <Detect />
    </Part>
    <Part from={205} frames={95} fadeOut={false}>
      <Screen
        src="screens/overlay.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 35, x: 660, y: 560, zoom: 1.55 },
          { at: 60, x: 660, y: 560, zoom: 1.55 },
          { at: 90, x: 1300, y: 640, zoom: 1.25 },
        ]}
      >
        <Highlight box={[328, 440, 995, 640]} from={30} to={62} />
      </Screen>
    </Part>
  </>
);
