import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ErrorAlert } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { meQuery, useSignOut } from "@/lib/auth";

// Users with no roles land here until an admin grants access (see the user-management spec).
export const Route = createFileRoute("/pending")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login" });
    if (me.user.roles.length > 0) throw redirect({ to: "/" });
    return { me };
  },
  component: Pending,
});

function Pending() {
  const { me } = Route.useRouteContext();
  const signOut = useSignOut();
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Waiting for access</CardTitle>
          <CardDescription>
            You're signed in as {me.user.name} ({me.user.email}), but you don't have any roles yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Ask an admin to grant you access. Once they do, reload this page to continue.
          </p>
          <p className="text-sm text-muted-foreground">
            Meanwhile you can manage your account in{" "}
            <Link to="/settings" className="underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
          {/* While impersonating, the banner's "Stop impersonating" is the way out. */}
          {!me.impersonatedBy && (
            <>
              <ErrorAlert error={signOut.error} />
              <Button
                variant="outline"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                Sign out
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
