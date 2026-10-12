import { Autocomplete } from "@base-ui/react/autocomplete";
import { hasPermission } from "@necodoc/shared";
import {
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  type Icon,
  KeyIcon,
  LayoutIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  MoonStarsIcon,
  PaintBrushIcon,
  PlusIcon,
  PuzzlePieceIcon,
  QueueIcon,
  RowsIcon,
  SunIcon,
  TerminalWindowIcon,
  UploadSimpleIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { setStatusBar, useStatusBar } from "@/components/ops-status-bar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api, ok } from "@/lib/api";
import { canAccess, type Me } from "@/lib/auth";
import {
  matches,
  parseRecent,
  pushRecent,
  type Recent,
  type recentKinds,
} from "@/lib/command-palette";
import { dayjs } from "@/lib/date";
import { setDensity, useDensity } from "@/lib/density";
import { labelOf, otherPages, visibleSections } from "@/lib/nav";
import { snippetsQuery, submissionsQuery, templatesQuery, themesQuery } from "@/lib/queries";
import { toggleTheme, useTheme } from "@/lib/theme";

// Spec: docs/features/command-palette.md. Base UI's Autocomplete inside a Dialog (combobox over a
// grouped listbox). We filter ourselves (filter={null}): lists the pages already load are matched
// here, generations and users are searched by the API.

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = isMac ? { label: "⌘K", aria: "Meta+K" } : { label: "Ctrl K", aria: "Control+K" };

/** Open state and the ⌘K / Ctrl+K shortcut, for the shell. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) {
        return;
      }
      e.preventDefault();
      setOpen((was) => !was);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen, shortcut };
}

type Kind = (typeof recentKinds)[number];
type Entry = {
  key: string;
  label: string;
  hint?: string;
  icon: Icon;
  /** Navigates; with a kind it's remembered under Recent. Actions run instead. */
} & ({ href: string; kind?: Kind } | { run: () => void });
type Group = { value: string; items: Entry[] };

/** Hits shown per record group; the rest are a "show all" away. */
const PER_GROUP = 5;
const recentKey = "necodoc-palette-recent";

function readRecent() {
  try {
    return parseRecent(localStorage.getItem(recentKey));
  } catch {
    return []; // storage blocked
  }
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const kindIcons = {
  Pages: ArrowRightIcon,
  Templates: LayoutIcon,
  Documents: FileTextIcon,
  Generations: QueueIcon,
  Snippets: PuzzlePieceIcon,
  Themes: PaintBrushIcon,
  Users: UserIcon,
} as const satisfies Record<Kind, Icon>;

export function CommandPalette({
  me,
  open,
  setOpen,
}: {
  me: Me;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState(readRecent);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const groups = usePaletteGroups(me, open, query, recent);

  const pick = (entry: Entry) => {
    setOpen(false);
    setQuery("");
    if ("run" in entry) {
      entry.run();
      return;
    }
    if (entry.kind) {
      const next = pushRecent(recent, { href: entry.href, label: entry.label, kind: entry.kind });
      setRecent(next);
      try {
        localStorage.setItem(recentKey, JSON.stringify(next));
      } catch {
        // storage blocked: recent lasts until reload
      }
    }
    router.navigate({ href: entry.href });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Always the search box: with nothing to return focus to, the default can land on <body>.
        initialFocus={input}
        aria-label="Command palette"
        className="top-[12svh] flex max-h-[min(36rem,80svh)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl data-open:slide-in-from-top-2"
      >
        <DialogTitle className="sr-only">Search or jump to</DialogTitle>
        <Autocomplete.Root
          open
          inline
          items={groups}
          filter={null}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={(entry: Entry) => entry.label}
          autoHighlight="always"
          keepHighlight
        >
          <div className="flex items-center gap-2.5 border-b border-hair px-4">
            <MagnifyingGlassIcon aria-hidden="true" className="size-[18px] shrink-0 text-ink-3" />
            <Autocomplete.Input
              ref={input}
              aria-label="Search pages, records and actions"
              placeholder="Search or jump to…"
              // The ring drawn inside: the popup clips anything outside it.
              className="my-1.5 h-10 w-full rounded-lg bg-transparent px-2 text-[15px] shadow-none! outline-offset-[-3px]! placeholder:text-ink-3"
            />
            <kbd className="rounded-md bg-tint px-1.5 py-0.5 font-mono text-[11px] text-ink-3">
              Esc
            </kbd>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scroll-padding-block:0.5rem]">
            <Autocomplete.Empty>
              <p className="px-3 py-8 text-center text-ink-3">Nothing matches “{query}”.</p>
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(group: Group) => (
                <Autocomplete.Group key={group.value} items={group.items} className="not-last:mb-2">
                  <Autocomplete.GroupLabel className="px-3 pt-2 pb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
                    {group.value}
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(entry: Entry) => (
                      <Autocomplete.Item
                        key={entry.key}
                        value={entry}
                        onClick={() => pick(entry)}
                        className="flex min-h-10 cursor-default items-center gap-3 rounded-lg px-3 select-none data-highlighted:bg-tint data-highlighted:text-ink [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-ink-3 data-highlighted:[&>svg]:text-brand"
                      >
                        <entry.icon />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.hint && (
                          <span className="max-w-[40%] shrink-0 truncate text-xs text-ink-3">
                            {entry.hint}
                          </span>
                        )}
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
          </div>
          <div className="flex items-center gap-4 border-t border-hair px-4 py-2 text-xs text-ink-3">
            <span>
              <kbd className="font-mono">↑↓</kbd> move
            </span>
            <span>
              <kbd className="font-mono">Enter</kbd> open
            </span>
            <span className="ml-auto">{shortcut.label} anywhere</span>
          </div>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  );
}

/** What the palette lists for this query: recent, pages, actions, then matching records. */
function usePaletteGroups(me: Me, open: boolean, query: string, recent: readonly Recent[]) {
  const router = useRouter();
  const roles = me.user.roles;
  const isAdmin = roles.includes("admin");
  const can = (action: "create" | "edit" | "review" | "publish") =>
    hasPermission(roles, { document: [action] });
  const seesSnippets = canAccess(roles, ["create", "edit", "review", "publish"]);
  const dark = useTheme() && document.documentElement.classList.contains("dark");
  const density = useDensity();
  const statusBar = useStatusBar();
  const q = query.trim();
  const searched = useDebounced(q, 200);
  const serverSearch = open && searched.length >= 2;

  // Loaded when the palette opens; the same cache the list pages use.
  const templates = useQuery({ ...templatesQuery, enabled: open });
  const documents = useQuery({ ...submissionsQuery(), enabled: open });
  const themes = useQuery({ ...themesQuery, enabled: open });
  const snippets = useQuery({ ...snippetsQuery, enabled: open && seesSnippets });
  const generations = useQuery({
    queryKey: ["generations", "palette", searched],
    queryFn: async () =>
      (
        await ok(api.generations.$get({ query: { q: searched, limit: String(PER_GROUP + 1) } }))
      ).json(),
    enabled: serverSearch,
  });
  const users = useQuery({
    queryKey: ["admin", "users", "palette", searched],
    queryFn: async () =>
      (
        await ok(api.admin.users.$get({ query: { q: searched, limit: String(PER_GROUP + 1) } }))
      ).json(),
    enabled: serverSearch && isAdmin,
  });

  const href = router.buildLocation.bind(router);
  const pages: Entry[] = [
    ...visibleSections(roles).flatMap((section) =>
      section.items.map((item) => ({
        key: `page:${item.to}`,
        label: labelOf(item, roles),
        hint: section.label,
        icon: section.icon,
        href: String(item.to),
        kind: "Pages" as const,
      })),
    ),
    ...Object.entries(otherPages)
      .filter(([path]) => path === "/settings" || roles.length > 0)
      .map(([path, label]) => ({
        key: `page:${path}`,
        label,
        hint: "Account",
        icon: ArrowRightIcon,
        href: path,
        kind: "Pages" as const,
      })),
  ];

  const actions: Entry[] = [
    ...(can("create")
      ? [
          {
            key: "new-template",
            label: "New template",
            icon: PlusIcon,
            href: href({ to: "/templates", search: { new: "designed" } }).href,
          },
          {
            key: "upload-pdf",
            label: "Upload PDF",
            hint: "New overlay template",
            icon: UploadSimpleIcon,
            href: href({ to: "/templates", search: { new: "overlay" } }).href,
          },
        ]
      : []),
    { key: "new-document", label: "New document", icon: FileTextIcon, href: "/documents/new" },
    {
      key: "new-api-key",
      label: "Create API key",
      icon: KeyIcon,
      href: href({ to: "/settings/api-keys", search: { new: true } }).href,
    },
    {
      key: "theme",
      label: dark ? "Switch to light theme" : "Switch to dark theme",
      icon: dark ? SunIcon : MoonStarsIcon,
      run: toggleTheme,
    },
    density === "compact"
      ? {
          key: "density",
          label: "Comfortable table rows",
          icon: RowsIcon,
          run: () => setDensity("comfortable"),
        }
      : {
          key: "density",
          label: "Compact table rows",
          icon: ListDashesIcon,
          run: () => setDensity("compact"),
        },
    ...(isAdmin
      ? [
          {
            key: "status-bar",
            label: statusBar ? "Hide ops status bar" : "Show ops status bar",
            icon: TerminalWindowIcon,
            run: () => setStatusBar(!statusBar),
          },
        ]
      : []),
  ];

  if (!q) {
    const recentEntries: Entry[] = recent
      // A page you've since lost access to drops out; records still guard themselves.
      .filter((r) => r.kind !== "Pages" || pages.some((p) => "href" in p && p.href === r.href))
      .map((r) => ({
        key: `recent:${r.href}`,
        label: r.label,
        hint: r.kind,
        icon: r.kind === "Pages" ? ClockCounterClockwiseIcon : kindIcons[r.kind],
        href: r.href,
        kind: r.kind,
      }));
    return [
      { value: "Recent", items: recentEntries },
      { value: "Actions", items: actions },
      { value: "Pages", items: pages },
    ].filter((group) => group.items.length > 0);
  }

  /** The first hits as entries, plus "Show all" to the list page when there are more. */
  function records<T>(
    kind: Kind,
    rows: readonly T[] | undefined,
    toEntry: (row: T) => { id: string; label: string; hint?: string; href: string },
    showAll?: string,
  ): Group {
    const hits = rows ?? [];
    const items: Entry[] = hits.slice(0, PER_GROUP).map((row) => {
      const { id, ...rest } = toEntry(row);
      return { key: `${kind}:${id}`, icon: kindIcons[kind], kind, ...rest };
    });
    if (showAll && hits.length > PER_GROUP) {
      items.push({
        key: `${kind}:all`,
        label: `Show all ${kind.toLowerCase()} matching “${q}”`,
        icon: MagnifyingGlassIcon,
        href: showAll,
      });
    }
    return { value: kind, items };
  }

  const matching = <T,>(rows: readonly T[] | undefined, text: (row: T) => string) =>
    rows?.filter((row) => matches(text(row), q));

  const generationHits = serverSearch && searched === q ? generations.data : undefined;
  const userHits = serverSearch && searched === q ? users.data : undefined;

  return [
    { value: "Pages", items: pages.filter((p) => matches(`${p.label} ${p.hint ?? ""}`, q)) },
    { value: "Actions", items: actions.filter((a) => matches(`${a.label} ${a.hint ?? ""}`, q)) },
    records(
      "Templates",
      matching(templates.data, (t) => `${t.name} ${t.description}`),
      (t) => ({
        id: t.id,
        label: t.name,
        hint: t.kind === "overlay" ? "PDF overlay" : undefined,
        href: `/templates/${t.id}`,
      }),
      href({ to: "/templates", search: { q } }).href,
    ),
    records(
      "Documents",
      matching(documents.data, (d) => `${d.name} ${d.templateName}`),
      (d) => ({ id: d.id, label: d.name, hint: d.templateName, href: `/documents/${d.id}` }),
      href({ to: "/", search: { q } }).href,
    ),
    records(
      "Generations",
      generationHits?.items,
      (g) => ({
        id: g.id,
        label: g.filename ?? g.id,
        // File names repeat; when and how it went tells them apart.
        hint: `${g.status} · ${dayjs(g.queuedAt).fromNow()}`,
        href: `/generations/${g.id}`,
      }),
      href({ to: "/generations", search: { q } }).href,
    ),
    records(
      "Snippets",
      matching(snippets.data, (s) => s.name),
      (s) => ({ id: s.id, label: s.name, href: `/snippets/${s.id}` }),
      href({ to: "/snippets", search: { q } }).href,
    ),
    records(
      "Themes",
      matching(themes.data, (t) => t.name),
      (t) => ({ id: t.id, label: t.name, href: `/themes/${t.id}` }),
    ),
    records(
      "Users",
      userHits?.users,
      (u) => ({
        id: u.id,
        label: u.name,
        hint: u.email,
        href: href({ to: "/admin/users", search: { q: u.email } }).href,
      }),
      href({ to: "/admin/users", search: { q } }).href,
    ),
  ].filter((group) => group.items.length > 0);
}
