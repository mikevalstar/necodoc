import {
  bundledFonts,
  type createThemeSchema,
  type Theme,
  type ThemeFont,
  type ThemeUsage,
} from "@necodoc/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { z } from "zod";
import { ErrorAlert } from "@/components/form";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api, ok } from "@/lib/api";
import { themesQuery } from "@/lib/queries";
import { plural } from "@/lib/utils";

// Spec: docs/features/document-themes.md. Starters are copied, never edited.

type ThemeSource = z.input<typeof createThemeSchema>;

/** A CSS font stack for showing a theme font in the app. Uploaded fonts aren't loaded here. */
export function fontStack(font: ThemeFont) {
  if (typeof font !== "string") return undefined;
  const { family, generic } = bundledFonts[font];
  return `"${family}", ${generic}`;
}

/** The templates using a theme; saving the theme changes which copies are older. */
export const themeUsageQuery = (id: string) =>
  queryOptions({
    queryKey: ["themes", id, "usage"],
    queryFn: async () => (await ok(api.themes[":id"].usage.$get({ param: { id } }))).json(),
  });

/** Templates using the theme: drafts, and published versions with whether their copy is current. */
function ThemeUsageList({ usage }: { usage: ThemeUsage }) {
  return (
    <ul aria-label="Templates using this theme" className="divide-y divide-hair text-sm">
      {usage.templates.map((t) => {
        const [latest] = t.versions;
        const older = t.versions.filter((v) => !v.current && v !== latest).length;
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link
              to="/templates/$id"
              params={{ id: t.id }}
              className="font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              {t.name}
            </Link>
            <span className="ml-auto flex flex-wrap gap-1">
              {t.draft && <Badge variant="secondary">Draft</Badge>}
              {latest && (
                <Badge variant={latest.current ? "ok" : "warn"} dot>
                  v{latest.version} {latest.current ? "current copy" : "older copy"}
                </Badge>
              )}
              {older > 0 && (
                <Badge variant="secondary">
                  {plural(older, "earlier version")} on older copies
                </Badge>
              )}
              {t.archived && <Badge variant="secondary">Archived</Badge>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Templates whose latest published version froze an older copy of the theme. */
const onOlderCopy = (usage: ThemeUsage) =>
  usage.templates.filter((t) => t.versions[0] && !t.versions[0].current).length;

/** A header summary that jumps to the usage card. */
export function ThemeUsageBadge({ themeId }: { themeId: string }) {
  const usage = useQuery(themeUsageQuery(themeId));
  if (!usage.data?.templates.length) return null;
  const older = onOlderCopy(usage.data);
  return (
    <Badge variant={older ? "warn" : "secondary"} render={<a href="#theme-usage" />}>
      Used by {plural(usage.data.templates.length, "template")}
      {older > 0 && ` · ${older} on an older copy`}
    </Badge>
  );
}

/** Where the theme is used, for the theme editor (docs/features/document-themes.md). */
export function ThemeUsageCard({ themeId }: { themeId: string }) {
  const usage = useQuery(themeUsageQuery(themeId));
  const templates = usage.data?.templates ?? [];
  const older = usage.data ? onOlderCopy(usage.data) : 0;
  return (
    <Card size="sm" id="theme-usage" className="scroll-mt-4">
      <CardContent className="space-y-2">
        <h2 className="font-heading text-[15px] font-bold">Used by</h2>
        <ErrorAlert error={usage.error} />
        <p className="text-sm text-ink-3">
          {usage.isPending
            ? "Loading…"
            : templates.length
              ? `${plural(templates.length, "template")}. Published versions keep the copy of the theme they were published with${older ? `; ${plural(older, "template")} published on an older copy` : ""}.`
              : "No templates use this theme."}
        </p>
        {templates.length > 0 && usage.data && <ThemeUsageList usage={usage.data} />}
      </CardContent>
    </Card>
  );
}

/** Copies a theme and opens the copy in the editor. */
export function useDuplicateTheme() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (source: ThemeSource) =>
      (await ok(api.themes.$post({ json: { ...source, name: `${source.name} copy` } }))).json(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: themesQuery.queryKey });
      await navigate({ to: "/themes/$id", params: { id: created.id } });
      toast.success(`Duplicated as ${created.name}`);
    },
  });
}

export function DeleteThemeDialog({
  theme,
  onClose,
}: {
  theme: Pick<Theme, "id" | "name">;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const usage = useQuery(themeUsageQuery(theme.id));
  const drafts = usage.data?.templates.filter((t) => t.draft) ?? [];
  const remove = useMutation({
    mutationFn: () => ok(api.themes[":id"].$delete({ param: { id: theme.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: themesQuery.queryKey });
      await navigate({ to: "/themes" });
      toast.success(`Deleted ${theme.name}`);
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {theme.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Published versions keep their copy of it. API renders that name this theme will fail
            {drafts.length > 0 && `, and ${plural(drafts.length, "draft")} below lose the theme`}.
            It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {usage.data && usage.data.templates.length > 0 && <ThemeUsageList usage={usage.data} />}
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete theme
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
