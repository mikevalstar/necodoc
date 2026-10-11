import type { Permissions } from "@necodoc/shared";

// Spec: docs/features/admin-faq.md. Rule: every change that ships, changes or removes a
// user-visible feature updates its entry here, in the same change. Limitations mirror the
// spec's "Known limitations", in plain words.

/** Grouped like the nav. */
export const faqGroups = [
  "Render",
  "Themes",
  "Assets",
  "Generations",
  "Settings",
  "Admin",
] as const;
export type FaqGroup = (typeof faqGroups)[number];

export type FaqEntry = {
  feature: string;
  group: FaqGroup;
  /** A few sentences, for admins rather than developers. */
  what: string;
  howTo: string;
  limitations: readonly string[];
  /** Who can do what. Roles are derived from the permissions, so they can't drift from roles.ts. */
  access: readonly { action: string; needs: Permissions | "admin" }[];
  /** The feature spec, for anyone who wants the detail. */
  spec: `docs/features/${string}.md`;
};

const view = { document: ["view"] } as const;

export const faq: readonly FaqEntry[] = [
  {
    feature: "HTML to PDF rendering",
    group: "Render",
    what: "necodoc turns HTML and CSS into a PDF with a real browser engine (Chromium), so flexbox, grid, tables that break across pages and web fonts all work. The Render page, the theme preview and every future template use this same renderer, so a preview is exactly the PDF you get.",
    howTo:
      "Open Render, write HTML (and optional CSS), pick a page size, orientation and margins, then press Render. Turn on Preview to try things without adding an entry to the generation log.",
    limitations: [
      "No JavaScript runs in rendered pages: no client-side charts or computed layout.",
      "Nothing is fetched from the internet. Remote images, fonts and @import URLs don't load; upload them as assets or inline them as data: URLs.",
      "Margins and header/footer heights are in millimetres. Page sizes are Letter, A4 and Legal, portrait or landscape.",
      "Chromium rounds millimetre page sizes up by under a point (A4 is 595.9 × 841.9 pt, not 595.3); headers and footers still line up.",
      "Requests and stored files are capped at 20 MB, and renders time out. Long renders aren't queued as background jobs.",
    ],
    access: [{ action: "Render", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "Headers and footers with page numbers",
    group: "Render",
    what: "Headers and footers are full HTML with the same theme, fonts and images as the body. Each has a fixed height and can have a different version on the first page, e.g. a letterhead on page 1 and a slim header after.",
    howTo:
      "On Render, open the Header or Footer tab, turn it on, set its height in millimetres and write its HTML. Use {{ page }} and {{ pages }} for page numbers, e.g. Page {{ page }} of {{ pages }}. Turn on 'Different first page' for a page-1 variant.",
    limitations: [
      "Content taller than the header or footer height is cut off, not moved to the next line or page.",
      "The body's margins grow by the header and footer heights, so the page has less room for content.",
    ],
    access: [{ action: "Use headers and footers", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "Liquid data and filters",
    group: "Render",
    what: "HTML, headers and footers are Liquid templates, filled with JSON data before rendering: {{ customer.name }}, {% if %}, {% for %}. Values are HTML-escaped unless you add | raw. Extra filters: date (dayjs formats like MMMM D, YYYY), number, currency, qrcode, barcode and asset_url.",
    howTo:
      "Put data in the Data tab on Render as a JSON object and reference it in the HTML. Examples: {{ total | currency: 'EUR' }}, {{ signed_on | date: 'D MMM YYYY' }}, <img src=\"{{ invoice_id | qrcode }}\">.",
    limitations: [
      "Dates use dayjs tokens (YYYY-MM-DD), not the strftime codes (%Y) other Liquid tools use.",
      "An unknown filter is an error, not a blank.",
      "No reusable snippets or partials yet ({% render %} fails).",
      "Logic is limited to Liquid's if/for and the filters above; there are no custom functions.",
    ],
    access: [{ action: "Use Liquid", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "Document themes",
    group: "Themes",
    what: "A theme is a named house style: body and heading fonts, sizes, line height, text, heading, accent and link colours, and table borders, shading and padding, plus free CSS for anything else. Three built-in starters (Plain, Formal serif, Modern sans) can be duplicated but not edited. Bundled fonts: Noto Sans, Inter, Noto Serif and JetBrains Mono; uploaded font assets work too.",
    howTo:
      "Open Themes, duplicate a starter, then change its settings and free CSS. The sample PDF on the right updates as you type. Pick the theme on the Render page to use it.",
    limitations: [
      "Free CSS is unrestricted and can break layout; check the preview.",
      "Remote @import and font URLs don't load.",
      "An uploaded font is a single file, so bold and italic are faked by the browser.",
      "Built-in starters are reset on every server restart; copy them rather than relying on changes to them.",
      "Themes don't apply to templates yet; templates are coming.",
    ],
    access: [
      { action: "View and use", needs: view },
      { action: "Create", needs: { document: ["create"] } },
      { action: "Edit and delete", needs: { document: ["edit"] } },
    ],
    spec: "docs/features/document-themes.md",
  },
  {
    feature: "Assets",
    group: "Assets",
    what: "A shared library of uploaded images (PNG, JPEG, SVG, WebP) and fonts (TTF, OTF, WOFF2), up to 20 MB each. Rendered pages can't reach the internet, so logos and fonts have to live here. The server checks each file's real type, not just its name.",
    howTo:
      "Open Assets and drop files on the upload area or pick them. Use 'Copy reference' to get the snippet: {{ 'asset-id' | asset_url }} in HTML, or https://assets.necodoc.invalid/<asset id> in CSS. Fonts are picked in the theme editor.",
    limitations: [
      "Assets are global: everyone with a role can see and use all of them.",
      "No crop or resize in the app.",
      "Deleting a font a theme uses isn't blocked; the theme falls back to Noto Sans.",
      "Deleting an image breaks any render that still references it, including re-runs.",
    ],
    access: [
      { action: "View and use", needs: view },
      { action: "Upload", needs: { document: ["create"] } },
      { action: "Rename and delete", needs: { document: ["edit"] } },
    ],
    spec: "docs/features/assets.md",
  },
  {
    feature: "Generation log",
    group: "Generations",
    what: "Every non-preview render is recorded: source, user, status, error, warnings, start time, duration, page count, size, the full input and the output PDF. Admins see everyone's entries and can filter by source, status, user, template and date range; everyone else sees their own under My generations.",
    howTo:
      "Open Generations and narrow it down: search (file name, template name, error or request id, or paste a generation or batch id), status, source, template, batch, date range and minimum duration; admins also filter by user. Click a column heading to sort, pick extra columns (worker, attempts, queue wait, batch) under Columns, and choose 25 to 200 rows per page. The address bar holds all of it, so copy the URL to share or bookmark a view, and Back undoes the last change. Click a row to see its input, view or download the PDF, re-run it, or delete it. Export CSV downloads everything matching the filters; admins can bulk delete it too.",
    limitations: [
      "Inputs can hold personal data and are kept until someone deletes them or the retention setting removes them (Admin › System).",
      "Stored PDFs grow the database over time.",
      "Re-running a render whose theme or asset has since been deleted fails.",
      "A re-run matches the original page for page, not byte for byte (each PDF carries its creation time).",
      "Bulk delete needs at least one filter, so the whole log can't be wiped in one go.",
      "Sorting and paging happen on the server, a page at a time (at most 200 rows). Sorting by a timing puts unfinished entries, which have none yet, first when sorting slowest first.",
      "The CSV export stops at 100,000 rows.",
      "Previews (the Render page's Preview mode and the theme editor) aren't logged.",
    ],
    access: [
      { action: "See, download, re-run and delete your own", needs: view },
      { action: "See everyone's, filter by user, bulk delete", needs: "admin" },
    ],
    spec: "docs/features/generation-log.md",
  },
  {
    feature: "Settings and preferences",
    group: "Settings",
    what: "Everyone can change their name and password, see and sign out their sessions, pick light, dark or system appearance, and delete their own account. Pending users (no roles yet) can open Settings too.",
    howTo: "Open the menu with your name in the top right, then Settings.",
    limitations: [
      "Email can only be changed by an admin, from Admin › Users.",
      "The appearance choice is saved in the browser, not the account.",
      "'Last active' on a session updates about once a day, not on every request.",
      "The last admin can't delete their own account.",
    ],
    access: [{ action: "Use", needs: {} }],
    spec: "docs/features/user-preferences.md",
  },
  {
    feature: "Users and roles",
    group: "Admin",
    what: "Admins create users, set their roles, reset passwords, ban, sign out and impersonate them. Roles add up: admin, publisher, reviewer, editor and viewer. A user with no roles is pending and can only see Settings.",
    howTo: "Open Admin › Users.",
    limitations: [
      "There are no invite, verification or password-reset emails; share passwords yourself.",
      "Roles are global; there are no organisations or teams.",
      "Two admins removing each other at the same moment can both succeed, leaving no admin.",
    ],
    access: [{ action: "Manage users", needs: "admin" }],
    spec: "docs/features/user-management-and-roles.md",
  },
  {
    feature: "Admin FAQ",
    group: "Admin",
    what: "This page: every shipped feature, what it does, how to use it, its limits and who can use it.",
    howTo: "Search for any word to filter the entries.",
    limitations: ["Kept current by review, not tooling, so it can lag a change."],
    access: [{ action: "Read", needs: "admin" }],
    spec: "docs/features/admin-faq.md",
  },
  {
    feature: "Render queue and async renders",
    group: "Generations",
    what: "Every logged render (Render page, template generation, re-runs, batch rows) is queued and run by a render worker. The caller normally waits and gets the PDF back as before; if it takes longer than the wait limit (30 s by default) the API answers 202 with the generation id, and the entry finishes in the background. Live previews skip the queue and render straight away.",
    howTo:
      "Nothing to do in the app. API callers can send `async: true` on a render or template generate request to get 202 with `{ generationId, status }` at once, then poll GET /api/generations/:id and download /api/generations/:id/pdf once the status is success.",
    limitations: [
      "Queue pickup adds a few milliseconds; it's shown per entry as queue wait.",
      "If no worker is running, logged renders wait until one starts (Admin › System warns about this).",
      "The app's Render and template pages expect the PDF back; a render slower than the wait limit doesn't show there, but it still finishes and appears in Generations.",
      "There are no webhooks yet; async callers poll.",
    ],
    access: [{ action: "Render (queued like everything else)", needs: view }],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Render workers and scaling",
    group: "Admin",
    what: "One codebase runs as an API process, a render worker, or both. Throughput grows by starting more workers on any machine that reaches the database. If a worker dies mid-render, the job is retried on another worker and the entry shows 2 attempts; template and data errors are not retried.",
    howTo:
      "Set ROLE=api, ROLE=worker or ROLE=all (the default) and RENDER_CONCURRENCY (renders per worker, default 2). Load balancers can use GET /api/health (alive) and GET /api/health/ready (database and queue up; 503 otherwise). Worker-only processes answer only the health endpoints.",
    limitations: [
      "Postgres carries the queue as well as the data; very high volumes will need a dedicated queue.",
      "A killed worker's job is noticed after 10–20 seconds (heartbeat timeout), so that render is slower.",
      "Render timeouts are treated as template problems and not retried.",
      "A job that keeps losing its worker fails after 3 attempts.",
    ],
    access: [{ action: "Configure (environment variables)", needs: "admin" }],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Batches",
    group: "Generations",
    what: "Generate many documents from one published template at once: one PDF per CSV row (in the app) or JSON row (API). The batch shows progress (done, failed, total), each row is an entry in the generation log, rows with invalid data fail alone with their field errors, and batch rows queue behind interactive renders. Download everything as a ZIP of PDFs or as one combined packet PDF.",
    howTo:
      "Open Batches › Run batch, pick a template, upload a CSV, check which column fills which field, and queue it. Open the batch to watch progress, cancel the remaining rows, or download. API: POST /api/templates/:id/versions/:version/batch with `{ rows: [...] }`, or /batch/csv with a file and a column mapping.",
    limitations: [
      "Up to 10,000 rows and 20 MB of CSV or JSON per batch.",
      "Batches always use the latest published version in the app (the API takes any version).",
      "A CSV column fills one value; repeating-group items need one column per item (items.0.name, items.1.name).",
      "Cancel stops rows that haven't started; rows already rendering finish.",
      "The packet download is built in memory, so very large batches are better downloaded as a ZIP.",
      "Each row stores its own copy of the template HTML as its input, which takes space on big batches.",
    ],
    access: [
      { action: "Run and see your own batches", needs: view },
      { action: "See everyone's batches", needs: "admin" },
    ],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Timing breakdown and request ids",
    group: "Generations",
    what: "Every entry records when it was queued, started and finished, how long it waited in the queue, how long Liquid, the Chromium body pass, the header/footer bands and pdf-lib stamping took, the total, which worker ran it and how many attempts it took. Every API response carries an X-Request-Id (yours if you send one), stored on the entries it created.",
    howTo:
      "Open an entry in Generations to see its timing. In the list, sort by Total or Queue wait, or filter with 'Slower than'.",
    limitations: [
      "Chromium time includes waiting for a free browser slot on a busy worker.",
      "After a retry, queue wait counts from the first queueing to the last attempt's start.",
    ],
    access: [{ action: "See for your own entries", needs: view }],
    spec: "docs/features/generation-log.md",
  },
  {
    feature: "System metrics",
    group: "Admin",
    what: "Admin › System lists every process (role, version, renders running, event-loop lag, last heartbeat) and warns when no worker is online. It shows queue depth for interactive and batch renders, renders per minute, error rate, and p50/p95/p99 total time and queue wait, with a breakdown by source and template, over 15 minutes to 7 days.",
    howTo: "Open Admin › System and pick a window. It refreshes every 5 seconds.",
    limitations: [
      "Metrics are computed from the generation log, so deleted entries drop out of them.",
      "No Prometheus endpoint or alerting yet.",
      "Offline processes stay listed for a day.",
    ],
    access: [{ action: "View", needs: "admin" }],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Log retention and CSV export",
    group: "Admin",
    what: "Retention deletes stored PDFs, and optionally inputs, of entries that finished more than N days ago, keeping the entries themselves. The generation list exports as CSV (metadata only, no inputs or PDFs) with the current filters.",
    howTo:
      "Set the days under Admin › System › Retention; it runs daily at 03:17 UTC, or press Run now. Export from Generations › Export CSV.",
    limitations: [
      "Retention changes aren't in an audit log yet.",
      "Re-running an entry whose input was removed is refused.",
      "The export stops at 100,000 rows.",
    ],
    access: [
      { action: "Export your own entries", needs: view },
      { action: "Set and run retention", needs: "admin" },
    ],
    spec: "docs/features/generation-log.md",
  },
];
