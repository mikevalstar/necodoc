import { zValidator } from "@hono/zod-validator";
import {
  createSavedViewSchema,
  hasPermission,
  parseRoles,
  type SavedView,
  type SavedViewTable,
  savedViewListQuerySchema,
  updateSavedViewSchema,
} from "@necodoc/shared";
import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { savedView, user } from "../db/schema";
import { type AppEnv, requireRole, type SignedInEnv } from "../middleware";

// Spec: docs/features/saved-views.md. Private views are the owner's alone; shared ones are listed
// for everyone who can open the table, and only admins share or change them. Only changes to
// shared views are audited.

type Actor = SignedInEnv["Variables"]["user"];
type Row = typeof savedView.$inferSelect;

/** Who can open each table's page, mirroring the routes that serve it. */
const canOpen = (table: SavedViewTable, actor: Actor) => {
  const roles = parseRoles(actor.role);
  return table === "audit" ? roles.includes("admin") : hasPermission(roles, { document: ["view"] });
};

const isAdmin = (actor: Actor) => parseRoles(actor.role).includes("admin");

const canEdit = (row: Pick<Row, "ownerId" | "shared">, actor: Actor) =>
  row.ownerId === actor.id || (row.shared && isAdmin(actor));

const toView = (row: Row & { ownerName: string | null }, actor: Actor): SavedView => ({
  ...row,
  canEdit: canEdit(row, actor),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** What the audit entry shows of a view. */
const audited = (row: Pick<Row, "name" | "search" | "shared" | "table">) => ({
  table: row.table,
  name: row.name,
  search: row.search,
  shared: row.shared,
});

const idParam = zValidator("param", z.object({ id: z.uuid() }));
// Any signed-in user; which tables they may use is checked per request.
const signedIn = requireRole("admin", "publisher", "reviewer", "editor", "viewer");

/** Names are unique per owner and table (the constraint backs this up). */
async function nameTaken(row: Pick<Row, "ownerId" | "table" | "name">, exceptId?: string) {
  const [taken] = await db
    .select({ id: savedView.id })
    .from(savedView)
    .where(
      and(
        eq(savedView.ownerId, row.ownerId),
        eq(savedView.table, row.table),
        eq(savedView.name, row.name),
        exceptId ? ne(savedView.id, exceptId) : undefined,
      ),
    );
  return taken !== undefined;
}
const duplicateName = { error: "You already have a view with that name" } as const;

export const savedViewRoutes = new Hono<AppEnv>()
  .get("/", signedIn, zValidator("query", savedViewListQuerySchema), async (c) => {
    const actor = c.get("user");
    const { table } = c.req.valid("query");
    if (!canOpen(table, actor)) return c.json({ error: "Forbidden" }, 403);
    const rows = await db
      .select({
        id: savedView.id,
        ownerId: savedView.ownerId,
        ownerName: user.name,
        table: savedView.table,
        name: savedView.name,
        search: savedView.search,
        shared: savedView.shared,
        createdAt: savedView.createdAt,
        updatedAt: savedView.updatedAt,
      })
      .from(savedView)
      .leftJoin(user, eq(user.id, savedView.ownerId))
      .where(
        and(
          eq(savedView.table, table),
          or(eq(savedView.ownerId, actor.id), eq(savedView.shared, true)),
        ),
      )
      .orderBy(desc(savedView.shared), asc(savedView.name));
    return c.json(rows.map((row) => toView(row, actor)));
  })
  .post("/", signedIn, zValidator("json", createSavedViewSchema), async (c) => {
    const actor = c.get("user");
    const input = c.req.valid("json");
    if (!canOpen(input.table, actor)) return c.json({ error: "Forbidden" }, 403);
    if (input.shared && !isAdmin(actor)) {
      return c.json({ error: "Only admins can share a view" }, 403);
    }
    if (await nameTaken({ ...input, ownerId: actor.id })) return c.json(duplicateName, 409);
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(savedView)
        .values({ ...input, ownerId: actor.id })
        .returning();
      if (!row) throw new Error("Insert returned no row");
      if (row.shared) {
        await recordAudit(
          {
            action: "saved_view.created",
            target: { id: row.id, name: row.name },
            after: audited(row),
          },
          tx,
        );
      }
      return row;
    });
    return c.json(toView({ ...row, ownerName: actor.name }, actor), 201);
  })
  .patch("/:id", signedIn, idParam, zValidator("json", updateSavedViewSchema), async (c) => {
    const actor = c.get("user");
    const input = c.req.valid("json");
    const [before] = await db
      .select()
      .from(savedView)
      .where(eq(savedView.id, c.req.valid("param").id));
    if (!before || !(before.ownerId === actor.id || before.shared)) {
      return c.json({ error: "View not found" }, 404);
    }
    if (!canEdit(before, actor))
      return c.json({ error: "Only admins can change a shared view" }, 403);
    if (input.shared !== undefined && input.shared !== before.shared && !isAdmin(actor)) {
      return c.json({ error: "Only admins can share a view" }, 403);
    }
    if (input.name !== undefined && (await nameTaken({ ...before, name: input.name }, before.id))) {
      return c.json(duplicateName, 409);
    }
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(savedView)
        .set(input)
        .where(eq(savedView.id, before.id))
        .returning();
      if (!row) throw new Error("Update returned no row");
      if (before.shared || row.shared) {
        await recordAudit(
          {
            action: "saved_view.updated",
            target: { id: row.id, name: row.name },
            before: audited(before),
            after: audited(row),
          },
          tx,
        );
      }
      return row;
    });
    const [owner] = await db.select({ name: user.name }).from(user).where(eq(user.id, row.ownerId));
    return c.json(toView({ ...row, ownerName: owner?.name ?? null }, actor), 200);
  })
  .delete("/:id", signedIn, idParam, async (c) => {
    const actor = c.get("user");
    const [row] = await db
      .select()
      .from(savedView)
      .where(eq(savedView.id, c.req.valid("param").id));
    if (!row || !(row.ownerId === actor.id || row.shared)) {
      return c.json({ error: "View not found" }, 404);
    }
    if (!canEdit(row, actor)) return c.json({ error: "Only admins can delete a shared view" }, 403);
    await db.transaction(async (tx) => {
      await tx.delete(savedView).where(eq(savedView.id, row.id));
      if (row.shared) {
        await recordAudit(
          {
            action: "saved_view.deleted",
            target: { id: row.id, name: row.name },
            before: audited(row),
          },
          tx,
        );
      }
    });
    return c.body(null, 204);
  });
