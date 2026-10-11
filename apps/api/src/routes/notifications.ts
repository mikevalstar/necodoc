import { zValidator } from "@hono/zod-validator";
import { markNotificationsReadSchema } from "@necodoc/shared";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { notification, template, user } from "../db/schema";
import { type AppEnv, requirePermission } from "../middleware";

// Spec: docs/features/review-and-approval.md (notifications). Each user's own; the nav bell polls.

export const notificationRoutes = new Hono<AppEnv>()
  .use(requirePermission({ document: ["view"] }))
  .get("/", async (c) => {
    const userId = c.get("user").id;
    const [items, [unread]] = await Promise.all([
      db
        .select({
          id: notification.id,
          kind: notification.kind,
          message: notification.message,
          templateId: notification.templateId,
          templateName: template.name,
          reviewId: notification.reviewId,
          actorName: user.name,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        })
        .from(notification)
        .leftJoin(template, eq(template.id, notification.templateId))
        .leftJoin(user, eq(user.id, notification.actorId))
        .where(eq(notification.userId, userId))
        .orderBy(desc(notification.createdAt))
        .limit(50),
      db
        .select({ count: count() })
        .from(notification)
        .where(and(eq(notification.userId, userId), isNull(notification.readAt))),
    ]);
    return c.json({ items, unread: unread?.count ?? 0 });
  })
  .post("/read", zValidator("json", markNotificationsReadSchema), async (c) => {
    const { ids } = c.req.valid("json");
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, c.get("user").id),
          isNull(notification.readAt),
          ids ? inArray(notification.id, ids) : undefined,
        ),
      );
    return c.body(null, 204);
  });
