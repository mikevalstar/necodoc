import { returnPathSchema } from "@necodoc/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { AuthFrame } from "@/components/auth-frame";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { meQuery, useSessionChange, useSignOut } from "@/lib/auth";

// Users with no roles land here until an admin grants access (see the user-management spec).
// ?redirect= is the page to go on to once granted a role (docs/features/app-shell-and-navigation.md).
export const Route = createFileRoute("/pending")({
  validateSearch: z.object({ redirect: returnPathSchema }),
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login", search });
    if (me.user.roles.length > 0) throw redirect({ href: search.redirect ?? "/" });
    return { me };
  },
  component: Pending,
});

function Pending() {
  const { me } = Route.useRouteContext();
  const search = Route.useSearch();
  const signOut = useSignOut();
  const queryClient = useQueryClient();
  const sessionChanged = useSessionChange();
  const check = useMutation({
    mutationFn: () => queryClient.fetchQuery({ ...meQuery, staleTime: 0 }),
    onSuccess: (fresh) => {
      if (!fresh) return sessionChanged("/login");
      if (fresh.user.roles.length > 0) return sessionChanged(search.redirect ?? "/");
      toast("No access yet", { description: "An admin still needs to give you a role." });
    },
  });
  return (
    <AuthFrame
      title="Waiting for access"
      description="An admin needs to give your account a role before you can use necodoc."
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-tint px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{me.user.name}</p>
            <p className="truncate text-sm text-ink-2">{me.user.email}</p>
          </div>
          <Badge variant="warn" dot>
            Pending
          </Badge>
        </div>
        <p className="text-sm text-ink-2">
          Ask an admin to grant you access, then check again. Meanwhile you can manage your account
          in{" "}
          <Link
            to="/settings"
            className="font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            Settings
          </Link>
          .
        </p>
        <ErrorAlert error={check.error ?? signOut.error} />
        <div className="flex flex-col gap-2">
          <Button disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? "Checking…" : "Check again"}
          </Button>
          {/* While impersonating, the banner's "Stop impersonating" is the way out. */}
          {!me.impersonatedBy && (
            <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          )}
        </div>
      </div>
    </AuthFrame>
  );
}
