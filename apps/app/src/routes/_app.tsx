import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router";
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
import { cn } from "@/lib/utils";

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
  const isAdmin = me.user.roles.includes("admin");
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 overflow-x-auto px-4 sm:gap-6">
          <Link to="/" className="font-semibold">
            necodoc
          </Link>
          {me.user.roles.length > 0 && (
            <>
              <Link to="/" activeOptions={{ exact: true }} {...navLink}>
                Documents
              </Link>
              {/* Templates (docs/features/document-templates.md) goes here. */}
              <Link to="/themes" {...navLink}>
                Themes
              </Link>
              <Link to="/assets" {...navLink}>
                Assets
              </Link>
              <Link to="/render" {...navLink}>
                Render
              </Link>
              <Link to="/generations" {...navLink}>
                {isAdmin ? "Generations" : "My generations"}
              </Link>
            </>
          )}
          {isAdmin && <AdminMenu />}
          <div className="ml-auto">
            <UserMenu me={me} />
          </div>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

function AdminMenu() {
  const active = useLocation({ select: (location) => location.pathname.startsWith("/admin") });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          navLink.className,
          "flex items-center gap-1",
          active ? navLink.activeProps.className : navLink.inactiveProps.className,
        )}
      >
        Admin
        <ChevronDownIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem render={<Link to="/admin/users" />}>Users</DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/admin/faq" />}>FAQ</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
