import { hasPermission } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ApiKeyTable, apiKeysQuery, CreateKeyButton, ExpiryWarning } from "@/components/api-keys";
import { ErrorAlert } from "@/components/form";
import { WebhookSection } from "@/components/webhooks";

// Spec: docs/features/html-to-pdf-api.md (keys), docs/features/webhooks.md. Your own keys; a
// system's keys belong on a service account (Admin › Service accounts) so they outlive you.
export const Route = createFileRoute("/_app/settings_/api-keys")({
  component: ApiKeys,
});

function ApiKeys() {
  const { me } = Route.useRouteContext();
  const keys = useQuery(apiKeysQuery({}));
  const isAdmin = me.user.roles.includes("admin");
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Personal keys for <code>/api/v1</code>, acting as you with the scopes you pick. For a
            system that should keep working after you leave,{" "}
            {isAdmin ? (
              <Link to="/admin/service-accounts" className="underline">
                use a service account
              </Link>
            ) : (
              "ask an admin for a service account"
            )}
            . See the{" "}
            <Link to="/developers" className="underline">
              API reference
            </Link>
            .
          </p>
        </div>
        <CreateKeyButton ownerRoles={me.user.roles} />
      </div>
      <ErrorAlert error={keys.error} />
      <ExpiryWarning keys={keys.data} />
      <ApiKeyTable keys={keys.data} canRotate={() => true} />
      <WebhookSection
        keys={keys.data}
        canTemplateWebhooks={hasPermission(me.user.roles, { document: ["edit"] })}
      />
    </main>
  );
}
