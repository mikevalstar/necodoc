import { bundledFonts, hasPermission, type ThemeFont, type ThemeSettings } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
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
import { dayjs } from "@/lib/date";
import { assetsQuery, themesQuery } from "@/lib/queries";
import { DeleteThemeDialog, useDuplicateTheme } from "./-theme-actions";

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

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Themes</h1>
        <p className="text-sm text-muted-foreground">
          House styles for documents.{" "}
          {canCreate && "Duplicate a built-in starter to make your own."}
        </p>
      </div>
      <ErrorAlert error={themes.error ?? duplicate.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {themes.data?.map((theme) => (
          <Card key={theme.id}>
            <CardHeader>
              <CardTitle>
                <Link to="/themes/$id" params={{ id: theme.id }} className="hover:underline">
                  {theme.name}
                </Link>
              </CardTitle>
              <CardDescription>
                {fontName(theme.settings.font)} {theme.settings.fontSize}pt
                {fontName(theme.settings.headingFont) !== fontName(theme.settings.font) &&
                  `, headings in ${fontName(theme.settings.headingFont)}`}
              </CardDescription>
              <CardAction>
                {theme.builtIn ? (
                  <Badge variant="secondary">Built-in</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {dayjs(theme.updatedAt).fromNow()}
                  </span>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              <Swatches settings={theme.settings} />
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to="/themes/$id" params={{ id: theme.id }} />}
              >
                {theme.builtIn || !canEdit ? "View" : "Edit"}
              </Button>
              {canCreate && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={duplicate.isPending}
                  onClick={() => duplicate.mutate(theme)}
                >
                  Duplicate
                </Button>
              )}
              {canEdit && !theme.builtIn && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive"
                  onClick={() => setDeleting(theme)}
                >
                  Delete
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
      {deleting && <DeleteThemeDialog theme={deleting} onClose={() => setDeleting(null)} />}
    </main>
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
    <div className="flex gap-1.5">
      {colors.map(([label, color]) => (
        <span
          key={label}
          title={`${label} ${color}`}
          className="size-6 rounded-full border"
          style={{ background: color }}
        />
      ))}
    </div>
  );
}
