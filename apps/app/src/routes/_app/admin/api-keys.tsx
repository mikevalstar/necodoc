import { apiKeyStatusSchema } from "@necodoc/shared";
import { FunnelXIcon, KeyIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ApiKeyTable, apiKeysQuery, ExpiryWarning } from "@/components/api-keys";
import { DensityToggle, FilterSelect } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { CardBar, EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth";

// Spec: docs/features/html-to-pdf-api.md (keys). Every key across people and service accounts.
const ownerKindSchema = z.enum(["user", "service"]);
const searchSchema = z.object({
  ownerKind: ownerKindSchema.optional(),
  status: apiKeyStatusSchema.optional(),
});

export const Route = createFileRoute("/_app/admin/api-keys")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => requireAccess(context.me, "admin"),
  component: AdminApiKeys,
});

const ownerOptions = [
  { value: "user", label: "People" },
  { value: "service", label: "Service accounts" },
];
const statusOptions = apiKeyStatusSchema.options.map((status) => ({
  value: status,
  label: status.charAt(0).toUpperCase() + status.slice(1),
}));

function AdminApiKeys() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const keys = useQuery({
    ...apiKeysQuery({ all: "true", ...search }),
    placeholderData: keepPreviousData,
  });
  const filtered = search.ownerKind !== undefined || search.status !== undefined;
  const linkClass = "font-semibold text-brand-ink hover:underline";
  return (
    <Page>
      <PageHeader
        title="All API keys"
        description={
          <>
            Every key, personal and{" "}
            <Link to="/admin/service-accounts" className={linkClass}>
              service account
            </Link>
            . You can revoke any of them, and rotate service accounts' keys and your own. People
            rotate theirs under{" "}
            <Link to="/settings/api-keys" className={linkClass}>
              Developers › API keys
            </Link>
            .
          </>
        }
        actions={<FaqLink feature="API keys and scopes" />}
      />
      <ErrorAlert error={keys.error} />
      <ExpiryWarning keys={keys.data} />
      <Card className="gap-0 py-0">
        <CardBar
          title="Keys"
          meta={!!keys.data?.length && `${keys.data.length} key${keys.data.length > 1 ? "s" : ""}`}
        >
          <FilterSelect
            label="Owner"
            any="Any owner"
            value={search.ownerKind}
            options={ownerOptions}
            onChange={(value) =>
              navigate({ search: { ...search, ownerKind: ownerKindSchema.safeParse(value).data } })
            }
          />
          <FilterSelect
            label="Status"
            value={search.status}
            options={statusOptions}
            onChange={(value) =>
              navigate({ search: { ...search, status: apiKeyStatusSchema.safeParse(value).data } })
            }
          />
          {!!keys.data?.length && <DensityToggle />}
        </CardBar>
        {keys.isPending ? (
          <ListSkeleton className="p-4" />
        ) : (
          keys.data && (
            <ApiKeyTable
              keys={keys.data}
              showOwner
              canRotate={(key) => key.ownerIsService || key.ownerId === me.user.id}
              empty={
                filtered ? (
                  <EmptyState
                    className="m-4"
                    icon={FunnelXIcon}
                    title="No keys match these filters"
                    action={
                      <Button variant="outline" onClick={() => navigate({ search: {} })}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    className="m-4"
                    icon={KeyIcon}
                    title="No API keys yet"
                    description="People create their own under Developers › API keys; a system's keys belong on a service account."
                    action={
                      <Button render={<Link to="/admin/service-accounts" />}>
                        Service accounts
                      </Button>
                    }
                  />
                )
              }
            />
          )
        )}
      </Card>
    </Page>
  );
}
