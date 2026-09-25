import { changePasswordSchema, deleteAccountSchema, updateProfileSchema } from "@necodoc/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import { RoleBadges } from "@/components/role-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient, type Me, unwrap, useSessionChange, useUserMutation } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { setTheme, themes, useTheme } from "@/lib/theme";

// Spec: docs/features/user-preferences.md
export const Route = createFileRoute("/_app/settings")({
  component: Settings,
});

function Settings() {
  const { me } = Route.useRouteContext();
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ProfileCard me={me} />
      {me.impersonatedBy ? (
        // Impersonation sessions are hidden from the session list, and the password and
        // account belong to the user, not the admin: manage those from Admin > Users.
        <Alert>
          <AlertDescription>
            You're impersonating this user. Password, sessions and account deletion are hidden.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <PasswordCard />
          <SessionsCard />
        </>
      )}
      <ThemeCard />
      {!me.impersonatedBy && <DeleteAccountCard />}
    </main>
  );
}

function StatusAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert role="status">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const update = useUserMutation((value: z.infer<typeof updateProfileSchema>) =>
    unwrap(authClient.updateUser(value)),
  );
  const form = useAppForm({
    defaultValues: { name: me.user.name },
    validators: { onChange: updateProfileSchema },
    // Editing again clears the last result, so a stale "Saved" never sits next to a new error.
    listeners: { onChange: () => update.reset() },
    onSubmit: ({ value }) => update.mutate(value),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Only an admin can change your email or roles; there is no way to verify a new email yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" autoComplete="name" />}
            </form.AppField>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" value={me.user.email} readOnly disabled />
            </Field>
            <Field>
              <FieldLabel>Roles</FieldLabel>
              {me.user.roles.length > 0 ? (
                <RoleBadges roles={me.user.roles} />
              ) : (
                <div>
                  <Badge variant="outline">Pending</Badge>
                </div>
              )}
            </Field>
            <ErrorAlert error={update.error} />
            <StatusAlert message={update.isSuccess ? "Saved your name." : null} />
            <Button type="submit" className="w-fit" disabled={update.isPending}>
              Save
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const change = useUserMutation(
    ({ currentPassword, newPassword, revokeOtherSessions }: z.infer<typeof changePasswordSchema>) =>
      unwrap(authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })),
    () => form.reset(),
  );
  const defaultValues: z.infer<typeof changePasswordSchema> = {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    revokeOtherSessions: false,
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: changePasswordSchema },
    listeners: { onChange: () => change.reset() },
    onSubmit: ({ value }) => change.mutate(value),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField name="currentPassword">
              {(field) => (
                <field.TextField
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </form.AppField>
            <form.AppField name="newPassword">
              {(field) => (
                <field.TextField label="New password" type="password" autoComplete="new-password" />
              )}
            </form.AppField>
            <form.AppField name="confirmPassword">
              {(field) => (
                <field.TextField
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                />
              )}
            </form.AppField>
            <form.AppField name="revokeOtherSessions">
              {(field) => <field.CheckboxField label="Sign out my other devices" />}
            </form.AppField>
            <ErrorAlert error={change.error} />
            <StatusAlert
              message={
                change.isSuccess
                  ? change.variables.revokeOtherSessions
                    ? "Changed your password and signed out your other devices."
                    : "Changed your password."
                  : null
              }
            />
            <Button type="submit" className="w-fit" disabled={change.isPending}>
              Change password
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: async () => {
    const [sessions, current] = await Promise.all([
      unwrap(authClient.listSessions()),
      unwrap(authClient.getSession()),
    ]);
    return { sessions, currentToken: current?.session.token };
  },
});

function SessionsCard() {
  const sessions = useQuery(sessionsQuery);
  const queryClient = useQueryClient();
  // One session by token, or every other session. It changes no user data, so only the
  // list is refetched.
  const revoke = useMutation({
    mutationFn: (token: string | undefined) =>
      token
        ? unwrap(authClient.revokeSession({ token }))
        : unwrap(authClient.revokeOtherSessions()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
  });
  const currentToken = sessions.data?.currentToken;
  // This device first, then the most recently refreshed.
  const list = sessions.data?.sessions?.toSorted(
    (a, b) =>
      Number(b.token === currentToken) - Number(a.token === currentToken) ||
      dayjs(b.updatedAt).valueOf() - dayjs(a.updatedAt).valueOf(),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorAlert error={sessions.error ?? revoke.error} />
        <StatusAlert
          message={
            revoke.isSuccess
              ? revoke.variables
                ? "Signed out that device."
                : "Signed out every other device."
              : null
          }
        />
        <ul className="divide-y rounded-lg border">
          {list?.map((session) => {
            const isCurrent = session.token === currentToken;
            return (
              <li key={session.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="truncate" title={session.userAgent ?? undefined}>
                      {session.userAgent || "Unknown device"}
                    </span>
                    {isCurrent && <Badge variant="secondary">This device</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {session.ipAddress || "Unknown IP"} · signed in{" "}
                    {dayjs(session.createdAt).format("YYYY-MM-DD HH:mm")} · last active{" "}
                    {dayjs(session.updatedAt).fromNow()}
                  </div>
                </div>
                {!isCurrent && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(session.token)}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          variant="outline"
          disabled={revoke.isPending || (list?.length ?? 0) <= 1}
          onClick={() => revoke.mutate(undefined)}
        >
          Sign out all other devices
        </Button>
      </CardContent>
    </Card>
  );
}

function ThemeCard() {
  const theme = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>Saved in this browser only.</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="flex gap-2">
          <legend className="sr-only">Theme</legend>
          {themes.map((option) => (
            <Button
              key={option}
              variant={theme === option ? "default" : "outline"}
              aria-pressed={theme === option}
              className="capitalize"
              onClick={() => setTheme(option)}
            >
              {option}
            </Button>
          ))}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const sessionChanged = useSessionChange();
  const remove = useMutation({
    mutationFn: ({ password }: z.infer<typeof deleteAccountSchema>) =>
      unwrap(authClient.deleteUser({ password })),
    onSuccess: () => sessionChanged("/login"),
  });
  const form = useAppForm({
    defaultValues: { password: "" },
    validators: { onChange: deleteAccountSchema },
    onSubmit: ({ value }) => remove.mutate(value),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete my account</CardTitle>
        <CardDescription>
          Permanently deletes your account and signs you out everywhere. It can't be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              form.reset();
              remove.reset();
            }
          }}
        >
          <DialogContent>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogDescription>
                  Enter your password to confirm. Your account and sessions are deleted for good.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <form.AppField name="password">
                  {(field) => (
                    <field.TextField
                      label="Password"
                      type="password"
                      autoComplete="current-password"
                    />
                  )}
                </form.AppField>
                <ErrorAlert error={remove.error} />
              </FieldGroup>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button type="submit" variant="destructive" disabled={remove.isPending}>
                  Delete my account
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
