import { apiKeyStatusSchema } from "@necodoc/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ApiKeyTable, apiKeysQuery, ExpiryWarning } from "@/components/api-keys";
import { ErrorAlert } from "@/components/form";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

// Spec: docs/features/html-to-pdf-api.md (keys). Every key across people and service accounts.
const ownerKindSchema = z.enum(["user", "service"]);
const searchSchema = z.object({
  ownerKind: ownerKindSchema.optional(),
  status: apiKeyStatusSchema.optional(),
});

export const Route = createFileRoute("/_app/admin/api-keys")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: AdminApiKeys,
});

function AdminApiKeys() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const keys = useQuery({
    ...apiKeysQuery({ all: "true", ...search }),
    placeholderData: keepPreviousData,
  });
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Every key, personal and service account. Revoke any; rotate service accounts' keys (and
          your own). People rotate their own in Settings.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor="ownerKind">Owner</FieldLabel>
          <NativeSelect
            id="ownerKind"
            value={search.ownerKind ?? ""}
            onChange={(e) =>
              navigate({
                search: { ...search, ownerKind: ownerKindSchema.safeParse(e.target.value).data },
              })
            }
          >
            <NativeSelectOption value="">Anyone</NativeSelectOption>
            <NativeSelectOption value="user">People</NativeSelectOption>
            <NativeSelectOption value="service">Service accounts</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="status">Status</FieldLabel>
          <NativeSelect
            id="status"
            value={search.status ?? ""}
            onChange={(e) =>
              navigate({
                search: { ...search, status: apiKeyStatusSchema.safeParse(e.target.value).data },
              })
            }
          >
            <NativeSelectOption value="">Any</NativeSelectOption>
            {apiKeyStatusSchema.options.map((status) => (
              <NativeSelectOption key={status} value={status} className="capitalize">
                {status}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <ErrorAlert error={keys.error} />
      <ExpiryWarning keys={keys.data} />
      <ApiKeyTable
        keys={keys.data}
        showOwner
        canRotate={(key) => key.ownerIsService || key.ownerId === me.user.id}
      />
    </main>
  );
}
