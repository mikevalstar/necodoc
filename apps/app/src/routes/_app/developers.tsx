import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTheme } from "@/lib/theme";

// ADR 0030; spec: docs/features/html-to-pdf-api.md (Docs and SDK). The live /api/v1 OpenAPI
// document, with Scalar's try-it client against this deployment. Not under /api: Vite proxies it.
export const Route = createFileRoute("/_app/developers")({
  component: Developers,
});

function Developers() {
  // Subscribes to theme changes; the class on <html> says what "system" resolved to.
  useTheme();
  const dark = document.documentElement.classList.contains("dark");
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">API reference</h1>
        <p className="text-sm text-muted-foreground">
          Every <code>/api/v1</code> endpoint. Calls need an API key in <code>x-api-key</code>:{" "}
          <Link to="/settings/api-keys" className="underline">
            make one in Settings
          </Link>
          . The raw document is at{" "}
          <a href="/api/v1/openapi.json" className="underline">
            /api/v1/openapi.json
          </a>
          .
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <ApiReferenceReact
          configuration={{
            url: "/api/v1/openapi.json",
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
    </main>
  );
}
