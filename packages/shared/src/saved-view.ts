import { z } from "zod";

// Spec: docs/features/saved-views.md. A view is a table's URL search, named and stored per user;
// admins can share one with everyone.

/** The tables that offer saved views; each page validates a view's search with its own schema. */
export const savedViewTableSchema = z.enum(["generations", "audit"]);
export type SavedViewTable = z.infer<typeof savedViewTableSchema>;

const text = z.string().max(500);

/** URL search params as TanStack Router parses them: strings, numbers, booleans, string lists. */
export const savedViewSearchSchema = z
  .record(z.string().max(50), z.union([text, z.number(), z.boolean(), z.array(text).max(50)]))
  .refine((search) => Object.keys(search).length <= 30, "Too many parameters");
export type SavedViewSearch = z.infer<typeof savedViewSearchSchema>;

const nameSchema = z.string().trim().min(1, "Enter a name").max(80);

export const createSavedViewSchema = z.object({
  table: savedViewTableSchema,
  name: nameSchema,
  search: savedViewSearchSchema,
  /** Admins only: everyone who can open the table sees it. */
  shared: z.boolean().default(false),
});
export type CreateSavedViewInput = z.input<typeof createSavedViewSchema>;

/** Rename, store the current state into the view, or share / unshare it. */
export const updateSavedViewSchema = z
  .object({ name: nameSchema, search: savedViewSearchSchema, shared: z.boolean() })
  .partial();
export type UpdateSavedViewInput = z.input<typeof updateSavedViewSchema>;

export const savedViewListQuerySchema = z.object({ table: savedViewTableSchema });

export const savedViewSchema = z.object({
  id: z.uuid(),
  table: savedViewTableSchema,
  name: z.string(),
  search: savedViewSearchSchema,
  shared: z.boolean(),
  ownerId: z.string(),
  ownerName: z.string().nullable(),
  /** The caller may rename, update and delete it: their own, or any shared one for admins. */
  canEdit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SavedView = z.infer<typeof savedViewSchema>;
