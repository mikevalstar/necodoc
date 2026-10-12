import { FileTextIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { BackLink, EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
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
    <Page>
      <PageHeader
        title="New document"
        description="Pick the template you want to fill in. You answer its questions and get the finished PDF."
        back={<BackLink to="/">My documents</BackLink>}
        actions={<FaqLink feature="Filling out a document" />}
      />

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
              {t.description && (
                <CardDescription className="line-clamp-3" title={t.description}>
                  {t.description}
                </CardDescription>
              )}
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
                <span className="sr-only"> {t.name}</span>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      {templates.isPending && <ListSkeleton rows={3} />}
      {templates.isSuccess &&
        fillable.length === 0 &&
        (query ? (
          <EmptyState title="No templates match" description={`Nothing matches "${query}".`} />
        ) : (
          <EmptyState
            icon={FileTextIcon}
            title="Nothing to fill in yet"
            description="Documents start from a published template. Once someone publishes one, it shows up here."
            action={
              <Button variant="outline" nativeButton={false} render={<Link to="/templates" />}>
                Go to templates
              </Button>
            }
          />
        ))}
    </Page>
  );
}
