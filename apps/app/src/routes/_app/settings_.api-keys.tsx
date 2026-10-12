import { hasPermission } from "@necodoc/shared";
import { KeyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ApiKeyTable, apiKeysQuery, CreateKeyButton, ExpiryWarning } from "@/components/api-keys";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { CardBar, EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";
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
  const active = keys.data?.filter((key) => key.status === "active").length ?? 0;
  return (
    <Page>
      <PageHeader
        title="API keys"
        actions={
          <>
            <FaqLink feature="API keys and scopes" />
            <CreateKeyButton ownerRoles={me.user.roles} />
          </>
        }
        description={
          <>
            Personal keys for <code className="font-mono text-[14px]">/api/v1</code> that act as
            you, with only the scopes you pick. For a system that should outlive your account,{" "}
            {isAdmin ? (
              <Link
                to="/admin/service-accounts"
                className="font-semibold text-brand-ink hover:underline"
              >
                use a service account
              </Link>
            ) : (
              "ask an admin for a service account"
            )}
            . See the{" "}
            <Link to="/developers" className="font-semibold text-brand-ink hover:underline">
              API reference
            </Link>
            .
          </>
        }
      />
      <ErrorAlert error={keys.error} />
      <ExpiryWarning keys={keys.data} />
      <Card className="gap-0 py-0">
        <CardBar
          title="Your keys"
          meta={keys.isSuccess && keys.data.length > 0 && `${active} active of ${keys.data.length}`}
        >
          {keys.isSuccess && keys.data.length > 0 && <DensityToggle />}
        </CardBar>
        {keys.isPending ? (
          <ListSkeleton className="p-4" rows={3} />
        ) : (
          keys.data && (
            <ApiKeyTable
              keys={keys.data}
              canRotate={() => true}
              empty={
                <EmptyState
                  className="m-4"
                  icon={KeyIcon}
                  title="No API keys yet"
                  description={
                    <>
                      A key lets a script or another system call <code>/api/v1</code> as you. The
                      secret is shown once, when you create it.
                    </>
                  }
                  action={<CreateKeyButton ownerRoles={me.user.roles} />}
                />
              }
            />
          )
        )}
      </Card>
      <WebhookSection
        keys={keys.data}
        canTemplateWebhooks={hasPermission(me.user.roles, { document: ["edit"] })}
      />
    </Page>
  );
}
