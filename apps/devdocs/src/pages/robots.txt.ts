import type { APIRoute } from "astro";

// The sitemap line needs the public URL (DEVDOCS_SITE), so robots.txt is built rather than static.
export const GET: APIRoute = ({ site }) =>
  new Response(
    `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${new URL("sitemap-index.xml", site)}\n` : ""}`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
