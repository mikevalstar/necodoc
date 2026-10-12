import type { assetListQuerySchema, SubmissionListQuery } from "@necodoc/shared";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { api, ok } from "./api";
import { authClient, unwrap } from "./auth";

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

/** A template's published versions (version history, share link version picker). */
export const versionsQuery = (id: string) =>
  queryOptions({
    queryKey: ["templates", id, "versions"],
    queryFn: async () => (await ok(api.templates[":id"].versions.$get({ param: { id } }))).json(),
  });

/** One published version; a numbered one never changes, "latest" moves on publish. */
export const versionQuery = (id: string, version: number | "latest") =>
  queryOptions({
    queryKey: ["templates", id, "versions", version],
    queryFn: async () =>
      (
        await ok(
          api.templates[":id"].versions[":version"].$get({
            param: { id, version: String(version) },
          }),
        )
      ).json(),
    staleTime: version === "latest" ? 0 : Number.POSITIVE_INFINITY,
  });

/** Every user, for admin filters and pickers (generation log, audit log, analytics). */
export const allUsersQuery = queryOptions({
  queryKey: ["admin", "users", "all"],
  queryFn: () => unwrap(authClient.admin.listUsers({ query: { limit: 500, sortBy: "name" } })),
});

/** The user's documents (home page, "start from a previous document"). Detail keys nest under it. */
export const submissionsQuery = (query: SubmissionListQuery = {}) =>
  queryOptions({
    queryKey: ["submissions", "list", query],
    queryFn: async () => (await ok(api.submissions.$get({ query }))).json(),
  });

export const submissionQuery = (id: string) =>
  queryOptions({
    queryKey: ["submissions", id],
    queryFn: async () => (await ok(api.submissions[":id"].$get({ param: { id } }))).json(),
  });

/** The publisher's share links, with response counts (list page and the nav's unseen badge). */
export const shareLinksQuery = queryOptions({
  queryKey: ["share-links"],
  queryFn: async () => (await ok(api["share-links"].$get())).json(),
});

/** The snippet library (snippet pages, the editor's snippet blocks and picker, field checks). */
export const snippetsQuery = queryOptions({
  queryKey: ["snippets"],
  queryFn: async () => (await ok(api.snippets.$get())).json(),
});
