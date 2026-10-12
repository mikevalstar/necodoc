import { zValidator } from "@hono/zod-validator";
import {
  assistantRequestSchema,
  suggestDescriptionSchema,
  suggestNoteSchema,
  templateDiff,
} from "@necodoc/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { aiModel, requireAi } from "../ai";
import { assistantResponse, suggestDescription, suggestNote } from "../assistant";
import { recordAudit } from "../audit";
import { db } from "../db";
import { templateVersion, theme } from "../db/schema";
import { type AppEnv, requirePermission } from "../middleware";
import { diffableDraft, diffableVersion } from "../publish";
import { findDraft, findVersion } from "./templates";

// Spec: docs/features/ai-template-assistant.md, ADRs 0022 and 0035. Every route here is AI: 404
// without ANTHROPIC_KEY (requireAi runs first), then the permission check (403).

const canEdit = requirePermission({ document: ["edit"] });
const canPublish = requirePermission({ document: ["publish"] });
const idParam = zValidator("param", z.object({ id: z.uuid() }));

const off = { error: "Not found" } as const;

export const assistantRoutes = new Hono<AppEnv>()
  // A chat turn, streamed. The draft is the editor's (unsaved) one: the model edits what the
  // author sees, and the editor applies what they accept.
  .post(
    "/:id/assistant",
    requireAi,
    canEdit,
    idParam,
    zValidator("json", assistantRequestSchema),
    async (c) => {
      if (!aiModel) return c.json(off, 404);
      const { id } = c.req.valid("param");
      const saved = await findDraft(id);
      if (!saved) return c.json({ error: "Template not found" }, 404);
      if (saved.kind !== "designed") {
        return c.json({ error: "The assistant works on designed templates" }, 422);
      }
      const { messages, draft } = c.req.valid("json");
      const themes = await db.select({ id: theme.id, name: theme.name }).from(theme);
      await recordAudit({
        action: "template.ai_requested",
        target: { id, name: saved.name },
        details: { feature: "assistant", messages: messages.length },
      });
      return assistantResponse({
        model: aiModel,
        messages,
        draft,
        themes,
        signal: c.req.raw.signal,
      });
    },
  )
  .post(
    "/:id/ai/description",
    requireAi,
    canEdit,
    idParam,
    zValidator("json", suggestDescriptionSchema),
    async (c) => {
      if (!aiModel) return c.json(off, 404);
      const { id } = c.req.valid("param");
      const saved = await findDraft(id);
      if (!saved) return c.json({ error: "Template not found" }, 404);
      const { draft } = c.req.valid("json");
      await recordAudit({
        action: "template.ai_requested",
        target: { id, name: saved.name },
        details: { feature: "description" },
      });
      return c.json({ text: await suggestDescription(aiModel, draft) }, 200);
    },
  )
  // The saved draft against the latest version (the publish dialog), or a version against the
  // one before it (backfilling a note).
  .post(
    "/:id/ai/note",
    requireAi,
    canPublish,
    idParam,
    zValidator("json", suggestNoteSchema),
    async (c) => {
      if (!aiModel) return c.json(off, 404);
      const { id } = c.req.valid("param");
      const { version } = c.req.valid("json");
      const saved = await findDraft(id);
      if (!saved) return c.json({ error: "Template not found" }, 404);

      let after: Awaited<ReturnType<typeof diffableDraft>>;
      let baseVersion: number | null;
      if (version === undefined) {
        after = await diffableDraft(saved);
        const latest = await findVersion(c.get("user"), id, "latest");
        baseVersion = latest?.version.version ?? null;
      } else {
        const row = await findVersion(c.get("user"), id, version);
        if (!row) return c.json({ error: "Version not found" }, 404);
        after = diffableVersion(row.version);
        baseVersion = version > 1 ? version - 1 : null;
      }
      if (!after) return c.json({ error: "The content doesn't match the template's kind" }, 422);

      const [before] =
        baseVersion === null
          ? []
          : await db
              .select()
              .from(templateVersion)
              .where(
                and(eq(templateVersion.templateId, id), eq(templateVersion.version, baseVersion)),
              );
      const beforeDiffable = before ? diffableVersion(before) : null;
      await recordAudit({
        action: "template.ai_requested",
        target: { id, name: saved.name },
        details: { feature: "version_note", version: version ?? null },
      });
      if (beforeDiffable) {
        const diff = templateDiff(beforeDiffable, after);
        return c.json({ text: await suggestNote(aiModel, { name: after.name, diff }) }, 200);
      }
      // A first version: summarise the template itself.
      return c.json({ text: await suggestNote(aiModel, { name: after.name, first: after }) }, 200);
    },
  );
