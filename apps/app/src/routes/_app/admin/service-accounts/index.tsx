import type { createServiceAccountSchema } from "@necodoc/shared";
import { PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert, useAppForm } from "@/components/form";
import { CardBar, EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { RoleBadges } from "@/components/role-badges";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { requireAccess } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  AccountStatusBadge,
  ServiceRolesField,
  serviceAccountFormSchema,
  serviceAccountsQuery,
} from "./-shared";

// ADR 0029; spec: docs/features/html-to-pdf-api.md (keys). Identities for systems, so their keys
// outlive the people who set them up.

export const Route = createFileRoute("/_app/admin/service-accounts/")({
  beforeLoad: ({ context }) => requireAccess(context.me, "admin"),
  component: ServiceAccounts,
});

function ServiceAccounts() {
  const accounts = useQuery(serviceAccountsQuery);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <Page>
      <PageHeader
        title="Service accounts"
        description="Non-human identities for the systems that call the API. They hold roles and API keys, and can't sign in."
        actions={
          <>
            <FaqLink feature="Service accounts" />
            <Button onClick={() => setCreating(true)}>
              <PlusIcon weight="bold" />
              Create service account
            </Button>
          </>
        }
      />
      <ErrorAlert error={accounts.error} />
      {accounts.isPending && <ListSkeleton />}
      {accounts.data?.length === 0 && (
        <EmptyState
          icon={RobotIcon}
          title="No service accounts yet"
          description="Give each system that calls the API its own account, so its keys keep working when the person who set it up leaves."
          action={
            <Button onClick={() => setCreating(true)}>
              <PlusIcon weight="bold" />
              Create service account
            </Button>
          }
        />
      )}
      {!!accounts.data?.length && (
        <Card className="gap-0 py-0">
          <CardBar
            title="Accounts"
            meta={`${accounts.data.filter((account) => !account.disabled).length} active of ${accounts.data.length}`}
          >
            <DensityToggle />
          </CardBar>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner / contact</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-right">Active keys</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.data.map((account) => (
                <TableRow
                  key={account.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({ to: "/admin/service-accounts/$id", params: { id: account.id } })
                  }
                >
                  <TableCell>
                    <Link
                      to="/admin/service-accounts/$id"
                      params={{ id: account.id }}
                      className="font-semibold hover:underline"
                    >
                      {account.name}
                    </Link>
                    {account.description && (
                      <div className="max-w-72 truncate text-xs text-ink-3">
                        {account.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 truncate" title={account.contact}>
                    {account.contact}
                  </TableCell>
                  <TableCell>
                    <RoleBadges roles={account.roles} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      account.activeKeys === 0 && "text-ink-3",
                    )}
                  >
                    {account.activeKeys}
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge disabled={account.disabled} />
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-ink-2 lg:table-cell">
                    {dayjs(account.createdAt).format("YYYY-MM-DD")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {creating && <CreateServiceAccountDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}

function CreateServiceAccountDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: async (json: z.input<typeof createServiceAccountSchema>) =>
      (await ok(api["service-accounts"].$post({ json }))).json(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: serviceAccountsQuery.queryKey });
      navigate({ to: "/admin/service-accounts/$id", params: { id: created.id } });
    },
  });
  const defaultValues: z.input<typeof serviceAccountFormSchema> = {
    name: "",
    description: "",
    contact: "",
    roles: ["viewer"],
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: serviceAccountFormSchema },
    onSubmit: ({ value }) => create.mutate(value),
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
            <DialogTitle>Create service account</DialogTitle>
            <DialogDescription>
              Name it after the system. Its keys can only get scopes its roles allow.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" placeholder="Billing system" />}
            </form.AppField>
            <form.AppField name="contact">
              {(field) => (
                <field.TextField label="Owner or contact" placeholder="billing-team@example.com" />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => <field.TextareaField label="Description (optional)" rows={3} />}
            </form.AppField>
            <form.AppField name="roles">{() => <ServiceRolesField />}</form.AppField>
            <ErrorAlert error={create.error} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
