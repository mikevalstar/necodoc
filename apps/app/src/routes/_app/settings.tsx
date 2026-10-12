import { changePasswordSchema, deleteAccountSchema, updateProfileSchema } from "@necodoc/shared";
import {
  DesktopIcon,
  DeviceMobileIcon,
  EyeClosedIcon,
  ListDashesIcon,
  MonitorIcon,
  MoonIcon,
  RowsIcon,
  SunIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { DemoLock, useDemoMode } from "@/components/demo-lock";
import { ErrorAlert, useAppForm } from "@/components/form";
import { setStatusBar, useStatusBar } from "@/components/ops-status-bar";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { RoleBadges } from "@/components/role-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, type Me, unwrap, useSessionChange, useUserMutation } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { type Density, setDensity, useDensity } from "@/lib/density";
import { setTheme, type Theme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Spec: docs/features/user-preferences.md
export const Route = createFileRoute("/_app/settings")({
  component: Settings,
});

function Settings() {
  const { me } = Route.useRouteContext();
  // The public demo's account is everyone's: its password, sessions and deletion are off (ADR 0046).
  const demo = useDemoMode();
  return (
    <Page width="narrow">
      <PageHeader
        title="Settings"
        description="Your profile, password, signed-in devices and how necodoc looks."
        actions={<FaqLink feature="Settings and preferences" />}
      />
      <ProfileCard me={me} />
      {demo ? (
        <Alert>
          <AlertDescription>
            This is the public demo's shared account. Password, sessions and account deletion are
            turned off.
          </AlertDescription>
        </Alert>
      ) : me.impersonatedBy ? (
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
      <AppearanceCard isAdmin={me.user.roles.includes("admin")} />
      {me.user.roles.length > 0 && <ApiKeysCard />}
      {!me.impersonatedBy && !demo && <DangerZone />}
    </Page>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const update = useUserMutation(
    (value: z.infer<typeof updateProfileSchema>) => unwrap(authClient.updateUser(value)),
    () => toast.success("Saved your name"),
  );
  const form = useAppForm({
    defaultValues: { name: me.user.name },
    validators: { onChange: updateProfileSchema },
    // Editing again clears the last error.
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
      {/* `contents` lets the form span the card body and its footer. */}
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <CardContent>
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
                  <Badge variant="warn" dot>
                    Pending
                  </Badge>
                </div>
              )}
            </Field>
            <ErrorAlert error={update.error} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <DemoLock>
            <Button type="submit" disabled={update.isPending}>
              Save name
            </Button>
          </DemoLock>
        </CardFooter>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const change = useUserMutation(
    ({ currentPassword, newPassword, revokeOtherSessions }: z.infer<typeof changePasswordSchema>) =>
      unwrap(authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })),
    ({ revokeOtherSessions }) => {
      form.reset();
      toast.success(
        revokeOtherSessions
          ? "Changed your password and signed out your other devices"
          : "Changed your password",
      );
    },
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
        <CardTitle>Password</CardTitle>
        <CardDescription>You need your current password to set a new one.</CardDescription>
      </CardHeader>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <CardContent>
          <FieldGroup>
            <form.AppField name="currentPassword">
              {(field) => (
                <field.PasswordField label="Current password" autoComplete="current-password" />
              )}
            </form.AppField>
            <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2">
              <form.AppField name="newPassword">
                {(field) => (
                  <field.PasswordField label="New password" autoComplete="new-password" />
                )}
              </form.AppField>
              <form.AppField name="confirmPassword">
                {(field) => (
                  <field.PasswordField label="Confirm new password" autoComplete="new-password" />
                )}
              </form.AppField>
            </div>
            <form.AppField name="revokeOtherSessions">
              {(field) => <field.CheckboxField label="Sign out my other devices" />}
            </form.AppField>
            <ErrorAlert error={change.error} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={change.isPending}>
            Change password
          </Button>
        </CardFooter>
      </form>
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

// Enough to tell devices apart ("Chrome on macOS"); the raw string stays in the tooltip.
// Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
const browsers = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
] as const;
const systems = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux|X11/, "Linux"],
] as const;

function describeDevice(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  const browser = browsers.find(([token]) => ua.includes(token))?.[1];
  // Not a browser: a script or tool such as curl. Show its product token.
  if (!browser) {
    const tool = ua.split(/[/ ]/)[0];
    return tool
      ? { name: tool, kind: "tool" as const }
      : { name: "Unknown device", kind: "desktop" as const };
  }
  const system = systems.find(([pattern]) => pattern.test(ua))?.[1];
  return {
    name: system ? `${browser} on ${system}` : browser,
    kind: /iPhone|Android|Mobile/.test(ua) ? ("mobile" as const) : ("desktop" as const),
  };
}

const deviceIcons = {
  desktop: DesktopIcon,
  mobile: DeviceMobileIcon,
  tool: TerminalWindowIcon,
};

// Long lists (scripts sign in a lot) collapse to the most recent few.
const sessionPreview = 5;

function SessionsCard() {
  const sessions = useQuery(sessionsQuery);
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  // One session by token, or every other session. It changes no user data, so only the
  // list is refetched.
  const revoke = useMutation({
    mutationFn: (token: string | undefined) =>
      token
        ? unwrap(authClient.revokeSession({ token }))
        : unwrap(authClient.revokeOtherSessions()),
    onSuccess: (_, token) => {
      toast.success(token ? "Signed out that device" : "Signed out every other device");
      return queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey });
    },
  });
  const currentToken = sessions.data?.currentToken;
  // This device first, then the most recently refreshed.
  const list =
    sessions.data?.sessions?.toSorted(
      (a, b) =>
        Number(b.token === currentToken) - Number(a.token === currentToken) ||
        dayjs(b.updatedAt).valueOf() - dayjs(a.updatedAt).valueOf(),
    ) ?? [];
  const shown = showAll ? list : list.slice(0, sessionPreview);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          {sessions.data
            ? `${list.length} ${list.length === 1 ? "device is" : "devices are"} signed in to your account.`
            : "Devices signed in to your account."}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={revoke.isPending || list.length <= 1}
            onClick={() => revoke.mutate(undefined)}
          >
            Sign out all other devices
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorAlert error={sessions.error ?? revoke.error} />
        {sessions.isPending && <Skeleton className="h-28 w-full" />}
        <ul className="divide-y divide-hair empty:hidden">
          {shown.map((session) => {
            const isCurrent = session.token === currentToken;
            const device = describeDevice(session.userAgent);
            const Icon = deviceIcons[device.kind];
            return (
              <li key={session.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-tint text-ink-2 [&>svg]:size-5">
                  <Icon />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold" title={session.userAgent ?? undefined}>
                      {device.name}
                    </span>
                    {isCurrent && (
                      <Badge variant="ok" dot>
                        This device
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-ink-3">
                    {session.ipAddress ? (
                      <span className="font-mono">{session.ipAddress}</span>
                    ) : (
                      "Unknown IP"
                    )}{" "}
                    · signed in{" "}
                    <span className="font-mono">
                      {dayjs(session.createdAt).format("YYYY-MM-DD HH:mm")}
                    </span>{" "}
                    · last active {dayjs(session.updatedAt).fromNow()}
                  </div>
                </div>
                {!isCurrent && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={revoke.isPending}
                    aria-label={`Sign out ${device.name}, signed in ${dayjs(session.createdAt).format("YYYY-MM-DD HH:mm")}`}
                    onClick={() => revoke.mutate(session.token)}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {list.length > sessionPreview && (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${list.length} sessions`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// A tint segmented control, the same look as the density toggle above tables.
function Segmented<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: T;
  options: readonly { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="space-y-0.5">
        <div id={id} className="font-semibold">
          {label}
        </div>
        <div className="text-xs text-ink-3">{hint}</div>
      </div>
      <fieldset aria-labelledby={id} className="flex gap-0.5 rounded-[10px] bg-tint p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold text-ink-2 hover:text-ink [&>svg]:size-4",
              value === option.value && "bg-surface text-ink shadow-card",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

const themeOptions = [
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
  { value: "system", label: "System", icon: <MonitorIcon /> },
] as const satisfies readonly { value: Theme; label: string; icon: ReactNode }[];

const densityOptions = [
  { value: "comfortable", label: "Comfortable", icon: <RowsIcon /> },
  { value: "compact", label: "Compact", icon: <ListDashesIcon weight="bold" /> },
] as const satisfies readonly { value: Density; label: string; icon: ReactNode }[];

const statusBarOptions = [
  { value: "off", label: "Off", icon: <EyeClosedIcon /> },
  { value: "on", label: "On", icon: <TerminalWindowIcon /> },
] as const satisfies readonly { value: "on" | "off"; label: string; icon: ReactNode }[];

function AppearanceCard({ isAdmin }: { isAdmin: boolean }) {
  const statusBar = useStatusBar();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Saved in this browser only.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-hair">
        <Segmented
          label="Theme"
          hint="System follows your device's light or dark setting."
          value={useTheme()}
          options={themeOptions}
          onChange={setTheme}
        />
        <Segmented
          label="Table rows"
          hint="Compact fits more rows on screen; same as the toggle above tables."
          value={useDensity()}
          options={densityOptions}
          onChange={setDensity}
        />
        {isAdmin && (
          <Segmented
            label="Ops status bar"
            hint="Queue, workers, render time and failures along the bottom of every page."
            value={statusBar ? "on" : "off"}
            options={statusBarOptions}
            onChange={(value) => setStatusBar(value === "on")}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeysCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Personal keys and webhooks for calling necodoc from your own code, under Developers › API
          keys.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/settings/api-keys" />}
          >
            Manage API keys
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

function DangerZone() {
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
    <section aria-labelledby="danger-zone" className="space-y-3 pt-4">
      <h2 id="danger-zone" className="font-heading text-[15px] font-bold text-bad">
        Danger zone
      </h2>
      <Card className="ring-1 ring-bad/30">
        <CardHeader>
          <CardTitle>Delete my account</CardTitle>
          <CardDescription>
            Permanently deletes your account and signs you out everywhere. It can't be undone.
          </CardDescription>
          <CardAction>
            <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
              Delete my account
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
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
                  <field.PasswordField label="Password" autoComplete="current-password" />
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
    </section>
  );
}
