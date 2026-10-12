import {
  ArrowRightIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  PencilRulerIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { BackLink, EmptyState, FaqLink, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
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
  // Nothing to copy from on a first visit, so the picker only shows once there is.
  const showFrom = Boolean(search.from) || (previous.data?.length ?? 0) > 0;
  const startingId = start.isPending ? start.variables.templateId : undefined;

  return (
    <Page>
      <PageHeader
        title="New document"
        description="Pick the template you want to fill in. You answer its questions and get the finished PDF."
        back={<BackLink to="/">My documents</BackLink>}
        actions={<FaqLink feature="Filling out a document" />}
      />

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <Field className="w-full sm:w-72">
          <FieldLabel htmlFor="picker-search">Search templates</FieldLabel>
          <div className="relative">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <Input
              id="picker-search"
              type="search"
              className="pl-9"
              placeholder="Name or description"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </Field>
        {showFrom && (
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
            <FieldDescription>Answers to fields with the same name carry over.</FieldDescription>
          </Field>
        )}
      </div>

      <ErrorAlert error={templates.error} />

      {templates.isSuccess && fillable.length > 0 && (
        <p className="sr-only" aria-live="polite">
          {fillable.length} {fillable.length === 1 ? "template" : "templates"}
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fillable.map((t) => {
          const overlay = t.kind === "overlay";
          const KindIcon = overlay ? StackIcon : PencilRulerIcon;
          return (
            <li key={t.id}>
              {/* The Start button stretches over the card, so the whole card is one click target
                  and one tab stop. */}
              <Card className="relative h-full gap-1.5 px-5 transition-shadow hover:shadow-float">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] text-brand-ink uppercase">
                  <KindIcon aria-hidden className="size-3.5" />
                  {overlay ? "PDF form" : "Document"}
                </span>
                <h2 className="font-heading text-[15.5px] leading-tight font-bold tracking-tight">
                  {t.name}
                </h2>
                {t.description && (
                  <p className="line-clamp-2 text-[13px] text-ink-3" title={t.description}>
                    {t.description}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                  <span className="text-[12.5px] text-ink-3">
                    Version {t.latestVersion}
                    {t.publishedAt && ` · ${dayjs(t.publishedAt).fromNow()}`}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="after:absolute after:inset-0 after:rounded-xl hover:bg-primary hover:text-primary-foreground dark:hover:bg-primary"
                    disabled={start.isPending}
                    aria-label={`Start ${t.name}`}
                    onClick={() =>
                      start.mutate(
                        { templateId: t.id, fromSubmissionId: search.from },
                        { onError: (error) => toast.error(error.message) },
                      )
                    }
                  >
                    {startingId === t.id ? "Starting…" : "Start"}
                    <ArrowRightIcon weight="bold" />
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {templates.isPending && (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="status"
          aria-busy="true"
          aria-label="Loading templates"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}
      {templates.isSuccess &&
        fillable.length === 0 &&
        (query ? (
          <EmptyState
            icon={MagnifyingGlassIcon}
            title="No templates match"
            description={`Nothing matches "${query}". Try fewer words.`}
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
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
