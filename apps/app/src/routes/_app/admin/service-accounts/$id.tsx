import type { updateServiceAccountSchema } from "@necodoc/shared";
import { KeyIcon, PencilSimpleIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { ApiKeyTable, apiKeysQuery, CreateKeyButton, ExpiryWarning } from "@/components/api-keys";
import { HistoryPanel } from "@/components/audit";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert, useAppForm } from "@/components/form";
import {
  BackLink,
  CardBar,
  EmptyState,
  FaqLink,
  ListSkeleton,
  Page,
  PageHeader,
} from "@/components/page";
import { RoleBadges } from "@/components/role-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { usePageCrumb } from "@/lib/breadcrumb";
import { dayjs } from "@/lib/date";
import {
  AccountStatusBadge,
  ServiceRolesField,
  serviceAccountFormSchema,
  serviceAccountsQuery,
} from "./-shared";

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
  const [confirmDisable, setConfirmDisable] = useState(false);
  const update = useUpdate(id);
  const data = account.data;
  usePageCrumb(data?.name);
  const setDisabled = (disabled: boolean) =>
    update.mutate(
      { disabled },
      {
        onSuccess: () => {
          setConfirmDisable(false);
          toast.success(disabled ? `Disabled ${data?.name}` : `Enabled ${data?.name}`);
        },
      },
    );
  const activeKeys = keys.data?.filter((key) => key.status === "active").length ?? 0;
  return (
    <Page>
      <ErrorAlert error={account.error ?? (confirmDisable ? null : update.error)} />
      {account.isPending && <ListSkeleton rows={3} />}
      {data && (
        <>
          <PageHeader
            back={<BackLink to="/admin/service-accounts">Service accounts</BackLink>}
            title={data.name}
            description={data.description || "Can't sign in; acts only through its API keys."}
            actions={
              <>
                <FaqLink feature="Service accounts" />
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilSimpleIcon />
                  Edit
                </Button>
                {data.disabled ? (
                  <Button disabled={update.isPending} onClick={() => setDisabled(false)}>
                    Enable
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={() => setConfirmDisable(true)}>
                    Disable
                  </Button>
                )}
              </>
            }
          >
            <AccountStatusBadge disabled={data.disabled} />
          </PageHeader>
          {data.disabled && (
            <Alert variant="destructive">
              <ProhibitIcon />
              <AlertDescription>
                Disabled: every call with its keys gets 401 until you enable it again. Its keys and
                webhooks are kept.
              </AlertDescription>
            </Alert>
          )}
          <Card className="py-0">
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Owner / contact">
                <span className="break-words">{data.contact}</span>
              </Detail>
              <Detail label="Roles">
                <RoleBadges roles={data.roles} />
              </Detail>
              <Detail label="Active keys">
                <span className="font-heading text-lg font-extrabold tabular-nums">
                  {keys.data ? activeKeys : "–"}
                </span>
              </Detail>
              <Detail label="Created">
                <span className="font-mono text-xs">
                  {dayjs(data.createdAt).format("YYYY-MM-DD HH:mm")}
                </span>
              </Detail>
            </dl>
          </Card>
        </>
      )}
      {confirmDisable && data && (
        <ConfirmDialog
          title={`Disable ${data.name}?`}
          description="Every call with its keys gets 401 at once. The keys stay; enable it again to restore them."
          confirmLabel="Disable"
          pending={update.isPending}
          error={update.error}
          onConfirm={() => setDisabled(true)}
          onClose={() => setConfirmDisable(false)}
        />
      )}
      <ErrorAlert error={keys.error} />
      <ExpiryWarning keys={keys.data} />
      <Card className="gap-0 py-0">
        <CardBar
          title="API keys"
          description="They act as this account, with scopes up to its roles."
          meta={!!keys.data?.length && `${activeKeys} active of ${keys.data.length}`}
        >
          {!!keys.data?.length && <DensityToggle />}
          {data && !data.disabled && !!keys.data?.length && (
            <CreateKeyButton ownerId={id} ownerRoles={data.roles} />
          )}
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
                    data?.disabled
                      ? "Enable the account to create keys for it."
                      : "Create a key for the system to call /api/v1 with. The secret is shown once, when you create it."
                  }
                  action={
                    data &&
                    !data.disabled && <CreateKeyButton ownerId={id} ownerRoles={data.roles} />
                  }
                />
              }
            />
          )
        )}
      </Card>
      <WebhookSection ownerId={id} keys={keys.data} canTemplateWebhooks />
      {editing && data && <EditDialog account={data} onClose={() => setEditing(false)} />}
      <HistoryPanel targetType="service_account" targetId={id} />
    </Page>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-semibold text-ink-3">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
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
