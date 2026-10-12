// Where every claim on the site points. Specs live in the repo; developer docs on their own
// site (ADR 0026). Spec: docs/features/marketing-site.md ("every claim links to its proof").

const repo = "https://github.com/mikevalstar/necodoc";

/** Developer docs origin. Set DOCS_URL (e.g. http://localhost:4322) to point at a local devdocs. */
const docsUrl = (import.meta.env.DOCS_URL as string | undefined) ?? "https://docs.necodoc.com";

export const links = {
  github: repo,
  discussions: `${repo}/discussions`,
  docs: docsUrl,
  quickstart: `${docsUrl}/getting-started/quickstart/`,
  apiReference: `${docsUrl}/reference/api/`,
  /** The architecture review pack PDF, made with necodoc and generated per release (W8). */
  reviewPack: "/review-pack/necodoc-architecture-review.pdf",
  /** The shared public demo (docs/features/public-demo.md). It resets nightly. */
  demo: "https://demo.necodoc.com",
} as const;

/** A feature spec or ADR in the repo, by file name under docs/. */
export const spec = (path: `features/${string}` | `adrs/${string}`) =>
  `${repo}/blob/main/docs/${path}.md`;

/** A developer docs page, by its path under the docs site. */
export const devdocs = (path: string) => `${docsUrl}/${path}/`;
