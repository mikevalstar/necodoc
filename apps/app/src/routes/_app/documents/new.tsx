import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { dayjs } from "@/lib/date";
import { submissionsQuery, templatesQuery } from "@/lib/queries";
import { useStartDocument } from "./-document-actions";

// Spec: docs/features/filling-out-a-document.md. Pick a published template; optionally start
// from a previous document's answers (fields with the same key carry over).

export const Route = createFileRoute("/_app/documents/new")({
  validateSearch: z.object({ from: z.uuid().optional() }),
  component: NewDocument,
});

function NewDocument() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const templates = useQuery(templatesQuery);
  const previous = useQuery(submissionsQuery());
  const start = useStartDocument();
  const [query, setQuery] = useState("");
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);
  // Editors also get drafts from this endpoint; only published, live templates can be filled.
  const fillable = (templates.data ?? []).filter(
    (t) =>
      t.latestVersion !== null &&
      !t.archivedAt &&
      words.every((word) => `${t.name} ${t.description}`.toLowerCase().includes(word)),
  );

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        My documents
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">New document</h1>
        <p className="text-sm text-muted-foreground">Pick what you want to fill in.</p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <Field className="w-full sm:w-64">
          <FieldLabel htmlFor="picker-search">Search</FieldLabel>
          <Input
            id="picker-search"
            type="search"
            placeholder="Name or description"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field className="w-full sm:w-80">
          <FieldLabel htmlFor="picker-from">Start from a previous document</FieldLabel>
          <NativeSelect
            id="picker-from"
            className="w-full"
            value={search.from ?? ""}
            onChange={(e) =>
              navigate({ search: { from: e.target.value || undefined }, replace: true })
            }
          >
            <NativeSelectOption value="">No, start blank</NativeSelectOption>
            {previous.data?.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.name} ({dayjs(d.updatedAt).format("MMM D")})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>Answers to fields with the same name are copied over.</FieldDescription>
        </Field>
      </div>

      <ErrorAlert error={templates.error ?? start.error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fillable.map((t) => (
          <Card key={t.id} className="justify-between">
            <CardHeader>
              <CardTitle>{t.name}</CardTitle>
              {t.description && <CardDescription>{t.description}</CardDescription>}
            </CardHeader>
            <CardFooter className="flex items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{t.kind === "overlay" ? "PDF form" : "Document"}</Badge>
                Version {t.latestVersion}
                {t.publishedAt && ` · ${dayjs(t.publishedAt).fromNow()}`}
              </span>
              <Button
                size="sm"
                disabled={start.isPending}
                onClick={() => start.mutate({ templateId: t.id, fromSubmissionId: search.from })}
              >
                Start
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      {templates.isSuccess && fillable.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">
          {query ? "No templates match." : "Nothing has been published yet."}
        </p>
      )}
    </main>
  );
}
