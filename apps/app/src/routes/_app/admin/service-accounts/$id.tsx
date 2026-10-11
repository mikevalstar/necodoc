import type { updateServiceAccountSchema } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import type { z } from "zod";
import { ApiKeyTable, apiKeysQuery, CreateKeyButton, ExpiryWarning } from "@/components/api-keys";
import { HistoryPanel } from "@/components/audit";
import { ErrorAlert, useAppForm } from "@/components/form";
import { RoleBadges } from "@/components/role-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { WebhookSection } from "@/components/webhooks";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { ServiceRolesField, serviceAccountFormSchema, serviceAccountsQuery } from "./-shared";

// ADR 0029. One service account: its details, keys and webhooks.

export const Route = createFileRoute("/_app/admin/service-accounts/$id")({
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: ServiceAccount,
});

type Account = InferResponseType<(typeof api)["service-accounts"][":id"]["$get"], 200>;

function ServiceAccount() {
  const { id } = Route.useParams();
  const account = useQuery({
    queryKey: ["service-accounts", id],
    queryFn: async () => (await ok(api["service-accounts"][":id"].$get({ param: { id } }))).json(),
  });
  const keys = useQuery(apiKeysQuery({ ownerId: id }));
  const [editing, setEditing] = useState(false);
  const update = useUpdate(id);
  const data = account.data;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 py-8">
      <Link to="/admin/service-accounts" className="text-sm text-muted-foreground hover:underline">
        ← Service accounts
      </Link>
      <ErrorAlert error={account.error ?? update.error} />
      {data && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{data.name}</h1>
              {data.disabled && <Badge variant="destructive">Disabled</Badge>}
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground">Owner / contact:</span> {data.contact}
            </p>
            {data.description && (
              <p className="max-w-2xl text-sm text-muted-foreground">{data.description}</p>
            )}
            <RoleBadges roles={data.roles} />
            <p className="text-xs text-muted-foreground">
              Created {dayjs(data.createdAt).format("YYYY-MM-DD")}. Can't sign in; acts only through
              its keys.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant={data.disabled ? "outline" : "destructive"}
              disabled={update.isPending}
              onClick={() => update.mutate({ disabled: !data.disabled })}
            >
              {data.disabled ? "Enable" : "Disable"}
            </Button>
          </div>
        </div>
      )}
      {data?.disabled && (
        <p className="text-sm text-muted-foreground">
          Disabled: every call with its keys gets 401 until it's enabled again.
        </p>
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">API keys</h2>
          {data && !data.disabled && <CreateKeyButton ownerId={id} ownerRoles={data.roles} />}
        </div>
        <ErrorAlert error={keys.error} />
        <ExpiryWarning keys={keys.data} />
        <ApiKeyTable keys={keys.data} canRotate={() => true} />
      </section>
      <WebhookSection ownerId={id} keys={keys.data} canTemplateWebhooks />
      {editing && data && <EditDialog account={data} onClose={() => setEditing(false)} />}
      <HistoryPanel targetType="service_account" targetId={id} />
    </main>
  );
}

function useUpdate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (json: z.input<typeof updateServiceAccountSchema>) =>
      (await ok(api["service-accounts"][":id"].$patch({ param: { id }, json }))).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: serviceAccountsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

function EditDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const update = useUpdate(account.id);
  const defaultValues: z.input<typeof serviceAccountFormSchema> = {
    name: account.name,
    description: account.description,
    contact: account.contact,
    roles: account.roles.flatMap((role) => (role === "admin" ? [] : [role])),
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: serviceAccountFormSchema },
    onSubmit: ({ value }) => update.mutate(value, { onSuccess: onClose }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {account.name}</DialogTitle>
            <DialogDescription>
              Removing a role takes its scopes away from every key at once.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
            <form.AppField name="contact">
              {(field) => <field.TextField label="Owner or contact" />}
            </form.AppField>
            <form.AppField name="description">
              {(field) => <field.TextareaField label="Description" rows={3} />}
            </form.AppField>
            <form.AppField name="roles">{() => <ServiceRolesField />}</form.AppField>
            <ErrorAlert error={update.error} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
