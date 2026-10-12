import { hasPermission } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  type LinkProps,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { ChartColumnIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notifications";
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
import { shareLinksQuery } from "@/lib/queries";
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

type Roles = Me["user"]["roles"];
type NavItem = {
  to: LinkProps["to"];
  label: string | ((roles: Roles) => string);
  /** Shows the count of unseen share-link responses. */
  unseen?: true;
  show?: (roles: Roles) => boolean;
};
type NavSection = {
  label: string;
  /** Path prefixes that belong to the section, so detail pages keep it highlighted. */
  paths: readonly string[];
  items: readonly NavItem[];
  show?: (roles: Roles) => boolean;
};

const can = (roles: Roles, actions: readonly ("create" | "edit" | "review" | "publish")[]) =>
  actions.some((action) => hasPermission(roles, { document: [action] }));

// Grouped by who uses it: people filling documents, template designers, developers, admins.
const sections: readonly NavSection[] = [
  {
    label: "Documents",
    paths: ["/", "/documents", "/share-links"],
    items: [
      { to: "/", label: "My documents" },
      { to: "/share-links", label: "Share links", unseen: true, show: (r) => can(r, ["publish"]) },
    ],
  },
  {
    label: "Templates",
    paths: ["/templates", "/snippets", "/themes", "/assets"],
    items: [
      { to: "/templates", label: "Templates" },
      {
        to: "/templates/reviews",
        label: "Reviews",
        show: (r) => can(r, ["edit", "review", "publish"]),
      },
      {
        to: "/snippets",
        label: "Snippets",
        show: (r) => can(r, ["create", "edit", "review", "publish"]),
      },
      { to: "/themes", label: "Themes" },
      { to: "/assets", label: "Assets" },
    ],
  },
  {
    label: "Developers",
    paths: ["/developers", "/render", "/generations", "/batches", "/settings/api-keys"],
    items: [
      { to: "/developers", label: "API reference" },
      { to: "/settings/api-keys", label: "API keys" },
      { to: "/render", label: "Render playground" },
      {
        to: "/generations",
        label: (r) => (r.includes("admin") ? "Generations" : "My generations"),
      },
      { to: "/batches", label: "Batches" },
    ],
  },
  {
    label: "Admin",
    paths: ["/admin"],
    show: (r) => r.includes("admin"),
    items: [
      { to: "/admin/users", label: "Users" },
      { to: "/admin/service-accounts", label: "Service accounts" },
      { to: "/admin/api-keys", label: "API keys" },
      { to: "/admin/system", label: "System" },
      { to: "/admin/queue", label: "Queue" },
      { to: "/admin/analytics", label: "Analytics" },
      { to: "/admin/audit", label: "Audit log" },
      { to: "/admin/privacy", label: "Data subjects" },
      { to: "/admin/faq", label: "FAQ" },
    ],
  },
];

const inPath = (path: string, pathname: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);

const inSection = (section: NavSection, pathname: string) =>
  section.paths.some((path) => inPath(path, pathname));

function AppShell() {
  const { me } = Route.useRouteContext();
  const roles = me.user.roles;
  const pathname = useLocation({ select: (location) => location.pathname });
  const visible = roles.length ? sections.filter((section) => section.show?.(roles) ?? true) : [];
  const current = visible.find((section) => inSection(section, pathname));
  const currentItems = current?.items.filter((item) => item.show?.(roles) ?? true) ?? [];
  // The longest matching path wins: /templates/reviews is Reviews, /templates/abc is Templates,
  // /documents/abc falls back to the section's first page.
  const currentItem =
    currentItems
      .filter((item) => item.to && item.to !== "/" && inPath(item.to, pathname))
      .sort((a, b) => String(b.to).length - String(a.to).length)[0] ?? currentItems[0];
  return (
    <div className="min-h-svh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="flex h-14 items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            to="/"
            className="mr-2 flex items-center gap-2 font-semibold"
            aria-label="necodoc home"
          >
            <Logo />
            <span className="hidden sm:inline">necodoc</span>
          </Link>
          <nav aria-label="Sections" className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {visible.map((section) => (
              <Link
                key={section.label}
                to={section.items[0]?.to}
                activeOptions={{ exact: true }}
                aria-current={section === current ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground",
                  section === current
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {section.label}
                {section.items.some((item) => item.unseen && (item.show?.(roles) ?? true)) && (
                  <UnseenResponses />
                )}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {roles.length > 0 && <NotificationBell />}
            <UserMenu me={me} />
          </div>
        </div>
        {currentItems.length > 1 && (
          <nav
            aria-label={current?.label}
            className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6"
          >
            {currentItems.map((item) => (
              <Link
                key={String(item.to)}
                to={item.to}
                // Highlighting is ours (currentItem); keep the router's own aria-current to exact.
                activeOptions={{ exact: true }}
                aria-current={item === currentItem ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-2.5 py-2 text-sm whitespace-nowrap transition-colors hover:text-foreground",
                  item === currentItem
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {typeof item.label === "string" ? item.label : item.label(roles)}
                {item.unseen && <UnseenResponses />}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <Outlet />
    </div>
  );
}

/** How many share-link responses arrived since each link was last opened. */
function UnseenResponses() {
  const links = useQuery({ ...shareLinksQuery, refetchInterval: 60_000 });
  const unseen = links.data?.reduce((sum, link) => sum + link.unseen, 0) ?? 0;
  if (!unseen) return null;
  return (
    <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
      {unseen}
      <span className="sr-only"> new share-link responses</span>
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

/** Your account: an avatar, so it never reads like a section of the app. */
function UserMenu({ me }: { me: Me }) {
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={`Account: ${me.user.name}`}
          />
        }
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {initials(me.user.name)}
        </span>
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
        <DropdownMenuItem render={<Link to="/settings" />}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        {me.user.roles.length > 0 && (
          <DropdownMenuItem render={<Link to="/usage" />}>
            <ChartColumnIcon />
            My usage
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
