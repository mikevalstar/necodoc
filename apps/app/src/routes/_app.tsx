import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { RoleBadges } from "@/components/role-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Me, meQuery, useSignOut } from "@/lib/auth";

// Signed-in users with at least one role; everyone else is sent to /login or /pending.
// Pending users may still open /settings (docs/features/user-preferences.md).
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login" });
    if (me.user.roles.length === 0 && location.pathname !== "/settings") {
      throw redirect({ to: "/pending" });
    }
    return { me };
  },
  component: AppShell,
});

const navLink = {
  className: "whitespace-nowrap text-sm hover:text-foreground",
  inactiveProps: { className: "text-muted-foreground" },
  activeProps: { className: "font-medium text-foreground" },
};

function AppShell() {
  const { me } = Route.useRouteContext();
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-6">
          <Link to="/" className="font-semibold">
            necodoc
          </Link>
          {me.user.roles.length > 0 && (
            <Link to="/" activeOptions={{ exact: true }} {...navLink}>
              Documents
            </Link>
          )}
          {me.user.roles.includes("admin") && (
            <Link to="/admin/users" {...navLink}>
              Admin › Users
            </Link>
          )}
          <div className="ml-auto">
            <UserMenu me={me} />
          </div>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

function UserMenu({ me }: { me: Me }) {
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="max-w-40" />}>
        <span className="truncate">{me.user.name}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-2">
            <div>
              <div className="font-medium text-foreground">{me.user.name}</div>
              <div className="text-xs">{me.user.email}</div>
            </div>
            <RoleBadges roles={me.user.roles} />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/settings" />}>Settings</DropdownMenuItem>
        <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
