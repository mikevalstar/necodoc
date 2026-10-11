import type { createServiceAccountSchema } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { ServiceRolesField, serviceAccountFormSchema, serviceAccountsQuery } from "./-shared";

// ADR 0029; spec: docs/features/html-to-pdf-api.md (keys). Identities for systems, so their keys
// outlive the people who set them up.

export const Route = createFileRoute("/_app/admin/service-accounts/")({
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: ServiceAccounts,
});

function ServiceAccounts() {
  const accounts = useQuery(serviceAccountsQuery);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Service accounts</h1>
          <p className="text-sm text-muted-foreground">
            Non-human identities for the systems that call the API. They hold roles and API keys,
            and can't sign in.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Create service account</Button>
      </div>
      <ErrorAlert error={accounts.error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Owner / contact</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead className="text-right">Active keys</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.data?.map((account) => (
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
                  className="font-medium hover:underline"
                >
                  {account.name}
                </Link>
                {account.description && (
                  <div className="max-w-72 truncate text-xs text-muted-foreground">
                    {account.description}
                  </div>
                )}
              </TableCell>
              <TableCell>{account.contact}</TableCell>
              <TableCell>
                <RoleBadges roles={account.roles} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{account.activeKeys}</TableCell>
              <TableCell>
                {account.disabled ? (
                  <Badge variant="destructive">Disabled</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">Active</span>
                )}
              </TableCell>
              <TableCell className="hidden tabular-nums md:table-cell">
                {dayjs(account.createdAt).format("YYYY-MM-DD")}
              </TableCell>
            </TableRow>
          ))}
          {accounts.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No service accounts yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {creating && <CreateServiceAccountDialog onClose={() => setCreating(false)} />}
    </main>
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
