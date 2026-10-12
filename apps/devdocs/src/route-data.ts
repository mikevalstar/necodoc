// Titles and descriptions for the API reference pages starlight-openapi generates
// (src/generated/openapi.json): it titles every overview "Overview" and gives no page a
// description. Starlight builds <head> before route middleware runs, so the tags are patched too.

import { defineRouteMiddleware, type StarlightRouteData } from "@astrojs/starlight/route-data";

type Operation = { operationId?: string; summary?: string; description?: string };
type Spec = {
  info?: { description?: string };
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, Operation>>;
};

// Glob, not import: the file is generated, so typechecking works before the first build.
const [spec = {}] = Object.values(
  import.meta.glob<Spec>("./generated/openapi.json", { eager: true, import: "default" }),
);

const BASE = "reference/api";

/** github-slugger's rule for the ASCII names in our spec, which starlight-openapi slugs with. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** Plain text for a meta description: no Markdown code ticks, cut at a sentence near 160. */
function plain(text: string) {
  const flat = text.replaceAll("`", "").replace(/\s+/g, " ").trim();
  if (flat.length <= 160) return /[.!?]$/.test(flat) ? flat : `${flat}.`;
  const cut = flat.slice(0, 160);
  const end = cut.lastIndexOf(". ");
  return end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const pages = new Map<string, { title?: string; description: string }>([
  [BASE, { title: "API reference", description: plain(spec.info?.description ?? "") }],
]);
for (const tag of spec.tags ?? []) {
  pages.set(`${BASE}/operations/tags/${slug(tag.name)}`, {
    title: `${tag.name} API`,
    description: plain(
      `${tag.name} endpoints of the necodoc REST API (/api/v1). ${tag.description ?? ""}`,
    ),
  });
}
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const [method, operation] of Object.entries(item)) {
    if (!operation.operationId) continue;
    pages.set(`${BASE}/operations/${slug(operation.operationId)}`, {
      description: plain(
        `${method.toUpperCase()} /api/v1${path}: ${operation.description || operation.summary || ""}`,
      ),
    });
  }
}

type Head = StarlightRouteData["head"];

/** Replaces a head tag's content, or appends the tag. */
function setTag(head: Head, tag: "title" | "meta", attrs: Record<string, string>, content: string) {
  const [key, value] = Object.entries(attrs)[0] ?? [];
  const found = head.find(
    (item) => item.tag === tag && (key === undefined || item.attrs?.[key] === value),
  );
  if (tag === "title") {
    if (found) found.content = content;
    return;
  }
  if (found?.attrs) found.attrs.content = content;
  else head.push({ tag, attrs: { ...attrs, content }, content: "" });
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const page = pages.get(context.url.pathname.replace(/^\/|\/$/g, "").replace(/\.html$/, ""));
  if (!page) return;
  if (page.title) {
    const siteTitle = route.siteTitle;
    route.entry.data.title = page.title;
    setTag(route.head, "title", {}, `${page.title} | ${siteTitle}`);
    setTag(route.head, "meta", { property: "og:title" }, page.title);
  }
  route.entry.data.description = page.description;
  setTag(route.head, "meta", { name: "description" }, page.description);
  setTag(route.head, "meta", { property: "og:description" }, page.description);
});
