import { zValidator } from "@hono/zod-validator";
import {
  createWebhookSchema,
  hasPermission,
  parseRoles,
  updateWebhookSchema,
} from "@necodoc/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { apikey, template, user, webhook, webhookDelivery } from "../db/schema";
import { type AppEnv, requirePermission, type SignedInEnv } from "../middleware";
import { newWebhookSecret } from "../webhook-rules";
import { queueTestDelivery, resolveWebhookUrl } from "../webhooks";

// Spec: docs/features/webhooks.md. People manage their own webhooks; admins manage service
// accounts' (and can see anyone's). Secrets are returned once, on create.

type SignedInUser = SignedInEnv["Variables"]["user"];

const isAdmin = (actor: SignedInUser) => parseRoles(actor.role).includes("admin");
const canUseApi = requirePermission({ document: ["view"] });
const idParam = zValidator("param", z.object({ id: z.uuid() }));

const selectWebhooks = () =>
  db
    .select({
      id: webhook.id,
      ownerId: webhook.ownerId,
      url: webhook.url,
      description: webhook.description,
      events: webhook.events,
      apiKeyId: webhook.apiKeyId,
      apiKeyName: apikey.name,
      templateId: webhook.templateId,
      templateName: template.name,
      enabled: webhook.enabled,
      createdAt: webhook.createdAt,
    })
    .from(webhook)
    .leftJoin(apikey, eq(apikey.id, webhook.apiKeyId))
    .leftJoin(template, eq(template.id, webhook.templateId))
    .$dynamic();

/** Your own, or a service account's (or anyone's) for admins. */
async function findManaged(actor: SignedInUser, id: string) {
  const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
  return row && (row.ownerId === actor.id || isAdmin(actor)) ? row : null;
}

export const webhookRoutes = new Hono<AppEnv>()
  .get(
    "/",
    canUseApi,
    zValidator("query", z.object({ ownerId: z.string().optional() })),
    async (c) => {
      const actor = c.get("user");
      const ownerId = c.req.valid("query").ownerId ?? actor.id;
      if (ownerId !== actor.id && !isAdmin(actor)) return c.json({ error: "Forbidden" }, 403);
      const rows = await selectWebhooks()
        .where(eq(webhook.ownerId, ownerId))
        .orderBy(desc(webhook.createdAt));
      return c.json(rows, 200);
    },
  )
  .post("/", canUseApi, zValidator("json", createWebhookSchema), async (c) => {
    const actor = c.get("user");
    const {
      ownerId = actor.id,
      url,
      events,
      apiKeyId,
      templateId,
      description,
    } = c.req.valid("json");
    const [owner] = await db
      .select({ id: user.id, serviceAccount: user.serviceAccount })
      .from(user)
      .where(eq(user.id, ownerId));
    if (!owner || (owner.id !== actor.id && !(owner.serviceAccount && isAdmin(actor)))) {
      return c.json({ error: "Owner not found" }, 404);
    }
    if (apiKeyId) {
      const [key] = await db
        .select({ id: apikey.id })
        .from(apikey)
        .where(and(eq(apikey.id, apiKeyId), eq(apikey.referenceId, ownerId)));
      if (!key) return c.json({ error: "That key isn't the owner's" }, 422);
    }
    if (templateId) {
      const [found] = await db
        .select({ id: template.id })
        .from(template)
        .where(eq(template.id, templateId));
      if (!found) return c.json({ error: "Template not found" }, 422);
      // A template-wide webhook sees everyone's generations of it: an editor's call.
      if (!apiKeyId && !hasPermission(parseRoles(actor.role), { document: ["edit"] })) {
        return c.json({ error: "Template webhooks need the editor role" }, 403);
      }
    }
    const resolved = await resolveWebhookUrl(url);
    if (!resolved.ok) return c.json({ error: resolved.error }, 422);
    const secret = newWebhookSecret();
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(webhook)
        .values({
          ownerId,
          url,
          description,
          secret,
          events,
          apiKeyId,
          templateId,
          createdBy: actor.id,
        })
        .returning();
      if (row) {
        await recordAudit(
          { action: "webhook.created", target: { id: row.id, name: row.url }, after: row },
          tx,
        );
      }
      return row;
    });
    if (!created) return c.json({ error: "Not created" }, 500);
    const [row] = await selectWebhooks().where(eq(webhook.id, created.id));
    return c.json({ ...row, secret }, 201);
  })
  .patch("/:id", canUseApi, idParam, zValidator("json", updateWebhookSchema), async (c) => {
    const found = await findManaged(c.get("user"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Webhook not found" }, 404);
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(webhook)
        .set(c.req.valid("json"))
        .where(eq(webhook.id, found.id))
        .returning();
      await recordAudit(
        {
          action: "webhook.updated",
          target: { id: found.id, name: updated?.url ?? found.url },
          before: found,
          after: updated,
        },
        tx,
      );
    });
    const [row] = await selectWebhooks().where(eq(webhook.id, found.id));
    return c.json(row, 200);
  })
  .delete("/:id", canUseApi, idParam, async (c) => {
    const found = await findManaged(c.get("user"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Webhook not found" }, 404);
    await db.transaction(async (tx) => {
      await tx.delete(webhook).where(eq(webhook.id, found.id));
      await recordAudit(
        { action: "webhook.deleted", target: { id: found.id, name: found.url }, before: found },
        tx,
      );
    });
    return c.body(null, 204);
  })
  .post("/:id/test", canUseApi, idParam, async (c) => {
    const found = await findManaged(c.get("user"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Webhook not found" }, 404);
    await queueTestDelivery(found.id);
    return c.json({ queued: true }, 202);
  })
  .get("/:id/deliveries", canUseApi, idParam, async (c) => {
    const found = await findManaged(c.get("user"), c.req.valid("param").id);
    if (!found) return c.json({ error: "Webhook not found" }, 404);
    const rows = await db
      .select({
        id: webhookDelivery.id,
        event: webhookDelivery.event,
        status: webhookDelivery.status,
        attempts: webhookDelivery.attempts,
        generationId: webhookDelivery.generationId,
        batchId: webhookDelivery.batchId,
        createdAt: webhookDelivery.createdAt,
        finishedAt: webhookDelivery.finishedAt,
      })
      .from(webhookDelivery)
      .where(eq(webhookDelivery.webhookId, found.id))
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(50);
    return c.json(rows, 200);
  });
