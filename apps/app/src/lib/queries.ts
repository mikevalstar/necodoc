import type { assetListQuerySchema } from "@necodoc/shared";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { api, ok } from "./api";

// Lists more than one page reads: assets (asset library, theme font picker) and themes (theme
// list, render theme picker).

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
