import type { Permissions } from "@necodoc/shared";

// Spec: docs/features/admin-faq.md. Rule: every change that ships, changes or removes a
// user-visible feature updates its entry here, in the same change. Limitations mirror the
// spec's "Known limitations", in plain words.

/** Grouped like the nav. */
export const faqGroups = [
  "Templates",
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

const edit = { document: ["edit"] } as const;
const create = { document: ["create"] } as const;
const publish = { document: ["publish"] } as const;
const drafts = "Open drafts and their preview read-only";

const templates: readonly FaqEntry[] = [
  {
    feature: "Designed templates",
    group: "Templates",
    what: "A template is a document designed once and filled in many times: a certificate, quote or letter. It has content, an optional header and footer, page setup, a theme, the fields it needs and one set of sample data. The PDF preview next to the editor is the real renderer, re-run shortly after each edit.",
    howTo:
      "Open Templates › New template, give it a name, then build it tab by tab: Content, Header & footer, Fields, Sample data, Page & theme, CSS. Save with the Save button or ⌘/Ctrl+S. The list filters by status (draft, published, unpublished changes, archived) and searches names and descriptions.",
    limitations: [
      "The editor shows content, not pages. Page breaks, page numbers and the header/footer layout are only visible in the preview.",
      "One draft per template. If someone else saved since you opened it, Save is refused and you have to reload, losing your unsaved changes.",
      "Table column widths aren't carried into the PDF; columns size to their content.",
      "No JavaScript runs in documents, so no client-side charts.",
    ],
    access: [
      { action: "See published templates", needs: view },
      { action: drafts, needs: { document: ["review"] } },
      { action: "Create and duplicate", needs: create },
      { action: "Edit drafts and delete unpublished ones", needs: edit },
    ],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Template editor",
    group: "Templates",
    what: "A word-processor style editor: headings, paragraphs, bold, italic, underline, strikethrough, colour, links, alignment, lists, quotes, tables, images from the asset library or a field, dividers and page breaks, plus necodoc's merge fields, conditional and repeating sections. Pasted content keeps only what a template can hold.",
    howTo:
      "Use the toolbar, the Insert menu, or type / anywhere for the same list. In a table, the second toolbar row adds and removes rows and columns, toggles the header row and makes a row repeat. Click an image to set its width and alt text.",
    limitations: [
      "Pasted colours that aren't plain colours, and links that aren't http(s), mailto, tel or #anchors, are dropped.",
      "Images are block images: no text wrapping around them.",
      "Leading header rows of a table repeat on every page; there's no other control over table page breaks.",
    ],
    access: [{ action: "Edit", needs: edit }],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Merge fields and filters",
    group: "Templates",
    what: "A merge field prints a field's value where it sits, shown as a blue chip. A format can be applied: date (pick a style or type dayjs tokens like MMM D, YYYY), number with decimals, currency with a three-letter code, UPPERCASE, lowercase, Capitalise, or keep line breaks for long text. Headers and footers can also print Page number and Total pages.",
    howTo:
      "Click Field in the toolbar (or type /field), pick the field and a format, then Insert field. Click a chip to change or remove it. A red chip refers to a field that no longer exists or can't be used there, and the page lists every such reference.",
    limitations: [
      "A choice field prints its option value, not its label; give options readable values if you print them.",
      "Formats are a fixed list. For anything else, use a Raw HTML / Liquid block or code mode.",
      "A repeating group's own fields can only be used inside a repeating section or repeated row over that group.",
    ],
    access: [{ action: "Edit", needs: edit }],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Conditional and repeating sections",
    group: "Templates",
    what: "A conditional section (amber) shows its content only when a field matches a rule, e.g. Include rider is ticked. A repeating section (violet) repeats its content once per item of a repeating group, and a table row can repeat the same way, for line-item tables.",
    howTo:
      "Put the cursor on a block and choose Insert › Conditional section or Repeating section; the block is wrapped. Pick the field and rule in the section's header. For a table, put the cursor in a row and pick the group in 'Repeat row for each'. The header buttons unwrap the section or delete it with its content.",
    limitations: [
      "Repeating sections and rows don't nest, and groups can't contain groups.",
      "A condition compares one field with one value; there's no AND/OR yet.",
    ],
    access: [{ action: "Edit", needs: edit }],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Template headers and footers",
    group: "Templates",
    what: "Each template can have a header and a footer, each its own small document with a fixed height in millimetres, inside the page margins. Either can have a different first page, e.g. a letterhead with a logo on page 1 and a slim running header after.",
    howTo:
      "Open Header & footer, turn the band on, set its height and write it like the body. Insert Field › Page number and Total pages for 'Page 1 of 3'. Turn on 'Different first page' for the page-1 version.",
    limitations: [
      "Content taller than the band is cut off.",
      "The first-page version has the same height as the band, so a tall letterhead reserves that space on every page.",
      "CSS can't tell a header from a footer: both are .necodoc-band.",
    ],
    access: [{ action: "Edit", needs: edit }],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Fields and the guided form",
    group: "Templates",
    what: "Fields are the data a template needs: short and long text, number, date, checkbox, choice (one or several), email, image upload, drawn signature and repeating groups. Each has a key, label, help text, required flag, default and type-specific rules (length, pattern, range, decimals, item counts). Sections group them into the steps of the guided form, and a field or section can show only when an earlier field matches a rule.",
    howTo:
      "Open Fields, add a section, then Add field. Click a field to edit it; the key follows the label until you change it. Arrows reorder, the Section menu moves a field to another section. Sample data shows the guided form for the template: 'Fill with examples' generates values, 'Edit as JSON' edits them directly.",
    limitations: [
      "A show-if can only refer to an earlier field (inside a group, an earlier sibling), and compares one field with one value.",
      "Hidden fields are never required, and their values are dropped.",
      "No computed fields and no cross-field rules (e.g. end date after start date).",
      "The JSON Schema export for API callers leaves show-ifs out: conditional fields are optional there, and the API still applies the rules.",
      "Examples for text with a pattern don't match the pattern and need editing.",
      "Renaming a key flags old uses in the content; it doesn't rewrite them.",
    ],
    access: [{ action: "Design fields", needs: edit }],
    spec: "docs/features/template-fields-and-guided-form.md",
  },
  {
    feature: "Code mode",
    group: "Templates",
    what: "For full control, a template's body, header and footer can be edited as HTML and Liquid in a code editor with highlighting, line numbers, bracket matching, search (⌘/Ctrl+F) and completion of field names and necodoc's filters inside {{ }} and {% %}.",
    howTo:
      "Choose ⋯ › Code mode. 'Convert this template' switches it after a warning; 'Duplicate as code template' leaves the visual original alone and opens a code copy.",
    limitations: [
      "Converting is one way: once saved, a code template can't go back to the visual editor.",
      "Code isn't checked against the field list. Publishing only checks that the Liquid parses; mistakes show up in the preview.",
      "No JavaScript runs and nothing loads from the internet; use assets for images and fonts.",
    ],
    access: [
      { action: "Convert", needs: edit },
      { action: "Duplicate as code", needs: create },
    ],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Raw HTML / Liquid blocks",
    group: "Templates",
    what: "A block in a visual template that holds hand-written HTML and Liquid, output exactly as written: a signature layout, a QR code, anything the toolbar can't do. The editor shows the code; the preview shows the result.",
    howTo:
      "Choose Insert › Raw HTML / Liquid (or type /raw), write the code in the dialog and press Apply. The pencil reopens it.",
    limitations: [
      "Not checked against the field list; only Liquid syntax is checked, at publish.",
      "Broken HTML can affect what follows it in the document.",
      "No JavaScript in renders.",
    ],
    access: [{ action: "Add and edit", needs: edit }],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Template CSS",
    group: "Templates",
    what: "Each template can carry its own CSS, added after its theme, in visual and code mode alike. It styles the body and both bands.",
    howTo:
      "Open the CSS tab. Band pages are .necodoc-band; classes used in Raw HTML blocks can be styled here.",
    limitations: [
      "Unrestricted, so it can break layout; check the preview.",
      "Remote @import and URLs don't load.",
      "Header and footer share the .necodoc-band class.",
    ],
    access: [{ action: "Edit", needs: edit }],
    spec: "docs/features/document-templates.md",
  },
  {
    feature: "Publishing and versions",
    group: "Templates",
    what: "Editors change a draft; publishers turn the saved draft into a numbered version with an optional change note. A version freezes content, fields, page setup, theme and sample data, so documents made from it never change. Archiving hides a template from filling and the API without losing its versions.",
    howTo:
      "Save, then Publish (it's off while there are unsaved changes or nothing changed). Versions lists every version with publisher, date and note; Preview shows a version, 'Restore to draft' copies it back into the draft. ⋯ › Archive and Restore hide and show the template.",
    limitations: [
      "No approval step: anyone who can publish can publish.",
      "A template that was ever published can't be deleted, only archived.",
      "Previewing an old version uses the current theme; the published PDF uses the frozen one.",
      "There's no diff between the draft and a version yet.",
    ],
    access: [
      { action: drafts, needs: { document: ["review"] } },
      { action: "Publish, archive and restore", needs: publish },
      { action: "Restore a version to the draft", needs: edit },
    ],
    spec: "docs/features/publishing-and-versions.md",
  },
];

export const faq: readonly FaqEntry[] = [
  ...templates,
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
      "A template uses its theme as it was when published; later theme edits only reach the draft's preview and the next version.",
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
  {
    feature: "Render queue view",
    group: "Admin",
    what: "A live list of the jobs in the render queue: what is waiting, running, retrying, or recently failed, with the file, batch, worker and timings for each. It refreshes every few seconds.",
    howTo:
      "Open Admin › Queue. Click a state to filter by it, or pick a queue. Pause refresh to read in peace. Cancel removes a waiting job, or drops the result of a running one.",
    limitations: [
      "It reads the queue library's job table directly, so it may need a fix after a library upgrade.",
      "Cancelling a running job doesn't stop the browser: the render finishes, but its result is thrown away and the generation shows as cancelled.",
      "The list has a fixed order (running first, then by priority and age) and can't be sorted.",
      "Completed jobs are only kept by the queue for 7 days.",
    ],
    access: [{ action: "View and cancel jobs", needs: "admin" }],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Output storage (disk, S3, Azure Blob)",
    group: "Admin",
    what: "Generated PDFs are stored by a storage driver chosen in the API's environment: a local or shared directory, any S3-compatible bucket, or Azure Blob Storage. Assets, uploaded PDFs and templates stay in the database. Admin › System shows the active driver, and the readiness check fails when a node can't write and read its storage.",
    howTo:
      "Set STORAGE_DRIVER and restart every API and worker process. Disk (default): STORAGE_DIR=/mnt/necodoc; with more than one host it must be a shared mount (NFS, EFS, Azure Files). AWS S3: STORAGE_DRIVER=s3, S3_BUCKET, S3_REGION; leave the keys unset to use the IAM role, add S3_SSE=aws:kms and S3_KMS_KEY_ID for KMS. MinIO: also S3_ENDPOINT=http://minio:9000, S3_FORCE_PATH_STYLE=true, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. Cloudflare R2: S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com, S3_REGION=auto, plus an R2 API token's key pair. Azure Blob: STORAGE_DRIVER=azure, AZURE_STORAGE_CONTAINER, and either AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT (with AZURE_STORAGE_KEY, or alone to use the managed identity, which needs the Storage Blob Data Contributor role). STORAGE_PREFIX puts objects under a folder. PDFs made before the switch stay in the database until you run `pnpm --filter @necodoc/api storage:migrate` (or `node dist/storage-migrate.mjs`), which is safe to rerun.",
    limitations: [
      "The bucket or container must exist; necodoc doesn't create it.",
      "One driver per deployment. The migration moves PDFs out of the database only, not between drivers.",
      "Changing STORAGE_DIR or STORAGE_PREFIX applies to new PDFs only.",
      "A crash between storing a PDF and recording it, or a failed delete, can leave an orphaned object (logged).",
      "STORAGE_REDIRECT=presigned sends downloads straight to the bucket; viewing them inside the app then needs CORS on the bucket.",
    ],
    access: [{ action: "See the active driver", needs: "admin" }],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Signed download links",
    group: "Generations",
    what: "A link to one generated PDF that works without signing in until it expires, for emails, webhooks or handing a document to another system. Each link records who made it and how often it was used.",
    howTo:
      'POST /api/generations/<id>/link with {"expiresInSeconds": 3600} (60 seconds to 7 days) returns {url, expiresAt}. Add ?download=1 to the URL to save instead of open.',
    limitations: [
      "A link can't be revoked before it expires, except by deleting the generation.",
      "Changing DOWNLOAD_SIGNING_SECRET (or BETTER_AUTH_SECRET, if that's unset) voids every live link.",
      "There's no button in the app yet; it's an API call.",
    ],
    access: [{ action: "Make a link to an entry you can see", needs: view }],
    spec: "docs/features/generation-log.md",
  },
  {
    feature: "PDF overlay templates",
    group: "Templates",
    what: "Fill a PDF you already use (a government form, a carrier's bond) instead of rebuilding it. You upload the PDF, place boxes where the answers go, and bind each box to a template field with a Liquid expression. Generation writes the values onto the original pages, so the output looks exactly like the form. Fields, sample data, publishing, versions, batches and the generation log work as for designed templates.",
    howTo:
      "Templates › New template › Kind: Fill an existing PDF, pick the file (up to 20 MB, 200 pages). On the Boxes tab, choose a box type in 'Draw', drag on the page, then set its value in the inspector: pick 'Bind to a field' or type a new label and 'Create field'. Click a box to move or resize it; arrow keys nudge it (Shift for 10 pt), Delete removes it, ⌘D duplicates it. The PDF tab has Flatten (no editable fields in the output) and 'Upload a new PDF' for a new revision of the form.",
    limitations: [
      "Text never flows from one box to the next. Auto-shrink stops at the minimum size; past it the text is cut and the generation records a warning.",
      "Signature boxes draw an image. Signer ids are saved for future signing packages but do nothing yet.",
      "Uploaded fonts must be TTF or OTF; a WOFF2 font falls back to Noto Sans.",
      "Pure XFA forms and PDFs that need a password to open can't be used.",
      "No snapping to lines in the editor; use AI detection or the coordinates in the inspector for precise placement.",
      "Replaced or deleted PDFs stay in the database (published versions may still use them).",
    ],
    access: [
      { action: drafts, needs: { document: ["review"] } },
      { action: "Create and upload PDFs", needs: create },
      { action: "Place boxes and edit drafts", needs: edit },
      { action: "Publish", needs: publish },
    ],
    spec: "docs/features/pdf-overlay-templates.md",
  },
  {
    feature: "AcroForm import",
    group: "Templates",
    what: "Many PDFs already have fillable form fields. 'Import form fields' turns each one into a box plus a template field in one click: keys and labels come from the field's tooltip or name, types from the field (text, multiline, checkbox, choice, signature) and from words like 'date'. Imported boxes fill the PDF's own field by name instead of drawing over it, so the output stays fillable unless you flatten it.",
    howTo:
      "Open an overlay template's Boxes tab and click 'Import form fields (N)'; N counts the fields not mapped yet, so running it again only adds new ones. Rename keys and labels on the Fields tab. Any box can be pointed at a form field in the inspector's 'Form field' menu.",
    limitations: [
      "Keys are only as good as the PDF's field names. Tools like Acrobat often name a field after the text before it, which can be the wrong blank; check them.",
      "Push buttons (print, reset) and read-only fields are skipped.",
      "A value that isn't one of a dropdown's or radio group's options is skipped with a warning.",
      "Signature fields can't take a value, so their boxes draw the signature image over them instead.",
    ],
    access: [{ action: "Import", needs: edit }],
    spec: "docs/features/pdf-overlay-templates.md",
  },
  {
    feature: "AI field detection",
    group: "Templates",
    what: "For PDFs without form fields, 'Detect with AI' asks Claude (Sonnet) to find the blanks, checkboxes and signature lines on each page and suggest a box, key, label and type for each. The server then snaps every box onto the printed line, cell or square it belongs to. Suggestions show dashed beside your boxes; nothing is saved until you accept them. Only shown when AI is turned on.",
    howTo:
      "On an overlay template's Boxes tab, click 'Detect with AI' and wait (5 to 10 seconds a page). Review the list: click one to see it on the page, tick to accept, × to reject. 'Accept all but approximate' takes every box that lined up with something printed; approximate ones are marked ≈. Accepting reuses a field with the same key, or creates it.",
    limitations: [
      "Suggestions only: check every box and rename keys; the names are guesses.",
      "Works best on typed PDFs with drawn lines or boxes. Untested on scans, rotated pages and non-Letter sizes.",
      "Multi-line answers are sometimes one box, sometimes one per line; several blanks on one line may merge.",
      "Blanks that are already filled in (a printed $5,000.00) can still be suggested.",
      "About 1.5 cents a page at Anthropic's prices, and 5 to 10 seconds a page; only the first 20 pages are checked.",
      "The page images are sent to Anthropic. Text in the PDF is treated as data, and the result is a fixed list you review, but don't use it on documents that mustn't leave your systems.",
    ],
    access: [{ action: "Run detection", needs: edit }],
    spec: "docs/features/pdf-overlay-templates.md",
  },
  {
    feature: "Encrypted PDFs",
    group: "Templates",
    what: "Many government forms are encrypted with an empty password: every viewer opens them without asking, and the encryption only carries print and edit restrictions. necodoc accepts these, fills them, and saves the output unencrypted. PDFs that really need a password to open are refused with a message saying so.",
    howTo:
      "Nothing to do: upload the form as usual. The PDF tab says when a form was encrypted. To use a password-protected PDF, open it with its password, print or save it as a new PDF, and upload that.",
    limitations: [
      "Outputs lose the original's print and edit restrictions.",
      "Filling invalidates any digital signature in the original form.",
    ],
    access: [{ action: "Upload", needs: create }],
    spec: "docs/features/pdf-overlay-templates.md",
  },
  {
    feature: "Turning AI on and off",
    group: "Admin",
    what: "AI features (currently field detection) are on only when the API has an Anthropic key. Without one, every AI button is hidden and the AI endpoints answer 404, so no document content can reach a model.",
    howTo:
      "Set ANTHROPIC_KEY on every API and worker process and restart them; workers run the detection jobs. AI_MODEL picks the model (default claude-sonnet-5-5). Remove the key (or set it empty) and restart to turn AI off.",
    limitations: [
      "No per-user quota or usage report yet; each run costs money on the key's account.",
      "One provider (Anthropic) for now.",
    ],
    access: [{ action: "Configure", needs: "admin" }],
    spec: "docs/features/pdf-overlay-templates.md",
  },
];
