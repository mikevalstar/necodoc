// Scenes 6-8 and the title cards: signing handoff, governance and hosting, opener and close.
import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { Mark, Pill, useEnter } from "../components/frame.tsx";
import { Part } from "../components/part.tsx";
import { Card, Highlight, Screen } from "../components/screen.tsx";
import { color, font } from "../theme.ts";

const Tile = ({
  at,
  title,
  children,
  wide = false,
}: {
  at: number;
  title: string;
  children?: ReactNode;
  wide?: boolean;
}) => (
  <div
    style={{
      ...useEnter(at),
      background: color.paper,
      borderRadius: 16,
      padding: "26px 30px",
      boxShadow: "0 1px 2px rgba(12,18,51,.06), 0 10px 30px -14px rgba(12,18,51,.22)",
      width: wide ? "100%" : undefined,
    }}
  >
    <div style={{ font: `700 30px ${font.display}`, color: color.ink }}>{title}</div>
    {children && (
      <div style={{ font: `400 21px/1.45 ${font.sans}`, color: color.ink2, marginTop: 8 }}>
        {children}
      </div>
    )}
  </div>
);

const Handoff = () => (
  <Card>
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: color.tint,
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "0 70px",
      }}
    >
      <div style={{ width: 520 }}>
        <Tile at={4} title="Signing package">
          The PDF · signers in routing order · every sign box with its page and position · envelope
          JSON for your provider
        </Tile>
      </div>
      <div style={{ ...useEnter(22), flex: 1, display: "grid", placeItems: "center" }}>
        <svg width="180" height="60" viewBox="0 0 180 60" aria-hidden="true">
          <path d="M10 30 H160" stroke={color.brand} strokeWidth="5" strokeLinecap="round" />
          <path
            d="M145 14 L165 30 L145 46"
            fill="none"
            stroke={color.brand}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ width: 460, display: "grid", gap: 20 }}>
        <Tile at={30} title="DocuSign" />
        <Tile at={38} title="Dropbox Sign" />
        <Tile at={46} title="Adobe Acrobat Sign" />
      </div>
    </div>
  </Card>
);

export const Signing = () => (
  <>
    <Part from={0} frames={110} fadeIn={false}>
      <Screen
        src="screens/signing-package.jpg"
        shots={[
          { at: 0, x: 1110, y: 640, zoom: 1.1 },
          { at: 60, x: 1110, y: 700, zoom: 1.28 },
        ]}
      >
        <Highlight box={[352, 680, 1868, 868]} from={30} />
      </Screen>
    </Part>
    <Part from={100} frames={80} fadeOut={false}>
      <Handoff />
    </Part>
  </>
);

const Cloud = () => (
  <Card>
    <div style={{ position: "absolute", inset: 0, background: color.tint }} />
    <div
      style={{
        position: "absolute",
        inset: 48,
        borderRadius: 22,
        border: `3px dashed ${color.brand}`,
        padding: "34px 40px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          font: `500 22px ${font.mono}`,
          color: color.brandInk,
          marginBottom: 24,
          ...useEnter(2),
        }}
      >
        Your cloud account · your network
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 24,
          flex: 1,
        }}
      >
        <Tile at={6} title="necodoc app and API">
          Container images, on Docker Compose or Helm
        </Tile>
        <Tile at={12} title="Render workers">
          The API image again, as many as you need
        </Tile>
        <Tile at={18} title="Postgres">
          Templates, versions, logs and the queue
        </Tile>
        <Tile at={24} title="Object storage">
          <span style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <Pill>S3-compatible</Pill>
            <Pill>Azure Blob</Pill>
            <Pill tone="muted">Disk</Pill>
          </span>
        </Tile>
      </div>
    </div>
  </Card>
);

export const Governance = () => (
  <>
    <Part from={0} frames={90} fadeIn={false}>
      <Screen
        src="screens/audit-log.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 50, x: 1000, y: 520, zoom: 1.15 },
        ]}
      >
        <Highlight box={[350, 145, 1075, 197]} from={18} />
      </Screen>
    </Part>
    <Part from={80} frames={75}>
      <Screen
        src="screens/generation-log.jpg"
        shots={[
          { at: 0, x: 1000, y: 562, zoom: 1 },
          { at: 45, x: 1110, y: 560, zoom: 1.15 },
        ]}
      >
        <Highlight box={[352, 645, 1868, 772]} from={22} />
      </Screen>
    </Part>
    <Part from={145} frames={65} fadeOut={false}>
      <Cloud />
    </Part>
  </>
);

export const Opener = () => (
  <AbsoluteFill
    style={{ background: color.canvas, alignItems: "center", justifyContent: "center" }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 28, ...useEnter(4, 20) }}>
      <Mark size={128} />
      <span
        style={{ font: `700 132px/1 ${font.display}`, color: color.ink, letterSpacing: "-0.03em" }}
      >
        necodoc
      </span>
    </div>
    <div
      style={{
        font: `500 46px ${font.sans}`,
        color: color.ink2,
        marginTop: 34,
        ...useEnter(16, 20),
      }}
    >
      From the obligee's PDF to a renewal run.
    </div>
  </AbsoluteFill>
);

export const Closing = () => (
  <AbsoluteFill style={{ background: color.night, alignItems: "center", justifyContent: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 28, ...useEnter(4, 20) }}>
      <Mark size={120} ink={color.paper} />
      <span
        style={{
          font: `700 124px/1 ${font.display}`,
          color: color.paper,
          letterSpacing: "-0.03em",
        }}
      >
        necodoc
      </span>
    </div>
    <div
      style={{
        font: `500 42px ${font.sans}`,
        color: color.nightFg,
        marginTop: 30,
        ...useEnter(14, 20),
      }}
    >
      Document generation for insurers, in your own cloud.
    </div>
    <div style={{ display: "flex", gap: 18, marginTop: 40, ...useEnter(24, 20) }}>
      <NightPill>Self-hosted</NightPill>
      <NightPill>Open source · MIT</NightPill>
    </div>
    <div
      style={{
        font: `400 34px ${font.mono}`,
        color: "#9db8ff",
        marginTop: 48,
        ...useEnter(34, 20),
      }}
    >
      github.com/mikevalstar/necodoc
    </div>
  </AbsoluteFill>
);

const NightPill = ({ children }: { children: ReactNode }) => (
  <span
    style={{
      padding: "12px 26px",
      borderRadius: 999,
      border: `2px solid ${color.nightHair}`,
      background: "rgba(255,255,255,.06)",
      color: color.nightFg,
      font: `600 28px ${font.sans}`,
    }}
  >
    {children}
  </span>
);
