import { safeReturnPath } from "@necodoc/shared";
import {
  CaretRightIcon,
  ChartBarIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  MoonStarsIcon,
  QuestionIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useMatches,
} from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { InstanceBlock, initials } from "@/components/instance";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notifications";
import { OpsStatusBar, useStatusBar } from "@/components/ops-status-bar";
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
import { useCurrentCrumb } from "@/lib/breadcrumb";
import {
  inPath,
  inSection,
  type NavItem,
  labelOf as navLabel,
  otherPages,
  visibleSections,
} from "@/lib/nav";
import { shareLinksQuery } from "@/lib/queries";
import { toggleTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Signed-in users with at least one role; everyone else is sent to /login or /pending.
// Pending users may still open /settings (docs/features/user-preferences.md).
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    // Keep the page that was asked for, to come back to after signing in or being granted a role.
    const search = { redirect: safeReturnPath(location.href) };
    if (!me) throw redirect({ to: "/login", search });
    if (me.user.roles.length === 0 && location.pathname !== "/settings") {
      throw redirect({ to: "/pending", search });
    }
    return { me };
  },
  component: AppShell,
});

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Editors that need the width show the sidebar as the icon rail. */
    railSidebar?: boolean;
  }
}

// Below 1000px, and on routes that ask for it, the sidebar is the icon rail; otherwise it's the
// user's choice, per browser.
const narrowQuery = window.matchMedia("(max-width: 999px)");
const subscribeNarrow = (listener: () => void) => {
  narrowQuery.addEventListener("change", listener);
  return () => narrowQuery.removeEventListener("change", listener);
};
const collapsedKey = "necodoc-sidebar-collapsed";
function readCollapsed() {
  try {
    return localStorage.getItem(collapsedKey) === "1";
  } catch {
    return false; // storage blocked
  }
}

function AppShell() {
  const { me } = Route.useRouteContext();
  const roles = me.user.roles;
  const pathname = useLocation({ select: (location) => location.pathname });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const narrow = useSyncExternalStore(subscribeNarrow, () => narrowQuery.matches);
  const routeWantsRail = useMatches({
    select: (matches) => matches.some((match) => match.staticData.railSidebar),
  });
  const pageCrumb = useCurrentCrumb();
  const forced = narrow || routeWantsRail;
  const rail = collapsed || forced;
  const visible = visibleSections(roles);
  const labelOf = (item: NavItem) => navLabel(item, roles);
  const current = visible.find((section) => inSection(section, pathname));
  const currentItems = current?.items ?? [];
  const palette = useCommandPalette();
  const statusBar = useStatusBar() && roles.includes("admin");
  // The longest matching path wins: /templates/reviews is Reviews, /templates/abc is Templates,
  // /documents/abc falls back to the section's first page. Pages add their own last crumb with
  // usePageCrumb (lib/breadcrumb.ts): "Templates › Invoice".
  const currentItem =
    currentItems
      .filter((item) => item.to && item.to !== "/" && inPath(item.to, pathname))
      .sort((a, b) => String(b.to).length - String(a.to).length)[0] ?? currentItems[0];

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(collapsedKey, collapsed ? "0" : "1");
    } catch {
      // storage blocked: lasts until reload
    }
  };

  return (
    <div className="flex min-h-svh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-float"
      >
        Skip to content
      </a>
      <aside
        className={cn(
          "sticky top-0 flex h-svh shrink-0 flex-col overflow-y-auto bg-linear-to-b from-shell to-shell-2 py-[18px] text-shell-fg",
          rail ? "w-19 items-center px-3" : "w-62 px-3.5",
        )}
      >
        <div className={cn("flex items-center pb-[18px]", rail ? "flex-col gap-3" : "gap-2 px-2")}>
          <Link
            to="/"
            aria-label="necodoc home"
            className="flex items-center gap-2.5 rounded-lg font-heading text-[21px] leading-none font-bold tracking-tight"
          >
            <Logo className="size-[30px]" accentClassName="fill-sun" />
            {!rail && <span aria-hidden="true">necodoc</span>}
          </Link>
          {!forced && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "grid size-8 place-items-center rounded-lg text-shell-fg-2 hover:bg-white/10 hover:text-shell-fg",
                !rail && "ml-auto",
              )}
            >
              <SidebarSimpleIcon className="size-[18px]" />
            </button>
          )}
        </div>
        <InstanceBlock rail={rail} />
        <nav aria-label="Sections" className={cn("flex flex-col gap-1", rail && "items-center")}>
          {visible.map((section) => {
            const active = section === current;
            const items = section.items;
            const unseen = items.some((item) => item.unseen);
            const tab = cn(
              "flex items-center rounded-[10px] text-shell-fg-2 transition-colors hover:bg-white/7 hover:text-shell-fg [&>svg]:shrink-0",
              rail
                ? "h-11 w-12 justify-center [--ear-inset:4px] [&>svg]:size-[22px]"
                : "h-9 gap-2.5 px-2.5 font-medium [&>svg]:size-[18px]",
              active &&
                "cat-ears bg-surface font-semibold text-ink hover:bg-surface hover:text-ink dark:bg-brand dark:text-on-brand dark:hover:bg-brand dark:hover:text-on-brand [&>svg]:text-brand dark:[&>svg]:text-on-brand",
            );
            if (rail) {
              return (
                <DropdownMenu key={section.label}>
                  <DropdownMenuTrigger
                    aria-label={section.label}
                    aria-current={active ? "true" : undefined}
                    title={section.label}
                    className={cn(tab, "relative")}
                  >
                    <section.icon />
                    {unseen && <UnseenResponses dot />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                      {items.map((item) => (
                        <DropdownMenuItem
                          key={String(item.to)}
                          render={
                            <Link
                              to={item.to}
                              activeOptions={{ exact: true }}
                              aria-current={item === currentItem ? "page" : undefined}
                            />
                          }
                          className={cn(item === currentItem && "bg-tint font-semibold")}
                        >
                          {labelOf(item)}
                          {item.unseen && <UnseenResponses />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }
            return (
              <div key={section.label} className="flex flex-col">
                <Link
                  to={items[0]?.to}
                  activeOptions={{ exact: true }}
                  aria-current={active ? "true" : undefined}
                  className={tab}
                >
                  <section.icon />
                  {section.label}
                  {unseen && <UnseenResponses active={active} />}
                </Link>
                {active && items.length > 1 && (
                  <div className="mt-1 mb-1.5 ml-[38px] flex flex-col border-l-2 border-white/14">
                    {items.map((item) => (
                      <Link
                        key={String(item.to)}
                        to={item.to}
                        // Highlighting is ours (currentItem); keep the router's own aria-current to exact.
                        activeOptions={{ exact: true }}
                        aria-current={item === currentItem ? "page" : undefined}
                        className={cn(
                          "-ml-0.5 flex h-[30px] items-center rounded-r-lg border-l-2 border-transparent pl-3 text-[13px] text-shell-fg-2 hover:bg-white/7 hover:text-shell-fg",
                          item === currentItem &&
                            "border-sun bg-white/7 font-semibold text-shell-fg",
                        )}
                      >
                        {labelOf(item)}
                        {item.unseen && <UnseenResponses />}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div
          className={cn(
            "mt-auto flex items-center gap-1 pt-4",
            rail ? "flex-col" : "rounded-xl bg-white/6 p-1.5",
          )}
        >
          {rail && <ThemeToggle />}
          <UserMenu me={me} rail={rail} />
          {!rail && <ThemeToggle />}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2.5 px-4 sm:px-8">
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5 font-medium whitespace-nowrap text-ink-3">
              {current && currentItem && labelOf(currentItem) !== current.label && (
                <li className="flex items-center gap-1.5">
                  <Link to={currentItems[0]?.to} className="rounded hover:text-ink">
                    {current.label}
                  </Link>
                  <CaretRightIcon weight="bold" aria-hidden="true" className="size-3.5" />
                </li>
              )}
              {current && currentItem ? (
                <li className={cn("truncate", pageCrumb && "flex shrink-0 items-center gap-1.5")}>
                  {pathname === currentItem.to && !pageCrumb ? (
                    <span aria-current="page" className="font-semibold text-ink">
                      {labelOf(currentItem)}
                    </span>
                  ) : (
                    <Link
                      to={currentItem.to}
                      className={cn(
                        "rounded",
                        pageCrumb ? "hover:text-ink" : "font-semibold text-ink hover:underline",
                      )}
                    >
                      {labelOf(currentItem)}
                    </Link>
                  )}
                  {pageCrumb && (
                    <CaretRightIcon weight="bold" aria-hidden="true" className="size-3.5" />
                  )}
                </li>
              ) : (
                otherPages[pathname] && (
                  <li aria-current="page" className="font-semibold text-ink">
                    {otherPages[pathname]}
                  </li>
                )
              )}
              {current && pageCrumb && (
                <li aria-current="page" className="truncate font-semibold text-ink">
                  {pageCrumb}
                </li>
              )}
            </ol>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            {roles.length > 0 && (
              <button
                type="button"
                onClick={() => palette.setOpen(true)}
                aria-label="Search or jump to"
                aria-keyshortcuts={palette.shortcut.aria}
                title={`Search or jump to (${palette.shortcut.label})`}
                className="flex size-10 items-center gap-2.5 rounded-xl bg-surface px-3 text-ink-3 shadow-card transition-colors hover:text-ink min-[1000px]:w-[clamp(200px,24vw,340px)]"
              >
                <MagnifyingGlassIcon className="size-[18px] shrink-0" />
                <span className="truncate max-[999px]:hidden">Search or jump to…</span>
                <kbd className="ml-auto rounded-md bg-tint px-1.5 py-0.5 font-mono text-[11px] max-[999px]:hidden">
                  {palette.shortcut.label}
                </kbd>
              </button>
            )}
            {roles.includes("admin") && (
              <Button
                variant="outline"
                size="icon"
                className="rounded-xl text-ink-2"
                aria-label="Help: admin FAQ"
                title="Help"
                nativeButton={false}
                render={<Link to="/admin/faq" />}
              >
                <QuestionIcon />
              </Button>
            )}
            {roles.length > 0 && <NotificationBell />}
          </div>
        </header>
        <Outlet />
        {statusBar && <OpsStatusBar />}
      </div>
      {roles.length > 0 && <CommandPalette me={me} {...palette} />}
    </div>
  );
}

/** How many share-link responses arrived since each link was last opened. */
function UnseenResponses({ active = false, dot = false }: { active?: boolean; dot?: boolean }) {
  const links = useQuery({ ...shareLinksQuery, refetchInterval: 60_000 });
  const unseen = links.data?.reduce((sum, link) => sum + link.unseen, 0) ?? 0;
  if (!unseen) return null;
  const label = <span className="sr-only"> new share-link responses</span>;
  if (dot) {
    return (
      <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-sun ring-2 ring-shell">
        <span className="sr-only">{unseen}</span>
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "ml-auto rounded-full px-[7px] text-[11.5px] leading-[18px] font-semibold",
        active
          ? "bg-brand-wash text-brand-ink dark:bg-black/20 dark:text-on-brand"
          : "bg-white/14 text-shell-fg",
      )}
    >
      {unseen}
      {label}
    </span>
  );
}

function ThemeToggle() {
  useTheme(); // re-render when the theme changes
  const dark = document.documentElement.classList.contains("dark");
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="grid size-9 shrink-0 place-items-center rounded-lg text-shell-fg-2 hover:bg-white/10 hover:text-shell-fg"
    >
      {dark ? <SunIcon className="size-[18px]" /> : <MoonStarsIcon className="size-[18px]" />}
    </button>
  );
}

/** Your account, at the foot of the sidebar: avatar and name, opening Settings and Sign out. */
function UserMenu({ me, rail }: { me: Me; rail: boolean }) {
  const signOut = useSignOut();
  const roles = me.user.roles;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${me.user.name}`}
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-lg text-left text-[13px] hover:bg-white/8",
          rail ? "p-1" : "flex-1 p-1",
        )}
      >
        <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[#ffb3c7] font-heading text-xs font-bold text-[#4a0a1e]">
          {initials(me.user.name)}
        </span>
        {!rail && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-medium">{me.user.name}</span>
            <span className="block truncate text-xs text-shell-fg-2 capitalize">
              {roles.length ? roles.join(", ") : "No role yet"}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={rail ? "right" : "top"}
        align={rail ? "end" : "start"}
        className="w-64"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-2">
            <div>
              <div className="font-semibold text-foreground">{me.user.name}</div>
              <div className="text-xs font-normal">{me.user.email}</div>
            </div>
            <RoleBadges roles={roles} />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/settings" />}>
          <GearSixIcon />
          Settings
        </DropdownMenuItem>
        {roles.length > 0 && (
          <DropdownMenuItem render={<Link to="/usage" />}>
            <ChartBarIcon />
            My usage
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          <SignOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
