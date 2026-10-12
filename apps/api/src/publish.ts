import { createHash } from "node:crypto";
import {
  type CompiledOverlay,
  compileDesignedContent,
  compiledSources,
  type DiffableTemplate,
  designedContentSchema,
  fieldErrors,
  type OverlayContent,
  outputWorthKeeping,
  overlayContentSchema,
  type RenderInput,
  stableStringify,
  TemplateCompileError,
  templateDataSchema,
} from "@necodoc/shared";
import { eq } from "drizzle-orm";
import { LiquidError } from "liquidjs";
import { db } from "./db";
import { type template, type templateVersion, theme } from "./db/schema";
import { liquid, plainLiquid } from "./render/liquid";
import { PartialError } from "./render/partials";
import { loadPartials } from "./snippets";

// Specs: docs/features/publishing-and-versions.md, docs/features/review-and-approval.md. What
// publishing a draft freezes, and its fingerprint: a review approves a fingerprint, and publish
// (when review is required) only goes ahead while the draft still has it.

type TemplateRow = typeof template.$inferSelect;

/** The stored draft with its content checked against its kind (content is untyped jsonb). */
export function savedDraft(row: TemplateRow) {
  const { kind, sections, sampleData, themeId, page } = row;
  if (kind === "overlay") {
    const content = overlayContentSchema.safeParse(row.content);
    return content.success ? { kind, sections, sampleData, content: content.data } : null;
  }
  const content = designedContentSchema.safeParse(row.content);
  return content.success
    ? { kind, sections, sampleData, themeId, page, content: content.data }
    : null;
}
export type SavedDraft = NonNullable<ReturnType<typeof savedDraft>>;

/** Checks every box's Liquid parses; the overlay's render input, minus data. */
function compileOverlay(content: OverlayContent) {
  for (const box of content.boxes) {
    try {
      plainLiquid.parse(box.value);
    } catch (error) {
      if (!(error instanceof LiquidError)) throw error;
      return { error: `A box on page ${box.page}: ${error.message}` };
    }
  }
  // Like designed templates, unset output settings and translations stay out, keeping existing
  // fingerprints.
  const { output, translations, ...rest } = content;
  const compiled: CompiledOverlay = {
    kind: "overlay",
    ...rest,
    ...(outputWorthKeeping(output) ? { output } : {}),
    ...(Object.keys(translations).length ? { translations } : {}),
  };
  return { compiled };
}

/** Compiles the body and bands, checking the Liquid parses, so publish fails early. */
function compileOrError(...args: Parameters<typeof compileDesignedContent>) {
  try {
    const compiled = compileDesignedContent(...args);
    for (const part of compiledSources(compiled)) liquid.parse(part);
    return { compiled };
  } catch (error) {
    if (error instanceof TemplateCompileError || error instanceof LiquidError) {
      return { error: error.message };
    }
    throw error;
  }
}

/**
 * The draft rendered with `data`, the way a preview does: current theme and snippets. Data that
 * fits the fields gets show-ifs applied; data that doesn't still renders.
 */
export function draftRenderInput(
  draft: SavedDraft,
  data: Record<string, unknown>,
  filename: string,
) {
  const parsed = templateDataSchema(draft.sections).safeParse(data);
  const request = { data: parsed.success ? parsed.data : data, filename, preview: true };
  const dataErrors = parsed.success
    ? []
    : Object.entries(fieldErrors(parsed.error)).map(
        ([key, messages]) => `${key || "data"}: ${messages.join(", ")}`,
      );
  if (draft.kind === "overlay") {
    return {
      dataValid: parsed.success,
      dataErrors,
      input: { kind: "overlay", ...draft.content, ...request } satisfies RenderInput,
    };
  }
  const { compiled, error } = compileOrError(draft.content, draft.sections);
  if (!compiled) return { error: error ?? "The content doesn't compile" };
  const input: RenderInput = {
    ...compiled,
    ...(draft.themeId ? { themeId: draft.themeId } : {}),
    page: draft.page,
    ...request,
  };
  return { dataValid: parsed.success, dataErrors, input };
}

async function themeOf(themeId: string | null) {
  if (!themeId) return null;
  const [row] = await db
    .select({ settings: theme.settings, css: theme.css })
    .from(theme)
    .where(eq(theme.id, themeId));
  return row ?? null;
}

/**
 * Everything a published version stores, minus its number, note and publisher, with the
 * fingerprint of it. Fails like publish does: content that doesn't compile, Liquid that doesn't
 * parse, a snippet that's missing.
 */
export async function publishSnapshot(row: TemplateRow) {
  const typed = savedDraft(row);
  if (!typed) return { error: "The draft's content doesn't match its kind" } as const;
  const result =
    typed.kind === "overlay"
      ? compileOverlay(typed.content)
      : compileOrError(typed.content, typed.sections);
  if (!result.compiled) return { error: result.error ?? "The content doesn't compile" } as const;
  let compiled = result.compiled;
  if (!("kind" in compiled)) {
    // Frozen with the version: later snippet edits don't change it.
    try {
      compiled = { ...compiled, partials: await loadPartials(compiledSources(compiled)) };
    } catch (error) {
      if (error instanceof PartialError) return { error: error.message } as const;
      throw error;
    }
  }
  const themeRow = typed.kind === "designed" ? await themeOf(row.themeId) : null;
  const { name, description, kind, sections, sampleData, themeId, page, content } = row;
  const snapshot = {
    name,
    description,
    kind,
    sections,
    sampleData,
    themeId,
    page,
    content,
    theme: themeRow,
    compiled,
  };
  const fingerprint = createHash("sha256").update(stableStringify(snapshot)).digest("hex");
  return { snapshot, fingerprint, draft: typed } as const;
}

/**
 * The draft as one side of a structural diff, with its current theme and, when it compiles, its
 * current snippets.
 */
export async function diffableDraft(row: TemplateRow): Promise<DiffableTemplate | null> {
  const typed = savedDraft(row);
  if (!typed) return null;
  const common = { ...typed, name: row.name, description: row.description };
  if (typed.kind === "overlay") return common;
  const built = await publishSnapshot(row);
  const compiled = built.snapshot?.compiled;
  return {
    ...common,
    theme: built.snapshot ? built.snapshot.theme : await themeOf(typed.themeId),
    ...(compiled && !("kind" in compiled) && compiled.partials
      ? { partials: compiled.partials }
      : {}),
  };
}

/** A published version as the other side; its theme is the one it froze. */
export function diffableVersion(v: typeof templateVersion.$inferSelect): DiffableTemplate | null {
  const content = (v.kind === "overlay" ? overlayContentSchema : designedContentSchema).safeParse(
    v.content,
  );
  if (!content.success) return null;
  const { kind, name, description, sections, sampleData, page, themeId, theme, compiled } = v;
  const common = { kind, name, description, sections, sampleData, content: content.data };
  if (kind === "overlay" || "kind" in compiled) return common;
  return {
    ...common,
    page,
    themeId,
    theme,
    ...(compiled.partials ? { partials: compiled.partials } : {}),
  };
}
