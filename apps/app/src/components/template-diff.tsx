import { summarizeTemplateDiff, type TemplateDiff } from "@necodoc/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { api, ok } from "@/lib/api";
import { snippetsQuery } from "@/lib/queries";

// Specs: docs/features/publishing-and-versions.md (diff), docs/features/review-and-approval.md.
// The structural diff of the saved draft against the latest published version.

export const templateDiffQuery = (id: string) =>
  queryOptions({
    queryKey: ["templates", id, "diff"],
    queryFn: async () => (await ok(api.templates[":id"].diff.$get({ param: { id } }))).json(),
  });

const opBadge = {
  added: <Badge className="bg-emerald-600 text-white">Added</Badge>,
  removed: <Badge variant="destructive">Removed</Badge>,
  changed: <Badge variant="secondary">Changed</Badge>,
} as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  );
}

function Row({ op, children }: { op: keyof typeof opBadge; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="shrink-0">{opBadge[op]}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Loads and shows the diff; `compact` shows only the one-line summary. */
export function TemplateDiffView({ id, compact = false }: { id: string; compact?: boolean }) {
  const diff = useQuery(templateDiffQuery(id));
  if (diff.error) return <ErrorAlert error={diff.error} />;
  if (!diff.data) return <p className="text-sm text-muted-foreground">Comparing…</p>;
  if (!diff.data.diff) {
    return (
      <p className="text-sm text-muted-foreground">
        Not published yet: everything in the draft is new.
      </p>
    );
  }
  return compact ? (
    <DiffSummary diff={diff.data.diff} />
  ) : (
    <StructuralDiff diff={diff.data.diff} baseVersion={diff.data.baseVersion} />
  );
}

function DiffSummary({ diff }: { diff: TemplateDiff }) {
  const lines = summarizeTemplateDiff(diff);
  if (!lines.length) return <p className="text-sm text-muted-foreground">No changes.</p>;
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-sm">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function StructuralDiff({
  diff,
  baseVersion,
  caption,
}: {
  diff: TemplateDiff;
  baseVersion: number | null;
  /** Replaces "Saved draft compared with version N" (the assistant's proposals). */
  caption?: string;
}) {
  const snippets = useQuery(snippetsQuery).data;
  const snippetName = (id: string) =>
    snippets?.find((s) => s.id === id || s.key === id)?.name ?? id;
  const { fields, sections, content, boxes } = diff;
  const settings = [
    ...(diff.name ? [`Name: "${diff.name.before}" → "${diff.name.after}"`] : []),
    ...(diff.description ? ["Description changed"] : []),
    ...(content.mode ? [`Content switched ${content.mode}`] : []),
    ...(diff.header ? ["Header changed"] : []),
    ...(diff.footer ? ["Footer changed"] : []),
    ...(diff.css ? ["Template CSS changed"] : []),
    ...diff.page,
    ...diff.theme,
    ...(diff.source ? ["The PDF was replaced, or flatten changed"] : []),
    ...(diff.sampleData ? ["Sample data changed"] : []),
  ];
  const empty = summarizeTemplateDiff(diff).length === 0;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {caption ?? `Saved draft compared with version ${baseVersion}.`}
        {empty && " Nothing changed."}
      </p>
      {settings.length > 0 && (
        <Group title="Template">
          {settings.map((line) => (
            <Row key={line} op="changed">
              {line}
            </Row>
          ))}
        </Group>
      )}
      {fields.added.length + fields.removed.length + fields.changed.length > 0 && (
        <Group title="Fields">
          {fields.added.map((f) => (
            <Row key={`a${f.key}`} op="added">
              <code>{f.key}</code> {f.label}
            </Row>
          ))}
          {fields.removed.map((f) => (
            <Row key={`r${f.key}`} op="removed">
              <code>{f.key}</code> {f.label}
            </Row>
          ))}
          {fields.changed.map((f) => (
            <Row key={`c${f.key}`} op="changed">
              <code>{f.key}</code> {f.label}: {f.changes.join(", ")}
            </Row>
          ))}
        </Group>
      )}
      {sections.added.length + sections.removed.length + sections.changed.length > 0 && (
        <Group title="Sections">
          {sections.added.map((title) => (
            <Row key={`a${title}`} op="added">
              {title}
            </Row>
          ))}
          {sections.removed.map((title) => (
            <Row key={`r${title}`} op="removed">
              {title}
            </Row>
          ))}
          {sections.changed.map((title) => (
            <Row key={`c${title}`} op="changed">
              {title} (description, show-if or position)
            </Row>
          ))}
        </Group>
      )}
      {content.blocks.length > 0 && (
        <Group title="Content blocks">
          {content.blocks.map((block) => (
            <Row key={`${block.op}${block.index}`} op={block.op}>
              <span className="text-muted-foreground">
                #{block.index + 1} {block.type}
              </span>{" "}
              {block.op === "changed" ? (
                <>
                  <del className="text-red-700 dark:text-red-400">{block.before || "(empty)"}</del>{" "}
                  →{" "}
                  <ins className="text-emerald-700 no-underline dark:text-emerald-400">
                    {block.after || "(empty)"}
                  </ins>
                </>
              ) : (
                (block.after ?? block.before) || "(no text)"
              )}
            </Row>
          ))}
        </Group>
      )}
      {content.lines && (content.lines.added > 0 || content.lines.removed > 0) && (
        <Group title="Code">
          <Row op="changed">
            {content.lines.added} lines added, {content.lines.removed} removed
          </Row>
        </Group>
      )}
      {diff.snippets.length > 0 && (
        <Group title="Snippets">
          {diff.snippets.map((name) => (
            <Row key={name} op="changed">
              {snippetName(name)}
            </Row>
          ))}
        </Group>
      )}
      {boxes.added.length + boxes.removed.length + boxes.changed.length > 0 && (
        <Group title="Boxes">
          {boxes.added.map((b) => (
            <Row key={`a${b.id}`} op="added">
              Page {b.page} {b.type}: {b.label}
            </Row>
          ))}
          {boxes.removed.map((b) => (
            <Row key={`r${b.id}`} op="removed">
              Page {b.page} {b.type}: {b.label}
            </Row>
          ))}
          {boxes.changed.map((b) => (
            <Row key={`c${b.id}`} op="changed">
              Page {b.page} {b.type}: {b.label} ({b.changes.join(", ")})
            </Row>
          ))}
        </Group>
      )}
    </div>
  );
}
