import {
  banUserSchema,
  createUserSchema,
  parseRoles,
  setPasswordSchema,
  setRolesSchema,
  updateUserDetailsSchema,
} from "@necodoc/shared";
import type { UserWithRole } from "better-auth/plugins";
import type { ReactNode } from "react";
import type { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { authClient, unwrap, useUserMutation } from "@/lib/auth";

// Admin > Users actions. Spec: docs/features/user-management-and-roles.md

/** `onDone` closes the dialog with a message saying what happened. */
type DialogProps = { user: UserWithRole; onClose: () => void; onDone: (message: string) => void };

function FormDialog({
  title,
  description,
  submitLabel,
  destructive,
  pending,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description: ReactNode;
  submitLabel: string;
  destructive?: boolean;
  pending: boolean;
  error: Error | null;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {children}
            <ErrorAlert error={error} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateUserDialog({ onClose, onDone }: Omit<DialogProps, "user">) {
  const create = useUserMutation(
    (value: z.infer<typeof createUserSchema>) => unwrap(authClient.admin.createUser(value)),
    (value) => onDone(`Created ${value.name}.`),
  );
  const defaultValues: z.infer<typeof createUserSchema> = {
    name: "",
    email: "",
    password: "",
    role: [],
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: createUserSchema },
    onSubmit: ({ value }) => create.mutate(value),
  });
  return (
    <FormDialog
      title="Create user"
      description="Share the password with them yourself; there is no invite email."
      submitLabel="Create user"
      pending={create.isPending}
      error={create.error}
      onSubmit={form.handleSubmit}
      onClose={onClose}
    >
      <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField label="Email" type="email" />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => (
          <field.TextField label="Password" type="password" autoComplete="new-password" />
        )}
      </form.AppField>
      <form.AppField name="role">{(field) => <field.RolesField />}</form.AppField>
    </FormDialog>
  );
}

export function EditDetailsDialog({ user, onClose, onDone }: DialogProps) {
  const update = useUserMutation(
    (data: z.infer<typeof updateUserDetailsSchema>) =>
      unwrap(authClient.admin.updateUser({ userId: user.id, data })),
    (value) => onDone(`Saved details for ${value.name}.`),
  );
  const form = useAppForm({
    defaultValues: { name: user.name, email: user.email },
    validators: { onChange: updateUserDetailsSchema },
    onSubmit: ({ value }) => update.mutate(value),
  });
  return (
    <FormDialog
      title="Edit details"
      description={`${user.name} signs in with the email set here. There is no confirmation email, so tell them.`}
      submitLabel="Save details"
      pending={update.isPending}
      error={update.error}
      onSubmit={form.handleSubmit}
      onClose={onClose}
    >
      <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField label="Email" type="email" />}
      </form.AppField>
    </FormDialog>
  );
}

export function EditRolesDialog({ user, onClose, onDone }: DialogProps) {
  const setRoles = useUserMutation(
    ({ role }: z.infer<typeof setRolesSchema>) =>
      unwrap(authClient.admin.setRole({ userId: user.id, role })),
    () => onDone(`Saved roles for ${user.name}.`),
  );
  const form = useAppForm({
    defaultValues: { role: parseRoles(user.role) },
    validators: { onChange: setRolesSchema },
    onSubmit: ({ value }) => setRoles.mutate(value),
  });
  return (
    <FormDialog
      title="Edit roles"
      description={`${user.name} gets every permission of every role checked. No roles means pending.`}
      submitLabel="Save roles"
      pending={setRoles.isPending}
      error={setRoles.error}
      onSubmit={form.handleSubmit}
      onClose={onClose}
    >
      <form.AppField name="role">{(field) => <field.RolesField />}</form.AppField>
    </FormDialog>
  );
}

export function BanUserDialog({ user, onClose, onDone }: DialogProps) {
  const ban = useUserMutation(
    ({ banReason }: z.infer<typeof banUserSchema>) =>
      unwrap(authClient.admin.banUser({ userId: user.id, banReason: banReason || undefined })),
    () => onDone(`Banned ${user.name}.`),
  );
  const form = useAppForm({
    defaultValues: { banReason: "" },
    validators: { onChange: banUserSchema },
    onSubmit: ({ value }) => ban.mutate(value),
  });
  return (
    <FormDialog
      title="Ban user"
      description={`${user.name} is signed out everywhere and can't sign in until unbanned.`}
      submitLabel="Ban user"
      destructive
      pending={ban.isPending}
      error={ban.error}
      onSubmit={form.handleSubmit}
      onClose={onClose}
    >
      <form.AppField name="banReason">
        {(field) => <field.TextField label="Reason (optional)" />}
      </form.AppField>
    </FormDialog>
  );
}

export function SetPasswordDialog({ user, onClose, onDone }: DialogProps) {
  const setPassword = useUserMutation(
    ({ newPassword }: z.infer<typeof setPasswordSchema>) =>
      unwrap(authClient.admin.setUserPassword({ userId: user.id, newPassword })),
    () => onDone(`Set a new password for ${user.name}.`),
  );
  const form = useAppForm({
    defaultValues: { newPassword: "" },
    validators: { onChange: setPasswordSchema },
    onSubmit: ({ value }) => setPassword.mutate(value),
  });
  return (
    <FormDialog
      title="Set password"
      description={`Set a new password for ${user.name} and share it with them.`}
      submitLabel="Set password"
      pending={setPassword.isPending}
      error={setPassword.error}
      onSubmit={form.handleSubmit}
      onClose={onClose}
    >
      <form.AppField name="newPassword">
        {(field) => (
          <field.TextField label="New password" type="password" autoComplete="new-password" />
        )}
      </form.AppField>
    </FormDialog>
  );
}

export function DeleteUserDialog({ user, onClose, onDone }: DialogProps) {
  const remove = useUserMutation<void>(
    () => unwrap(authClient.admin.removeUser({ userId: user.id })),
    () => onDone(`Deleted ${user.name}.`),
  );
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {user.email} and their sessions. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete user
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
