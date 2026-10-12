import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { KeyIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { openApiUrl } from "@/lib/api";
import { useTheme } from "@/lib/theme";

// ADR 0030; spec: docs/features/html-to-pdf-api.md (Docs and SDK). The live /api/v1 OpenAPI
// document, with Scalar's try-it client against this deployment. Not under /api: Vite proxies it.
export const Route = createFileRoute("/_app/developers")({
  component: Developers,
});

// Scalar's theme variables pointed at the app's tokens, so the reference follows Cobalt in light
// and dark. Scoped to the wrapper and its mode classes, which beat Scalar's own theme.
const scalarCss = `
.scalar-cobalt, .scalar-cobalt .light-mode, .scalar-cobalt .dark-mode {
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  --scalar-radius: 8px;
  --scalar-radius-lg: 10px;
  --scalar-background-1: var(--surface);
  --scalar-background-2: var(--tint);
  --scalar-background-3: var(--tint-2);
  --scalar-background-card: var(--surface);
  --scalar-background-accent: var(--brand-wash);
  --scalar-color-1: var(--ink);
  --scalar-color-2: var(--ink-2);
  --scalar-color-3: var(--ink-3);
  --scalar-color-accent: var(--brand-ink);
  --scalar-border-color: var(--hair);
  --scalar-button-1: var(--brand);
  --scalar-button-1-color: var(--on-brand);
  --scalar-button-1-hover: var(--brand-ink);
  --scalar-color-green: var(--ok);
  --scalar-color-red: var(--bad);
  --scalar-color-yellow: var(--warn);
  --scalar-color-blue: var(--run);
  --scalar-sidebar-background-1: var(--surface);
  --scalar-sidebar-item-hover-background: var(--tint);
  --scalar-sidebar-item-active-background: var(--brand-wash);
  --scalar-sidebar-color-active: var(--brand-ink);
  --scalar-sidebar-search-background: var(--tint);
  --scalar-sidebar-border-color: var(--hair);
}`;

function Developers() {
  // Subscribes to theme changes; the class on <html> says what "system" resolved to.
  useTheme();
  const dark = document.documentElement.classList.contains("dark");
  return (
    <Page>
      <PageHeader
        title="API reference"
        description={
          <>
            Every <code className="font-mono text-[14px]">/api/v1</code> endpoint, with a client to
            try calls against this deployment. Send an API key in{" "}
            <code className="font-mono text-[14px]">x-api-key</code>. Point Postman or an OpenAPI
            generator at{" "}
            <a
              href={openApiUrl}
              className="font-mono text-[14px] font-semibold text-brand-ink hover:underline"
            >
              /api/v1/openapi.json
            </a>
            .
          </>
        }
        actions={
          <>
            <FaqLink feature="API reference and OpenAPI" />
            <Button nativeButton={false} render={<Link to="/settings/api-keys" />}>
              <KeyIcon />
              Get an API key
            </Button>
          </>
        }
      />
      <div className="scalar-cobalt overflow-hidden rounded-xl bg-card shadow-card">
        <ApiReferenceReact
          configuration={{
            customCss: scalarCss,
            url: openApiUrl,
            hideDarkModeToggle: true,
            forceDarkModeState: dark ? "dark" : "light",
            withDefaultFonts: false,
            // Self-hosted: nothing about the API goes to Scalar's cloud (AI agent, deploy/share
            // toolbar, telemetry).
            agent: { disabled: true },
            showDeveloperTools: "never",
            telemetry: false,
            authentication: { preferredSecurityScheme: "apiKey" },
          }}
        />
      </div>
    </Page>
  );
}
