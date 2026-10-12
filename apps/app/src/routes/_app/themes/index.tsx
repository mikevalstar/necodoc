import {
  bundledFonts,
  hasPermission,
  type Theme,
  type ThemeFont,
  type ThemeSettings,
} from "@necodoc/shared";
import { PaletteIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, Page, PageHeader } from "@/components/page";
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
import { Skeleton } from "@/components/ui/skeleton";
import { dayjs } from "@/lib/date";
import { assetsQuery, themesQuery } from "@/lib/queries";
import { DeleteThemeDialog, fontStack, useDuplicateTheme } from "./-theme-actions";

// Spec: docs/features/document-themes.md
export const Route = createFileRoute("/_app/themes/")({
  component: Themes,
});

function Themes() {
  const { me } = Route.useRouteContext();
  const canCreate = hasPermission(me.user.roles, { document: ["create"] });
  const canEdit = hasPermission(me.user.roles, { document: ["edit"] });
  const themes = useQuery(themesQuery);
  const fonts = useQuery(assetsQuery({ kind: "font" }));
  const duplicate = useDuplicateTheme();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const fontName = (font: ThemeFont) =>
    typeof font === "string"
      ? bundledFonts[font].family
      : (fonts.data?.find((asset) => asset.id === font.assetId)?.name ?? "Uploaded font");

  const own = themes.data?.filter((theme) => !theme.builtIn) ?? [];
  const starters = themes.data?.filter((theme) => theme.builtIn) ?? [];

  const card = (theme: Theme) => (
    <Card key={theme.id}>
      <CardHeader>
        <CardTitle>
          <Link to="/themes/$id" params={{ id: theme.id }} className="hover:underline">
            {theme.name}
          </Link>
        </CardTitle>
        <CardDescription className="text-ink-3">
          {fontName(theme.settings.font)} {theme.settings.fontSize}pt
          {fontName(theme.settings.headingFont) !== fontName(theme.settings.font) &&
            `, headings in ${fontName(theme.settings.headingFont)}`}
        </CardDescription>
        {!theme.builtIn && (
          <CardAction>
            <span
              className="text-xs text-ink-3"
              title={dayjs(theme.updatedAt).format("YYYY-MM-DD HH:mm")}
            >
              {dayjs(theme.updatedAt).fromNow()}
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <Specimen settings={theme.settings} />
        <Swatches settings={theme.settings} />
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/themes/$id" params={{ id: theme.id }} />}
          aria-label={`${theme.builtIn || !canEdit ? "View" : "Edit"} ${theme.name}`}
        >
          {theme.builtIn || !canEdit ? "View" : "Edit"}
        </Button>
        {canCreate && (
          <Button
            variant="secondary"
            size="sm"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate(theme)}
            aria-label={`Duplicate ${theme.name}`}
          >
            Duplicate
          </Button>
        )}
        {canEdit && !theme.builtIn && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-bad hover:bg-bad-wash hover:text-bad"
            onClick={() => setDeleting(theme)}
            aria-label={`Delete ${theme.name}`}
          >
            Delete…
          </Button>
        )}
      </CardFooter>
    </Card>
  );

  return (
    <Page>
      <PageHeader
        title="Themes"
        description={
          <>
            House styles for generated documents: fonts, colours, headings and tables. Templates and
            API renders pick one. {canCreate && "Duplicate a starter to make your own."}
          </>
        }
        actions={<FaqLink feature="Document themes" />}
      />
      <ErrorAlert error={themes.error ?? duplicate.error} />
      {themes.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
          <span className="sr-only">Loading themes</span>
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : (
        themes.data && (
          <>
            <section aria-labelledby="own-themes" className="space-y-3">
              <h2 id="own-themes" className="font-heading text-lg font-bold">
                Your themes
              </h2>
              {own.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{own.map(card)}</div>
              ) : (
                <EmptyState
                  icon={PaletteIcon}
                  title="No themes of your own yet"
                  description={
                    canCreate
                      ? "Duplicate a starter below, then change its fonts and colours."
                      : "Editors make themes by duplicating a starter."
                  }
                />
              )}
            </section>
            <section aria-labelledby="starter-themes" className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 id="starter-themes" className="font-heading text-lg font-bold">
                  Starters
                </h2>
                <p className="text-sm text-ink-3">
                  Built in and read-only. Duplicate one to edit it.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{starters.map(card)}</div>
            </section>
          </>
        )
      )}
      {deleting && <DeleteThemeDialog theme={deleting} onClose={() => setDeleting(null)} />}
    </Page>
  );
}

/** A thumbnail of the theme on paper: heading, rule, body text with a link, a table header. */
function Specimen({ settings }: { settings: ThemeSettings }) {
  return (
    <div
      aria-hidden
      className="space-y-1.5 overflow-hidden rounded-lg bg-white px-4 py-3 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
      style={{ color: settings.textColor, fontFamily: fontStack(settings.font) }}
    >
      <div
        className="truncate text-lg leading-tight font-bold"
        style={{ color: settings.headingColor, fontFamily: fontStack(settings.headingFont) }}
      >
        Service agreement
      </div>
      <div className="h-px" style={{ background: settings.accentColor }} />
      <p className="truncate text-xs">
        Between <span style={{ color: settings.linkColor, textDecoration: "underline" }}>Acme</span>{" "}
        and the client named below.
      </p>
      <div
        className="flex text-[10px] font-semibold"
        style={{
          background: settings.tableHeaderBackground,
          boxShadow: `inset 0 0 0 1px ${settings.tableBorderColor}`,
        }}
      >
        <span className="flex-1 px-1.5 py-0.5">Item</span>
        <span className="px-1.5 py-0.5">Price</span>
      </div>
    </div>
  );
}

function Swatches({ settings }: { settings: ThemeSettings }) {
  const colors = [
    ["Text", settings.textColor],
    ["Headings", settings.headingColor],
    ["Accent", settings.accentColor],
    ["Links", settings.linkColor],
    ["Table header", settings.tableHeaderBackground],
  ] as const;
  return (
    <ul className="flex gap-1.5" aria-label="Colours">
      {colors.map(([label, color]) => (
        <li
          key={label}
          title={`${label} ${color}`}
          className="size-5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
          style={{ background: color }}
        >
          <span className="sr-only">
            {label} {color}
          </span>
        </li>
      ))}
    </ul>
  );
}
