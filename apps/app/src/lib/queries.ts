import type { assetListQuerySchema } from "@necodoc/shared";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { api, ok } from "./api";

// Lists more than one page reads: assets (asset library, theme font picker, editor images),
// themes (theme list, render and template theme pickers) and templates (template list, and the
// editor invalidates it on save).

export const assetsQuery = (query: z.infer<typeof assetListQuerySchema> = {}) =>
  queryOptions({
    queryKey: ["assets", query],
    queryFn: async () => (await ok(api.assets.$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });

export const themesQuery = queryOptions({
  queryKey: ["themes"],
  queryFn: async () => (await ok(api.themes.$get())).json(),
});

export const templatesQuery = queryOptions({
  queryKey: ["templates"],
  queryFn: async () => (await ok(api.templates.$get())).json(),
});

/** Batches (the generation log's batch filter). The batch list page polls the same key. */
export const batchesQuery = queryOptions({
  queryKey: ["batches"],
  queryFn: async () => (await ok(api.batches.$get())).json(),
});
