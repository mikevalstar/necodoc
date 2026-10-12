import type { Permissions } from "@necodoc/shared";
import { ssoGuides, trustedHeaderGuides } from "./faq-sso";

// Spec: docs/features/admin-faq.md. Rule: every change that ships, changes or removes a
// user-visible feature updates its entry here, in the same change. Limitations mirror the
// spec's "Known limitations", in plain words.

/** Grouped like the nav. */
export const faqGroups = [
  "Documents",
  "Templates",
  "Render",
  "Themes",
  "Assets",
  "Generations",
  "API",
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
  /** Step-by-step setup with copyable examples, for features set up outside the app. */
  guides?: readonly FaqGuide[];
};

/** One provider × protocol. Guides with the same `provider` share a tab. */
export type FaqGuide = {
  provider: string;
  protocol: string;
  steps: readonly string[];
  examples: readonly FaqExample[];
};

export type FaqExample = {
  title: string;
  lang: "env" | "sh" | "json" | "js";
  code: string;
  note?: string;
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
      "Open Templates › New template, give it a name, then build it tab by tab: Content, Header & footer, Fields, Sample data, Page & theme, CSS. Save with the Save button or ⌘/Ctrl+S. The list filters by status (draft, published, unpublished changes, archived) and searches names and descriptions. Switch between the gallery (a thumbnail of each template's first page) and the table with the buttons next to the count; your browser remembers the choice.",
    limitations: [
      "The editor shows content, not pages. Page breaks, page numbers and the header/footer layout are only visible in the preview.",
      "One draft per template. If someone else saved since you opened it, Save is refused and you have to reload, losing your unsaved changes.",
      "Table column widths aren't carried into the PDF; columns size to their content.",
      "No JavaScript runs in documents, so no client-side charts.",
      "Gallery thumbnails show the published version's first page with its sample data, or the saved draft's before the first publish. A draft's thumbnail updates when the draft is saved, not when its theme or snippets change.",
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
    what: "A merge field prints a field's value where it sits, shown as a blue chip. A format can be applied: date (pick a style, including long and short dates in the document language, or type dayjs tokens like MMM D, YYYY), number with decimals, currency with a three-letter code, UPPERCASE, lowercase, Capitalise, or keep line breaks for long text. Headers and footers can also print Page number and Total pages.",
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
    what: "Fields are the data a template needs: short and long text, number, date, checkbox, choice (one or several), email, image upload, signature (drawn, or typed for keyboard users) and repeating groups. Each has a key, label, help text, required flag, default and type-specific rules (length, pattern, range, decimals, item counts). Sections group them into the steps of the guided form, and a field or section can show only when an earlier field matches a rule.",
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
      "Without the 'Require review before publish' setting, anyone who can publish can publish.",
      "A template that was ever published can't be deleted, only archived.",
      "Previewing an old version uses the current theme; the published PDF uses the frozen one.",
      "The diff compares the saved draft with the latest version only.",
    ],
    access: [
      { action: drafts, needs: { document: ["review"] } },
      { action: "Publish, archive and restore", needs: publish },
      { action: "Restore a version to the draft", needs: edit },
    ],
    spec: "docs/features/publishing-and-versions.md",
  },
  {
    feature: "Snippet library",
    group: "Templates",
    what: "A snippet is a named block of content (a clause, a disclaimer, a signature block) written once and used in many templates. It's edited in the same editor as templates, or as HTML/Liquid, can use merge fields and include other snippets. Drafts always show the snippet as it is now; publishing a template freezes a copy, so a snippet edit never changes a published version. The snippet's page lists the templates using it and flags published versions that have an older copy.",
    howTo:
      "Open Snippets › New snippet, write the content and list the field keys it expects (the editor's Field button offers only those). Save with the Save button or ⌘/Ctrl+S. In a template, Insert › Snippet (or type /snippet) adds it as a block; code templates and API HTML write {% render 'key' %}. After editing a snippet, its 'Used by' list shows which templates to open and republish.",
    limitations: [
      "Snippets are global: no folders or per-snippet permissions.",
      "No bulk republish: open each out-of-date template and publish it.",
      "Snippets don't work in PDF overlay templates.",
      "Inside a repeating section a snippet sees only top-level fields, not the repeated item.",
      "Expected fields are checked one level deep; snippets included by a snippet aren't checked against the template.",
      "The key can't change after creation. A snippet used by a draft or another snippet can't be deleted; archive it instead.",
    ],
    access: [
      { action: "See snippets", needs: { document: ["review"] } },
      { action: "Create", needs: create },
      { action: "Edit, archive and delete", needs: edit },
    ],
    spec: "docs/features/snippet-library.md",
  },
  {
    feature: "Review and approval",
    group: "Templates",
    what: "An editor submits a template's saved draft for review with a note. A reviewer opens it from Templates › Reviews and sees what changed since the published version (fields, sections, content blocks, header/footer, page setup, theme, snippets, overlay boxes), a page-by-page visual diff and the test results, then approves it or requests changes in a comment thread. With 'Require review before publish' on (Admin › System › Publishing), only a draft that still matches an approved review can be published; any later edit to the draft, its theme or its snippets makes the review stale.",
    howTo:
      "Editor: save, then Submit for review (header, or the Reviews tab). Reviewer: Templates › Reviews, open the review, read the Changes, Visual diff and Tests tabs, then Approve (it asks first if tests fail) or write a comment and Request changes. Editor: fix the draft, save and Resubmit, or Withdraw it from the review page or the template. Publisher: Publish from the review page or the template. The template's Reviews tab lists every review.",
    limitations: [
      "One open review per template, shared by every reviewer; the first decision wins.",
      "No assignment: every reviewer is asked.",
      "The setting is global, not per template.",
      "By default a reviewer can't approve their own submission; 'Allow self-approval' changes that for everyone.",
      "Editing a theme or snippet makes every open review that uses it stale.",
    ],
    access: [
      { action: "Submit, resubmit and withdraw", needs: edit },
      { action: "Approve or request changes", needs: { document: ["review"] } },
      { action: "Publish an approved draft", needs: publish },
      { action: "Turn the publishing settings on or off", needs: "admin" },
    ],
    spec: "docs/features/review-and-approval.md",
  },
  {
    feature: "Notifications",
    group: "Templates",
    what: "A bell in the nav shows how many notifications are unread. Reviewers are told when a review is requested; the submitter when changes are requested, when it's approved and when it's published; publishers when a review is approved; the approver when it's published.",
    howTo:
      "Click the bell and pick a notification to open its review; that marks it read. 'Mark all read' clears the count.",
    limitations: [
      "In-app only: no email or chat.",
      "The count refreshes every 30 seconds, not instantly.",
      "Only review events notify; comments don't.",
    ],
    access: [{ action: "See your own notifications", needs: view }],
    spec: "docs/features/review-and-approval.md",
  },
  {
    feature: "Template test cases",
    group: "Templates",
    what: "Named data sets saved with a template, each with optional checks: the data validates against the fields, no overlay text was cut to fit, the page count equals or is at most N, and text the PDF must or mustn't contain. Run tests renders every case against the saved draft and shows pass or fail with the failing checks. Results show on the Tests tab, the review page and the publish dialog; 'Block publish when tests fail' (Admin › System › Publishing) makes them a gate.",
    howTo:
      "Template › Tests › New test case: name it, take the data from the sample data, a past generation, one of your documents or pasted JSON, and tick the checks. Run tests reruns them; they also rerun after each save.",
    limitations: [
      "Tests run on the saved draft, not unsaved edits.",
      "Renders aren't logged, so they don't appear in Generations.",
      "Text checks read the text in the PDF: wide letter-spacing can split a word into letters, so a check for it fails.",
      "Results aren't stored; they run again each time they're shown.",
      "Generations are offered only if they're yours (admins: anyone's) and still have their input; documents only if they're yours.",
    ],
    access: [
      { action: "Run tests", needs: { document: ["review"] } },
      { action: "Add, edit and delete test cases", needs: edit },
    ],
    spec: "docs/features/template-test-cases-and-visual-diff.md",
  },
  {
    feature: "Visual diff",
    group: "Templates",
    what: "Renders the latest published version and the saved draft with the same data (sample data or a test case), compares every page pixel by pixel and shows which pages changed and by how much. Each page shows side by side, as an overlay with an opacity slider, as a diff image (green: only in the draft, red: only in the published version) or as a line diff of its text.",
    howTo:
      "Open a review's Visual diff tab, or Show visual diff in the publish dialog. Pick the data, then a page from the list.",
    limitations: [
      "Compares with the latest published version only; a first version has nothing to compare with.",
      "Pages are matched by position: inserting a page early marks every later page changed.",
      "Up to the first 20 pages.",
      "Tiny anti-aliasing differences can show as a few changed pixels.",
    ],
    access: [{ action: "See the visual diff", needs: { document: ["review"] } }],
    spec: "docs/features/template-test-cases-and-visual-diff.md",
  },
  {
    feature: "Signing packages",
    group: "Templates",
    what: "Hand a generated document to DocuSign, Dropbox Sign or Adobe Acrobat Sign with every signature, initials, date, name and signer-text box already placed. A template lists its signers (role, signing order, name and email from the data); sign boxes name a signer. Each generation then stores where every box landed, and offers JSON ready for the provider. necodoc doesn't collect signatures itself.",
    howTo:
      "On a template's Signing tab, add signers and set their name and email (Liquid, e.g. {{ principal_email }}). In a designed template, insert a Sign box from the Insert or / menu and size it; in an overlay template, draw a signature box and pick a signer. After generating, open the entry under Generations: the Signing package section lists the signers, downloads the package JSON and the PDF, and 'Show boxes on the PDF' draws the boxes over the pages so you can check them. API callers add signing to a generate or render request, or call GET /api/v1/generations/:id/signing-package.",
    limitations: [
      "Not an e-signature product: no signer identity checks, audit trail or legal compliance. That's the provider's job, and necodoc never calls the provider or stores its credentials.",
      "Positions in designed and HTML documents are read back from the PDF and are approximate, within about a point. Overlay boxes are exact.",
      "Designed documents carry invisible marker text at each box (used to find it, and by DocuSign anchor tabs). It shows up if someone copies or searches the PDF's text; the API can leave it out.",
      "Sign boxes in headers and footers aren't found, and a box never splits across a page break.",
      "Dropbox Sign has no full-name field (it becomes a text field), and its placement assumes US Letter pages. Adobe Sign needs the signer ids swapped for its own participant ids.",
      "Combined packets don't carry their parts' signing packages.",
    ],
    access: [
      { action: "Add signers and sign boxes", needs: edit },
      { action: "Download a generation's signing package", needs: view },
    ],
    spec: "docs/features/signing-packages.md",
  },
];

export const faq: readonly FaqEntry[] = [
  ...templates,
  {
    feature: "HTML to PDF rendering",
    group: "Render",
    what: "necodoc turns HTML and CSS into a PDF with a real browser engine (Chromium), so flexbox, grid, tables that break across pages and web fonts all work. The Render page, the theme preview and every future template use this same renderer, so a preview is exactly the PDF you get.",
    howTo:
      "Open Render, write HTML (and optional CSS), pick a theme, page size, orientation and margins on Page & theme, then press Render (or ⌘/Ctrl+Enter). The bar above the PDF shows its pages, size and how long it took. Turn on Preview to try things without adding an entry to the generation log. Output sets PDF/A, accessible PDF/UA, certification and the document language. API call shows the same render as a POST /api/v1/render call in curl, TypeScript, Python, .NET or Java, updating as you edit, with a copy button.",
    limitations: [
      "No JavaScript runs in rendered pages: no client-side charts or computed layout.",
      "Nothing is fetched from the internet. Remote images, fonts and @import URLs don't load; upload them as assets or inline them as data: URLs.",
      "Margins and header/footer heights are in millimetres. Page sizes are Letter, A4 and Legal, portrait or landscape.",
      "Chromium rounds millimetre page sizes up by under a point (A4 is 595.9 × 841.9 pt, not 595.3); headers and footers still line up.",
      "Requests and stored files are capped at 20 MB, and renders time out. Long renders aren't queued as background jobs.",
      "The API call reads the key from $NECODOC_API_KEY; it never holds a real key. Create one with the render:html scope. API renders are always logged (no preview), and the .NET and Java snippets need C# 11 and Java 15 for their multi-line strings.",
      "Translations aren't on the Render page; send `translations` in the API call to try them.",
      "Certified renders fail when the server has no certificate (see Admin › System › Configuration), and previews aren't certified.",
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
    what: "HTML, headers and footers are Liquid templates, filled with JSON data before rendering: {{ customer.name }}, {% if %}, {% for %}. Values are HTML-escaped unless you add | raw. Extra filters: date (dayjs formats like MMMM D, YYYY, or LL for the document language's long date), number, currency, t (translate), qrcode, barcode and asset_url. Dates, numbers and money format for output.lang unless given a locale.",
    howTo:
      "Put data in the Data tab on Render as a JSON object and reference it in the HTML. Examples: {{ total | currency: 'EUR' }}, {{ signed_on | date: 'D MMM YYYY' }}, <img src=\"{{ invoice_id | qrcode }}\">.",
    limitations: [
      "Dates use dayjs tokens (YYYY-MM-DD), not the strftime codes (%Y) other Liquid tools use.",
      "An unknown filter is an error, not a blank.",
      "{% render 'key' %} includes a snippet from the library; partials can't come from anywhere else.",
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
      "Open Themes, duplicate a starter, then change its settings and free CSS. The sample PDF beside (or above) the settings updates as you type. Pick the theme on the Render page to use it.",
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
      "Open Assets and use Upload, or drop files on the library. Use 'Copy reference' to get the snippet: {{ 'asset-id' | asset_url }} in HTML, or https://assets.necodoc.invalid/<asset id> in CSS. Fonts are picked in the theme editor.",
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
      'Open Generations and narrow it down: type in the filter bar (free text searches file name, template name, error or request id, or a pasted generation or batch id; tokens like status:error,cancelled source:api render:>0.5s since:7d template:"Quote" key:prod batch:3f2a filter, with suggestions as you type; press Enter to apply), or use the selects below it, which stay in step with the tokens (user, date range, batch, API key and minimum duration sit under More filters, which shows how many are set); admins also filter by user. The render-time histogram above the table shows how long the matching renders took, with p50, p95, p99 and the failed count: pick a bar, or drag across several, to filter to that range. Click a column heading to sort, pick extra columns (worker, attempts, queue wait, batch) under Columns, and choose 25 to 200 rows per page. The address bar holds all of it, so copy the URL to share or bookmark a view, and Back undoes the last change. Click a row to see its input, view or download the PDF, re-run it, or delete it. Export CSV downloads everything matching the filters; admins can bulk delete it too.',
    limitations: [
      "Inputs can hold personal data and are kept until someone deletes them or the retention setting removes them (Admin › System).",
      "Stored PDFs grow the database over time.",
      "Re-running a render whose theme or asset has since been deleted fails.",
      "A re-run matches the original page for page, not byte for byte (each PDF carries its creation time).",
      "Bulk delete needs at least one filter, so the whole log can't be wiped in one go.",
      "Sorting and paging happen on the server, a page at a time (at most 200 rows). Sorting by a timing puts unfinished entries, which have none yet, first when sorting slowest first.",
      "The CSV export stops at 100,000 rows.",
      "Previews (the Render page's Preview mode and the theme editor) aren't logged.",
      "The histogram and its percentiles leave out entries still queued or running (they have no end-to-end time yet), and it ignores the render-time range so you can see where the range sits.",
      "Filter-bar names (template:, user:, key:) match what the page has loaded; an ambiguous name takes the first match, and a token that matches nothing is reported rather than dropped.",
    ],
    access: [
      { action: "See, download, re-run and delete your own", needs: view },
      { action: "See everyone's, filter by user, bulk delete", needs: "admin" },
    ],
    spec: "docs/features/generation-log.md",
  },
  {
    feature: "Saved views",
    group: "Generations",
    what: "Save a big table's filters, sort, page size and columns under a name and get them back from the table's Views menu, in any browser. Works on the generation log and the audit log. Admins can share a view with everyone who can open that table.",
    howTo:
      "Set up the table, then Views › Save current view… and name it (admins can switch on Share with everyone). Pick a view from the same menu to open it; the button shows its name while the table still matches. Views › Manage views… renames a view, updates it to the current filters, shares or unshares it (admins), or deletes it.",
    limitations: [
      "Views store ids: if a template, user, key or batch in a view is deleted, the view still filters by it and shows nothing.",
      "Shared means everyone who can open the table; there are no per-team views.",
      "Only admins can change or delete a shared view; others can save their own copy.",
      "Changes to shared views are in the audit log; private views aren't audited.",
      "A user's views are deleted with their account, shared ones included.",
    ],
    access: [
      { action: "Save, rename and delete your own views", needs: view },
      { action: "Share views, and change or delete any shared view", needs: "admin" },
    ],
    spec: "docs/features/saved-views.md",
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
    what: "Admins create users, set their roles, reset passwords, ban, sign out and impersonate them. Roles add up: admin, publisher, reviewer, editor and viewer. A user with no roles is pending and can only see Settings. The Sign-in column shows whether each person uses a password, single sign-on or both.",
    howTo:
      "Open Admin › Users. New sign-ups waiting for a role are listed at the top under Waiting for access; filter the list by role or status (active, pending, banned).",
    limitations: [
      "There are no invite, verification or password-reset emails; share passwords yourself.",
      "Roles are global; there are no organisations or teams.",
      "Two admins removing each other at the same moment can both succeed, leaving no admin.",
    ],
    access: [{ action: "Manage users", needs: "admin" }],
    spec: "docs/features/user-management-and-roles.md",
  },
  {
    feature: "Single sign-on (Entra ID, Auth0, SiteMinder)",
    group: "Admin",
    what: "People sign in with their organisation's account over OIDC or SAML: Microsoft Entra ID, Auth0, SiteMinder or any other identity provider. The first sign-in creates their necodoc account. A role map turns IdP groups into necodoc roles and is re-applied at every sign-in; anyone in no mapped group is pending unless default roles are set. Email and password can be turned off. Admin › Users shows how each person signs in.",
    howTo:
      "The operator sets it in env: SSO_PROVIDERS plus SSO_<ID>_* settings per provider, then restarts. Setup guides for Entra ID, Auth0 and SiteMinder, each over OIDC and SAML, are below: what to set up at the IdP (redirect or ACS URL, entity id, claims and groups), the env block, a role map and how to test. Every setting and the troubleshooting table are in the developer docs: /self-hosting/sso/ (apps/devdocs/src/content/docs/self-hosting/sso.md).",
    limitations: [
      "An existing account with the same email isn't taken over; sign-in is refused unless the provider is set to link existing users.",
      "With a role map, roles you set by hand are replaced at the person's next sign-in.",
      "Signing out of necodoc doesn't sign out of the identity provider (no single logout).",
      "Sign-in has to start from necodoc's login page; IdP portal tiles must link to it.",
      "Providers change only through env and a restart, and SAML certificates have to be updated by hand when the IdP rotates them.",
      "Service accounts can never sign in this way.",
    ],
    access: [{ action: "Configure (env, by the operator)", needs: "admin" }],
    spec: "docs/features/single-sign-on.md",
    guides: ssoGuides,
  },
  {
    feature: "Trusted-header sign-in (SiteMinder web agent)",
    group: "Admin",
    what: "For installs behind a SiteMinder web agent or similar proxy: necodoc believes a header such as SM_USER that names the signed-in user, but only on requests from the proxy's addresses. Accounts and roles work as for single sign-on. Off unless configured; the API logs a warning at every start while it's on.",
    howTo:
      "The operator adds a provider with TYPE=header, the header names and TRUSTED_PROXIES. The SiteMinder setup, env block and a spoofing check are below; the full checklist is at /self-hosting/sso/#trusted-header-mode in the developer docs.",
    limitations: [
      "Anything that can reach necodoc from a trusted proxy address can sign in as anyone. Use SAML or OIDC where you can.",
      "The proxy must strip these headers from client requests, and necodoc must not be reachable around it.",
      "A necodoc session outlives the proxy's session until it expires or the person signs out.",
    ],
    access: [{ action: "Configure (env, by the operator)", needs: "admin" }],
    spec: "docs/features/single-sign-on.md",
    guides: trustedHeaderGuides,
  },
  {
    feature: "Public demo mode",
    group: "Admin",
    what: "For a public demo only: every visitor is signed in to one shared demo account (demo@necodoc.com, an admin) with no login, and a banner says that anything entered is public and counts down to the next reset. Every night the demo is rebuilt from the sample data; while that runs, visitors see a page saying the demo is resetting, which reloads by itself. Sign-in, registration, single sign-on and Sign out are off. Visitors can explore every page, admin ones included, but what could harm the demo for everyone is turned off: user management, the account's password and sessions, creating or rotating API keys, retention, deleting the log in bulk and pausing a queue. Those controls show disabled with the reason. Webhooks are recorded as skipped instead of sent, and renders, uploads, batches, sign-ins and AI are limited per address.",
    howTo:
      "The operator sets DEMO_MODE=true and restarts; INSTANCE_ENV=demo labels the instance. The demo account is created on start if it's missing. For the nightly reset, schedule pnpm demo:reset (with the instance's env file and the commands that stop and restart its processes) and set DEMO_RESET_TIME and DEMO_RESET_TZ to the same time so the banner's countdown matches. The DEMO_* limits (renders, uploads, batches, batch rows, body size, sign-ins, AI per address and per day) have defaults and are listed in the configuration reference. Set DEMO_MODE on the workers too, so webhooks are skipped. Never turn it on for an installation with real data.",
    limitations: [
      "Every visitor is the same admin and sees what everyone else entered; they can still edit or delete templates, themes and documents one at a time until the reset.",
      "Limits are per address and kept in the API's memory: a restart starts them again, and many addresses get many allowances. The AI cap for the whole demo bounds the spend.",
      "Uploads are size-limited, not virus-scanned.",
      "A reset takes the demo away for a few minutes, and anything entered that day is gone.",
      "If the sample data fails to load, the demo comes back empty apart from the demo account until the next reset.",
      "Everyone shares one identity, so the audit log can't tell visitors apart.",
    ],
    access: [{ action: "Configure (env, by the operator)", needs: "admin" }],
    spec: "docs/features/public-demo.md",
  },
  {
    feature: "Admin FAQ",
    group: "Admin",
    what: "This page: every shipped feature, what it does, how to use it, its limits and who can use it.",
    howTo:
      "Search for any word to filter the entries (press / to jump to the search box); matches are highlighted. The category list jumps to a section. The link button next to an entry copies a link that opens this page at it.",
    limitations: ["Kept current by review, not tooling, so it can lag a change."],
    access: [{ action: "Read", needs: "admin" }],
    spec: "docs/features/admin-faq.md",
  },
  {
    feature: "Navigation and getting started",
    group: "Admin",
    what: "The sidebar groups the app into Documents, Templates, Developers and Admin, with the current section's pages underneath; the top bar shows where you are, Search or jump to… (the command palette), Help and notifications. Your name at the foot of the sidebar opens the account menu (Settings, My usage, Sign out), next to a light/dark toggle. Tables have a comfortable or compact row setting. The home page shows a Get started checklist to people who set necodoc up, ticking off each step (design a template, upload a PDF, publish, fill a document, get an API key, invite the team) as it happens, with the next one in marigold.",
    howTo:
      "Pick a section, then a page under it. Collapse the sidebar to icons with the button by the logo; in the icon rail (always used below 1000 px wide and in the template editor) a section's icon opens a menu of its pages. Switch table rows between comfortable and compact with the toggle above a table or in Settings. The sidebar and row choices stay in that browser. Hide the checklist with Hide checklist; it stays hidden in that browser. Help links next to page titles open the matching entry here.",
    limitations: [
      "Items a role can't use are hidden; the pages still refuse direct links.",
      "The template editors need a tablet-sized screen or larger.",
      "A hidden checklist can't be brought back except by clearing the browser's storage.",
    ],
    access: [
      { action: "Use the app", needs: view },
      { action: "See the Admin section and Help links", needs: "admin" },
    ],
    spec: "docs/features/app-shell-and-navigation.md",
  },
  {
    feature: "Command palette",
    group: "Admin",
    what: "One search box for the whole app. It jumps to any page your roles can open, finds templates, documents, generations (by file name or id), snippets, themes and, for admins, users, and runs common actions: New template, Upload PDF, New document, Create API key, switch light/dark, compact table rows and, for admins, the ops status bar. With an empty box it lists what you opened from it recently.",
    howTo:
      'Press Ctrl+K (⌘K on a Mac) anywhere, or click Search or jump to… in the top bar. Type part of a name, move with the arrow keys and press Enter. "Show all" opens the list page with the search filled in.',
    limitations: [
      "Matches names (and template descriptions), not template content or answers inside documents.",
      "A few hits per group; generations and users are searched once you've typed two characters.",
      "Recent items are kept in this browser only.",
    ],
    access: [
      { action: "Use it", needs: view },
      { action: "Find users, toggle the ops status bar", needs: "admin" },
    ],
    spec: "docs/features/command-palette.md",
  },
  {
    feature: "Instance name and environment label",
    group: "Admin",
    what: 'The top of the sidebar, and the sign-in page, can name this installation with its environment, e.g. "Harbour Surety · PROD", coloured red for prod, amber for staging and green for dev, so nobody mistakes staging for production. The collapsed sidebar shows the name\'s initials.',
    howTo:
      "Set INSTANCE_NAME (and optionally INSTANCE_ENV: prod, staging or dev) in the server's environment, e.g. the Compose .env or the Helm chart's config values, then restart.",
    limitations: [
      "A label only: one installation is one organisation, there's no switching between instances.",
      "Changing it means changing the environment and restarting the API.",
    ],
    access: [{ action: "See it", needs: view }],
    spec: "docs/features/app-shell-and-navigation.md",
  },
  {
    feature: "Ops status bar",
    group: "Admin",
    what: "An optional thin bar along the bottom of every page for admins: whether the API answers, the render queue (waiting and running), workers online with busy/total slots, p95 render time and failure rate over the last hour, and the API version (flagged when other versions are online, mid-deploy). A coloured dot marks anything that needs a look. Each item opens Admin › System or Admin › Queue.",
    howTo:
      'Turn it on in Settings › Appearance › Ops status bar, or with "Show ops status bar" in the command palette. It\'s per browser and off by default.',
    limitations: [
      "Refreshes every 30 seconds, and not at all while the tab is in the background.",
      "Admins only; there's no separate operations role.",
      "Hides p95 and failure rate below 1000 px wide.",
    ],
    access: [{ action: "Turn on and see it", needs: "admin" }],
    spec: "docs/features/app-shell-and-navigation.md",
  },
  {
    feature: "Render queue and async renders",
    group: "Generations",
    what: "Every logged render (Render page, template generation, re-runs, batch rows) is queued and run by a render worker. The caller normally waits and gets the PDF back as before; if it takes longer than the wait limit (30 s by default) the API answers 202 with the generation id, and the entry finishes in the background. Live previews skip the queue and render straight away.",
    howTo:
      "Nothing to do in the app. API callers can send `async: true` on a render or template generate request to get 202 with `{ generationId, status }` at once, then poll GET /api/v1/generations/:id and download /api/v1/generations/:id/pdf once the status is success, or let a webhook tell them.",
    limitations: [
      "Queue pickup adds a few milliseconds; it's shown per entry as queue wait.",
      "If no worker is running, logged renders wait until one starts (Admin › System warns about this).",
      "The app's Render and template pages expect the PDF back; a render slower than the wait limit doesn't show there, but it still finishes and appears in Generations.",
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
      "Open Batches › Run batch, pick a template, upload a CSV, check which column fills which field (required fields without a column are flagged), and queue it. Open the batch to watch progress, list just the failed rows with their errors, cancel the remaining rows, or download. API: POST /api/v1/templates/:id/versions/:version/batch with `{ rows: [...] }` (JSON only; CSV upload is in the app), then GET /api/v1/batches/:id for progress and …/zip or …/packet to download.",
    limitations: [
      "Up to 10,000 rows and 20 MB of CSV or JSON per batch.",
      "Batches always use the latest published version in the app (the API takes any version).",
      "A CSV column fills one value; repeating-group items need one column per item (items.0.name, items.1.name).",
      "Cancel stops rows that haven't started; rows already rendering finish.",
      "Rows render in no particular order, so early rows can still be queued while later ones are done.",
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
    what: "Admin › System lists every process (role, version, renders running, event-loop lag, last heartbeat) and warns when no worker is online. It shows queue depth for interactive and batch renders, renders per minute, error rate, and p50/p95/p99 total time and queue wait, with a breakdown by source and template, over 15 minutes to 7 days. Configuration shows how the server is set up, without secrets: Chromium version, AI on or off and its model, sign-in (password, trusted header, SSO providers), the certifying certificate (subject, issuer, expiry, with a warning under 30 days) and its timestamp authority, output storage with a live reachability check, Prometheus metrics, OpenTelemetry traces, logging and retention.",
    howTo:
      "Open Admin › System and pick a window. It refreshes every 5 seconds. Configuration loads once per visit; Check again re-reads it, for example after fixing storage or replacing the certificate.",
    limitations: [
      "Metrics are computed from the generation log, so deleted entries drop out of them.",
      "No alerting here; for that, scrape the Prometheus metrics (see Logs, metrics and traces) into your monitoring.",
      "Offline processes stay listed for a day.",
      "Configuration is the environment of the API process that answered. Workers have their own; certification runs on workers, so a worker with different CERTIFY_* settings isn't shown. Changing a setting means changing the environment and restarting.",
    ],
    access: [{ action: "View", needs: "admin" }],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Log retention and CSV export",
    group: "Admin",
    what: "Retention deletes stored PDFs, and optionally inputs, of entries that finished more than N days ago, keeping the entries themselves. The generation list exports as CSV (metadata only, no inputs or PDFs) with the current filters.",
    howTo:
      "Set the days under Admin › System › Retention; it runs daily at 03:17 UTC, or press Run now (it asks first and uses the saved days, so save changes before running). Export from Generations › Export CSV.",
    limitations: [
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
    what: "A live view of the render queue: how many jobs are waiting, running and failed, how long the oldest has waited, which workers are online and how many of their slots are busy, then the jobs themselves with the file, batch, worker and timings for each. It refreshes every few seconds.",
    howTo:
      "Open Admin › Queue. Click a state above the list to filter by it, or pick a queue. Pause updates to read in peace. Cancel (it asks first) removes a waiting job, or drops the result of a running one. Retry on a failed render job runs it again in place: same job, same generation entry, one more attempt. Retry all failed does that for every failed render job in the chosen queue (it asks first). Re-run renders the same input again as a new entry. Pause queue (under Queues) stops every worker picking up that queue's jobs until you resume it; running jobs finish, new ones keep queuing.",
    limitations: [
      "It reads the queue library's job table directly, so it may need a fix after a library upgrade.",
      "Cancelling a running job doesn't stop the browser: the render finishes, but its result is thrown away and the generation shows as cancelled.",
      "The list has a fixed order (running first, then by priority and age) and can't be sorted.",
      "Completed jobs are only kept by the queue for 7 days.",
      "A paused queue stays paused, across restarts, until an admin resumes it. Workers notice within a few seconds.",
      "While the render queue is paused, renders from the app and the API come back as queued (202) right away and finish after you resume.",
      "Interactive and batch renders share one queue, so pausing it pauses both.",
      "Retry works on render jobs only, not on failed webhook or field detection jobs. A retried generation sends its webhook again when it finishes.",
    ],
    access: [
      { action: "View and cancel jobs", needs: "admin" },
      { action: "Pause, resume and retry", needs: "admin" },
    ],
    spec: "docs/features/render-queue-batch-jobs-and-scaling.md",
  },
  {
    feature: "Logs, metrics and traces",
    group: "Admin",
    what: "For your operations team's monitoring tools rather than the app. Every API and worker process writes one JSON log line per request (request id, user or API key, status, duration), per finished render (generation id, mode, pages, size, queue wait and the Liquid / Chromium / bands / stamping breakdown, or the error) and per failed queue job. With METRICS_PORT set, each process serves Prometheus metrics: request rates and durations by route, render durations by mode and status, queue depth and age per queue, worker slots in use, and Node process metrics. With an OpenTelemetry endpoint set, one render is one trace from the HTTP request through the queue into the worker, down to each Chromium pass and the storage write.",
    howTo:
      "Set it in the server environment, not in the app: LOG_LEVEL and LOG_FORMAT for logs, METRICS_PORT (e.g. 9464) for metrics, OTEL_EXPORTER_OTLP_ENDPOINT for traces. Examples: Datadog's agent collects the JSON logs from container output and scrapes /metrics with its OpenMetrics check (or the Helm chart's prometheus.io annotations), and takes traces over OTLP. Grafana reads logs with Alloy or Promtail into Loki, scrapes metrics into Prometheus or Mimir (the chart can create a PodMonitor) and sends traces to Tempo. Splunk collects logs with Splunk Connect for Kubernetes and metrics and traces with the Splunk OpenTelemetry Collector. Quote the X-Request-Id from an error response to find every log line for that request. The self-hosting docs list every metric and suggested alerts.",
    limitations: [
      "The metrics port has no password; it relies on not being reachable from outside your network.",
      "Queue numbers are for the whole cluster and every process reports the same ones, so dashboards should take the maximum, not the sum.",
      "Traces don't show individual database queries (apart from sign-in checks) or outgoing calls such as webhooks, AI and S3; their time shows inside the step that made them.",
      "All rows of a batch land in the trace of the request that started it.",
      "Request times end when the response starts, so long downloads aren't timed to the last byte.",
      "Field values aren't written to logs or traces (see Sensitive fields and masking for the audit log and admin views).",
    ],
    access: [{ action: "Configure (server environment)", needs: "admin" }],
    spec: "docs/features/observability.md",
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
    feature: "Installing and upgrading (Docker, Kubernetes)",
    group: "Admin",
    what: "necodoc runs on your own infrastructure. One host runs it with Docker Compose (Postgres, migrations, API, a worker and the app); Kubernetes runs it with the Helm chart, with API, workers and app as separate deployments behind one ingress. Liveness and readiness endpoints let load balancers route around a node that has lost its database, queue or storage.",
    howTo:
      "Compose: copy deploy/compose's .env.example to .env, set the secrets, run docker compose up, then sign up: the first account becomes the admin. Add workers with docker compose up --scale worker=2. Kubernetes: helm install deploy/helm/necodoc with a DATABASE_URL and a secret. Upgrades: build the new image tag, run migrations, roll the pods; Admin › System shows each worker's version so you can see when old ones are gone. The developer docs' Self-hosting section has the full environment reference, scaling, storage, backups and disaster recovery.",
    limitations: [
      "No published image registry yet; you build the images.",
      "The Helm chart doesn't include Postgres; bring your own.",
      "helm uninstall leaves the chart's Secret behind.",
      "The chart has been checked with helm lint and helm template, not yet on a live cluster.",
    ],
    access: [{ action: "Install and configure (server)", needs: "admin" }],
    spec: "docs/features/self-hosting.md",
  },
  {
    feature: "Signed download links",
    group: "Generations",
    what: "A link to one generated PDF that works without signing in until it expires, for emails, webhooks or handing a document to another system. Each link records who made it and how often it was used.",
    howTo:
      'Open the entry in Generations and press Download link: pick 1 hour, 24 hours or 7 days, Create link, then Copy link. From code, POST /api/generations/<id>/link with {"expiresInSeconds": 3600} (60 seconds to 7 days) returns {url, expiresAt}. With an API key, POST /api/v1/generations/<id>/link makes one valid for an hour. Add ?download=1 to the URL to save instead of open.',
    limitations: [
      "A link can't be revoked before it expires, except by deleting the generation.",
      "Changing DOWNLOAD_SIGNING_SECRET (or BETTER_AUTH_SECRET, if that's unset) voids every live link.",
    ],
    access: [{ action: "Make a link to an entry you can see", needs: view }],
    spec: "docs/features/generation-log.md",
  },
  {
    feature: "PDF overlay templates",
    group: "Templates",
    what: "Fill a PDF you already use (a government form, a carrier's bond) instead of rebuilding it. You upload the PDF, place boxes where the answers go, and bind each box to a template field with a Liquid expression. Generation writes the values onto the original pages, so the output looks exactly like the form. Fields, sample data, publishing, versions, batches and the generation log work as for designed templates.",
    howTo:
      "Templates › Upload PDF (or New template › Fill an existing PDF), pick the file (up to 20 MB, 200 pages). On the Boxes tab, choose a box type in 'Draw', drag on the page, then set its value in the inspector: pick 'Bind to a field' or type a new label and 'Create field'. Click a box (or Tab to it) to move it, or drag a corner or edge handle to resize it; the position shows in points while you drag. Arrow keys nudge it (Shift for 10 pt), Delete removes it, ⌘D duplicates it. The PDF tab has Flatten (no editable fields in the output) and 'Upload a new PDF' for a new revision of the form.",
    limitations: [
      "Text never flows from one box to the next. Auto-shrink stops at the minimum size; past it the text is cut and the generation records a warning.",
      "A signature box draws an image unless it names a signer; then it's left blank for the e-sign provider (see Signing packages).",
      "Uploaded fonts must be TTF or OTF; a WOFF2 font falls back to Noto Sans.",
      "Pure XFA forms (Adobe LiveCycle) and PDFs that need a password to open are refused on upload. Hybrid XFA forms are accepted; outputs drop the XFA part so every viewer shows the filled fields.",
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
      "On an overlay template's Boxes tab, click 'Detect with AI' and wait (5 to 10 seconds a page). Review the list: click one to see it on the page, tick to accept, × to reject. 'Accept all' (shown as 'Accept all but approximate' when some are approximate) takes every box that lined up with something printed; approximate ones are marked ≈ and left for you to accept one by one. Accepting reuses a field with the same key, or creates it.",
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
    feature: "AI template assistant",
    group: "Templates",
    what: 'A chat panel in the editor of a designed template. Describe the document or ask for a change ("add a co-principal and show the second signature block only when there is one") and Claude (Sonnet) proposes changes: name and description, fields and sections, body content, header and footer, page and theme, CSS, sample data, or the HTML of a code-mode template. Each proposal shows what it changes; nothing happens until you apply it, and nothing is saved until you save. It can also explain the template or a Liquid expression. Only shown when AI is turned on.',
    howTo:
      "Open a designed template and click Assistant (top right). Type a request and press Enter. On each proposal: Preview shows the PDF with the change, Apply puts it in the draft (undo in the editor takes body changes back), Reject tells the assistant no. Apply all takes every waiting proposal, and the ones that follow for the same request as they arrive (the assistant often proposes in steps), so one click applies the whole change. To start from nothing, choose New template › Describe it to the AI assistant.",
    limitations: [
      "Suggestions can be wrong; review each one and the preview before saving.",
      "The draft and the conversation are sent to Anthropic with every message; don't use it on templates that mustn't leave your systems.",
      "Not for PDF overlay templates (use AI field detection there).",
      "Conversations aren't kept: closing the editor or reloading the page starts over.",
      "It can't see snippet content or upload images; it uses existing fields and assets only.",
      "Each message sends the whole draft (about 20,000 tokens of instructions plus the template), so long templates cost more; there's no per-user quota yet.",
    ],
    access: [{ action: "Use the assistant", needs: edit }],
    spec: "docs/features/ai-template-assistant.md",
  },
  {
    feature: "AI summaries",
    group: "Templates",
    what: "'Suggest with AI' drafts text you'd otherwise write: a template's description (from its fields and content), and a version's change note (from what changed since the previous version, or what the template covers for version 1). The text lands in the box for you to edit; your own text is only replaced when you click. Only shown when AI is turned on.",
    howTo:
      "Description: Page & theme tab (PDF tab on overlay templates), Suggest with AI next to Description, then save. Change note: in the Publish dialog, Suggest with AI under the note. Older versions: Versions tab › Edit note (or Add note) › Suggest with AI › Save note.",
    limitations: [
      "The draft text can miss or misname a change; read it before publishing.",
      "Notes are based on the structural diff, which shortens long paragraphs, so wording changes inside a clause are summarised loosely.",
      "Template content is sent to Anthropic.",
    ],
    access: [
      { action: "Suggest a description", needs: edit },
      { action: "Suggest, write or edit a version note", needs: publish },
    ],
    spec: "docs/features/ai-template-assistant.md",
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
    what: "AI features (field detection, the template assistant and AI summaries) are on only when the API has an Anthropic key. Without one, every AI button is hidden and the AI endpoints answer 404, so no document content can reach a model.",
    howTo:
      "Set ANTHROPIC_KEY on every API and worker process and restart them; workers run the detection jobs. AI_MODEL picks the model (default claude-sonnet-5-5). Remove the key (or set it empty) and restart to turn AI off.",
    limitations: [
      "No per-user quota or usage report yet; each run costs money on the key's account.",
      "One provider (Anthropic) for now.",
    ],
    access: [{ action: "Configure", needs: "admin" }],
    spec: "docs/features/pdf-overlay-templates.md",
  },
  {
    feature: "Filling out a document",
    group: "Documents",
    what: "Anyone with a role can fill in a published template and get the finished PDF. The questions come one section at a time, with progress, help text and errors as you type; questions that don't apply stay hidden, and repeating questions (like a list of contracts) can be added as many times as needed. Each document stays on the template version it was started on, even after a newer one is published.",
    howTo:
      "On My documents (the home page), click New document, search for the template and click Start. Answer each step and click Next; Back goes to the previous one. My documents lists drafts and finished documents with the template, version and when they were last edited; open, continue, duplicate or delete each from its menu. Admins and template authors also see a Get started checklist there (design or upload a template, publish it, fill one in, get an API key, invite the team) until every step is done or they hide it.",
    limitations: [
      "Documents are private to whoever filled them; admins see the PDFs in the generation log, not the documents.",
      "Templates have no categories; the picker searches names and descriptions.",
      "A document started before its template was archived can still be finished.",
    ],
    access: [{ action: "Fill and keep your own documents", needs: view }],
    spec: "docs/features/filling-out-a-document.md",
  },
  {
    feature: "Drafts and autosave",
    group: "Documents",
    what: "A document saves as you type: the line under its name says Saving…, Saved, or that saving failed. Close the tab or reload and it reopens as a draft on the step you were on. The document name can be changed by clicking it.",
    howTo:
      "Nothing to do. To continue a draft, open it from My documents (filter by Drafts). If saving fails, the next change retries; keep the tab open until it says Saved.",
    limitations: [
      "Changes made in the last second before closing the tab are sent as the page closes; very large answers (big images or signatures) may not make it.",
      "Two tabs on the same document overwrite each other; the last save wins.",
    ],
    access: [{ action: "Autosave", needs: view }],
    spec: "docs/features/filling-out-a-document.md",
  },
  {
    feature: "Review and finish",
    group: "Documents",
    what: "After the last section, a review step lists every answer by section, leaving out questions that were hidden. Finishing checks everything again on the server, makes the PDF, and shows it with a download button. Every PDF is also recorded in the generation log.",
    howTo:
      "On the review step, click Edit next to a section to change it, then Next back to the review. Click Finish and make PDF. On the finished document, Download PDF saves it; Edit answers reopens it as a draft until you finish again; the ⋯ menu has Regenerate PDF (same answers), Duplicate, Reuse answers in another template and Delete.",
    limitations: [
      "Reopening and finishing again makes a new PDF; the previous one stays only in the generation log.",
      "Deleting a document keeps its PDFs in the generation log.",
    ],
    access: [{ action: "Finish, download and regenerate your documents", needs: view }],
    spec: "docs/features/filling-out-a-document.md",
  },
  {
    feature: "Reusing answers",
    group: "Documents",
    what: "A new document can start from a previous one's answers, so the same principal, address or amount isn't typed again. Answers carry over for questions with the same field name, also between different templates.",
    howTo:
      "In a document's menu on My documents, Duplicate starts a copy on the template's latest version; 'Reuse answers in another template' opens the picker with that document chosen. On New document, 'Start from a previous document' picks the source before you click Start.",
    limitations: [
      "Matching is by field name only: a field called client_name in one template and customer in another doesn't carry over.",
      "Answers that don't fit the new template's rules (e.g. an option it doesn't have) are copied but flagged until fixed.",
    ],
    access: [{ action: "Reuse your own documents", needs: view }],
    spec: "docs/features/filling-out-a-document.md",
  },
  {
    feature: "Share links",
    group: "Documents",
    what: "A public link to a published template, for people without an account: a customer's intake form, a supplier's details. They fill the same guided form under the necodoc mark and submit; their answers arrive as your document with its PDF, marked 'Share link'. Options: a label, a pinned version or the latest, an expiry date, a maximum number of submissions (1 for a single-use request), asking for the filler's email, letting them download their PDF, and prefilled answers you can lock.",
    howTo:
      "Open Share links › New share link, pick the template, set the options and Create link, then Copy link and send it. Adding ?field_name=value to the link prefills unlocked fields. Open a link to see its responses (new ones are marked), views, conversion and settings; the nav and the list count new ones. Disable stops the link at once, Enable turns it back on; Delete removes the link but keeps its responses in My documents.",
    limitations: [
      "No email: necodoc doesn't send the link or tell you about responses; watch the count in the app.",
      "Anyone with the link can submit; there's no identity check or CAPTCHA, only a per-address rate limit (10 at once, then one a minute).",
      "The rate limit is kept per API server and resets on restart. Behind a reverse proxy, TRUST_PROXY=true must be set or every filler shares one limit.",
      "Progress is kept in the filler's browser only; they can't continue on another device.",
      "The filler's download link lasts 24 hours. If the PDF takes too long, they get the confirmation without a download.",
      "Prefill and locking cover top-level questions, not questions inside a repeating group.",
      "No CSV export of responses. Webhooks have no submission event of their own; a submission's PDF fires the template's generation.succeeded webhook (source share_link).",
    ],
    // Filling needs no account at all, which the access list can't express; `what` says so.
    access: [{ action: "Create and manage share links, see their responses", needs: publish }],
    spec: "docs/features/share-links-and-data-requests.md",
  },
  {
    feature: "Public API (/api/v1)",
    group: "API",
    what: "Other systems call necodoc over HTTP with an API key: render HTML to PDF, list published templates and read their JSON Schema, generate from a template, start batches and download their ZIP or packet, read generations and download PDFs, and combine PDFs into one packet. Every call that renders is in the generation log with source API (or Combine) and the key's name.",
    howTo:
      'Create a key (Developers › API keys, or on a service account), then send it in the x-api-key header to /api/v1/… Render and generate return the PDF by default; send response: "json" for the generation id and a signed download link, or async: true to get 202 at once and poll the generation. Every response has an X-Request-Id for support.',
    limitations: [
      "A render still running when the wait runs out answers 202 with the generation id; poll it or use a webhook.",
      "Keys see only their own account's generations and batches.",
      "Combine takes generation ids and uploaded PDFs, not template data; uploaded inputs stay stored after the packet is made.",
      "No JavaScript in submitted HTML, and no URL-to-PDF.",
      "SDKs exist for TypeScript, Python, .NET and Java but aren't on package registries yet; other languages use plain HTTP.",
    ],
    access: [{ action: "Call the API with your own key", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "API keys and scopes",
    group: "API",
    what: "A key acts as its owner (you, or a service account) but only for the scopes it was given: render:html, templates:read, templates:generate, batches:write, batches:read, generations:read, combine:write. It can also be limited to some templates. It never signs in to the app. A key can't be given scopes its owner's roles don't allow, and it loses them as soon as the owner loses the role; a banned owner's keys stop at once.",
    howTo:
      "Developers › API keys › Create key: name it after what uses it, tick only the scopes it needs, pick an expiry (30, 90, 365 days or never) and optionally templates, an IP allowlist and a rate limit. Copy the key from the dialog: it's shown once. The list shows each key's first characters, expiry (with a warning 14 days before), last use and IP, and request count. Admin › API keys lists every key, filters by owner and status, revokes any, and links to the generation log for each key.",
    limitations: [
      "Scopes, templates, allowlist and rate limit can't be edited; rotate the key (same settings) or make a new one.",
      "A lost key can't be shown again.",
    ],
    access: [
      { action: "Create, rotate and revoke your own keys", needs: view },
      { action: "See and revoke everyone's keys", needs: "admin" },
    ],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "Service accounts",
    group: "Admin",
    what: "A service account is an identity for a system (billing, a CRM, a nightly job), not a person. It has a name, description, an owner or contact, and roles, and it owns API keys, so an integration keeps working when the person who set it up leaves. It can't sign in, be impersonated or have a password, and it doesn't appear in Admin › Users.",
    howTo:
      "Admin › Service accounts › Create service account: name it after the system, enter who to ask about it, pick its roles (not admin). On its page, create keys and webhooks for it. Disable stops every one of its keys at once (401); Enable restores them. Edit changes its name, contact, description and roles; removing a role takes the matching scopes away from its keys.",
    limitations: [
      "Service accounts can't be deleted yet; disable them instead.",
      "Their generations show the service account as the user, so the generation log's user filter finds them.",
    ],
    access: [{ action: "Create, edit, disable and manage their keys", needs: "admin" }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "Rotating an API key",
    group: "API",
    what: "Rotation replaces a key without downtime: a new key with the same scopes, templates, allowlist and rate limit, while the old one keeps working for an overlap window and then expires. Revoking stops a key immediately. Expired and revoked keys stay listed, and the generation log keeps their names.",
    howTo:
      "In the key's menu choose Rotate…, pick the overlap (none, 1 hour, 24 hours, 7 days or 30 days), copy the new key, deploy it, and let the old one run out. To stop a leaked key now, choose Revoke…. A key that had an expiry gets the same lifetime again.",
    limitations: [
      "People rotate their own keys; admins rotate service accounts' keys (and can revoke anyone's).",
      "Nobody is notified before a key expires; the warning only shows in the key lists.",
    ],
    access: [{ action: "Rotate and revoke your own keys", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "IP allowlists",
    group: "API",
    what: "A key can be limited to the addresses its system calls from. Calls from anywhere else get 403 (ip_not_allowed), even with the right key.",
    howTo:
      "When creating a key, list one address or CIDR range per line under IP allowlist, like 203.0.113.7 or 10.0.0.0/8 (IPv6 works too). Leave it empty to allow any address. Behind a reverse proxy, set TRUST_PROXY=true on the API so it reads the client address from X-Forwarded-For.",
    limitations: [
      "Without TRUST_PROXY behind a proxy, every call seems to come from the proxy.",
      "The list is set when the key is made; rotate or make a new key to change it.",
    ],
    access: [{ action: "Restrict your own keys", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "API rate limits",
    group: "API",
    what: "Each key has its own limit, in requests per minute (120 unless set otherwise, up to 6,000). Past it, calls get 429 with a Retry-After header in seconds.",
    howTo:
      "Set the limit when creating the key. If a system keeps hitting 429, rotate to a new key with a higher limit, or spread its calls out; batches are one call for thousands of documents.",
    limitations: [
      "The window starts again a minute after the last allowed call, so a key that keeps calling at the limit waits a full minute.",
      "Every call counts, including ones refused for a missing scope.",
      "No per-account quotas yet.",
    ],
    access: [{ action: "Set your own keys' limits", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "API reference and OpenAPI",
    group: "API",
    what: "The API page in the app lists every /api/v1 endpoint with its request and response schemas, generated from the code so it can't drift, and can send test calls with a key. The same OpenAPI 3.1 document is at /api/v1/openapi.json for code generators, and the developer docs site renders it too. The SDKs are generated from it.",
    howTo:
      "Open Developers › API reference. Paste a key under Authentication to try calls from the browser; they're real calls and are logged. Point Postman, Insomnia or an OpenAPI generator at /api/v1/openapi.json.",
    limitations: ["Try-it calls run against this deployment and its real data."],
    access: [{ action: "Read the reference", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "SDKs",
    group: "API",
    what: "Typed client libraries for /api/v1 in TypeScript, Python, .NET and Java, generated from the same OpenAPI document as the API page, so they match the API they were built with. Each comes with a small example that renders HTML, generates from a template and fetches a signing package.",
    howTo:
      "Developers install them from the necodoc repository (packages/sdk-ts, sdk-python, sdk-dotnet, sdk-java) and give them the deployment's URL and an API key. The developer docs have a page per language.",
    limitations: [
      "Not on npm, PyPI, NuGet or Maven Central yet; they're built or copied from the repository.",
      "In Python, .NET and Java, a render or generate that answers JSON (response: json, or a signing package) comes back as raw bytes for the developer to parse with the SDK's model.",
      "An SDK from a newer necodoc may know fields an older deployment doesn't; generate from this deployment's /api/v1/openapi.json for an exact match.",
    ],
    access: [{ action: "Use an SDK with your own key", needs: view }],
    spec: "docs/features/html-to-pdf-api.md",
  },
  {
    feature: "Webhooks",
    group: "API",
    what: "necodoc can POST to your system when a generation succeeds or fails, or a batch completes, so it doesn't have to poll. A webhook belongs to an account and fires for every API call it makes, for one of its keys, or for one template (any source). Each request is signed (Necodoc-Signature: an HMAC-SHA256 of the timestamp and body with the webhook's secret) and carries a 24-hour signed download link, never the PDF itself.",
    howTo:
      "Developers › API keys › Add webhook (or on a service account's page): enter an HTTPS URL, tick events, optionally pick a key or template, and copy the signing secret (shown once). Send test fires a webhook.test event. Deliveries shows every attempt with its HTTP status and time; failures retry 5 times with backoff over several minutes. The developer docs show how to check the signature.",
    limitations: [
      "HTTPS only, and never to private, loopback or link-local addresses (checked again before every send). WEBHOOK_ALLOW_LOCALHOST lifts that for local development only.",
      "No manual redelivery; order isn't guaranteed and an event can arrive twice, so deduplicate on Necodoc-Delivery.",
      "The secret can't be shown again or changed; delete and re-add the webhook.",
      "App renders (not through a key) only fire template webhooks. Share-link submissions don't fire webhooks yet.",
    ],
    access: [
      { action: "Webhooks for your own keys and account", needs: view },
      { action: "A template webhook (any source)", needs: edit },
    ],
    spec: "docs/features/webhooks.md",
  },
  {
    feature: "Audit log",
    group: "Admin",
    what: "A permanent record of every change to configuration and access: templates (edits, publishing, reviews, test cases), themes, assets, snippets, share links, webhooks, API keys, service accounts, users and roles, retention and publishing settings, batches, bulk deletes of the generation log and signed download links. Sign-ins (failed ones too, with the email tried and why), sign-outs and changes people make to their own account in Settings are recorded as well. Each entry has who did it (and the admin behind them when impersonating, or the API key), when, from which IP and browser, the request id, and the fields that changed with their old and new values.",
    howTo:
      "Admin › Audit log: filter by action, target type, actor, date range or free text (a name, request id, IP or id), sort, and click a row for its changes. Export CSV downloads everything matching the filters. Theme, snippet, share link, service account and template pages show their own History; API keys have a History item in their menu.",
    limitations: [
      "Append-only: nobody can edit or delete entries through the app or the API, and the database refuses updates and deletes. Someone with direct database owner access can still turn that off, so it's tamper-resistant, not tamper-proof.",
      "Entries are kept forever; there is no retention setting for the audit log.",
      "A changed field is stored whole, so editing a long template or theme stores the full content before and after.",
      "Values of fields marked sensitive (or automatically sensitive, like signatures and SIN or tax id fields) are masked in sample data, share-link prefills and test cases. Names, emails and IP addresses of people using necodoc are stored as they are, and nothing is ever erased from the log.",
      "Downloads and uses of signed links aren't recorded, only creating a link.",
      "Sign-ins and Admin › Users actions are recorded just after they happen, not in the same database transaction.",
    ],
    access: [{ action: "Read and export the audit log", needs: "admin" }],
    spec: "docs/features/audit-log.md",
  },
  {
    feature: "Analytics dashboards",
    group: "Admin",
    what: "Charts and tables over what necodoc already records. Documents: generations over time by status and source, error rate, pages and output size, queue wait and run time (p50 and p95), top templates, users, API keys and errors, the largest batches, and share-link views, responses and conversion. Auth & access: sign-ins by method (password, OIDC, SAML, trusted header) and provider, failed sign-ins by reason, email and IP, active users (DAU, WAU, MAU), new users, roles, and API key and service account use.",
    howTo:
      "Admin › Analytics. Pick a date range (and, on Documents, a source, template, user or API key); every chart follows it and the URL keeps it, so a view can be shared. Hover a chart for values, use Table for the numbers and CSV to download them. Click a column or a row to open the matching entries in the generation log or the audit log.",
    limitations: [
      "Counted when the page loads from the logs themselves, so it's only as old as the generation log (retention can remove inputs, not rows) and the audit log.",
      "API key request counts are lifetime totals; per-day key use counts generations made with the key, not every call.",
      "Active users are people who signed in, changed something or generated a document that day; someone who only read pages on a still-open session isn't counted.",
      "Share-link views are page loads, not unique visitors, and started counting when this shipped. Conversion is finished responses over views, lifetime.",
      "SSO sign-ins are split into OIDC and SAML by the provider's current configuration; a removed provider shows as SSO.",
      "Roles are today's, not historical. Errors group by their exact first line.",
    ],
    access: [{ action: "See and export the dashboards", needs: "admin" }],
    spec: "docs/features/analytics-dashboards.md",
  },
  {
    feature: "My usage",
    group: "Settings",
    what: "Your own numbers: generations over time by status, errors, pages and output size, the templates you generated most, your documents (drafts and finished, including share-link responses), and, if you can create or edit templates, how often the templates you created were generated by anyone.",
    howTo:
      "Your account menu (initials, top right) › My usage. Pick a date range; click a column or a template to open those entries in My generations, or download any table as CSV.",
    limitations: [
      "Only generations made as you count; calls through your API keys count, renders by others of your templates only show under templates you created.",
      "Documents show those started in the range next to the all-time count.",
      "Templates you created that nobody generated in the range are left out of the table; the CSV still lists them.",
    ],
    access: [{ action: "See your own usage", needs: view }],
    spec: "docs/features/analytics-dashboards.md",
  },
  {
    feature: "Archival and accessible PDFs (PDF/A, PDF/UA)",
    group: "Templates",
    what: "A template can make PDF/A-2b or PDF/A-2u files, the archive formats records offices and courts ask for, and (designed templates) tagged PDF/UA files that screen readers can follow: headings, paragraphs, tables, lists, links and images in reading order, with headers and footers marked as page furniture. The API can ask for either on any render.",
    howTo:
      "Open the template's Output tab: pick a PDF/A level and, for designed templates, switch on Accessible and set the document language. Publish to apply it. API calls send an `output` object to override it per request; options left out keep the template's. The generation page shows what was applied under Output.",
    limitations: [
      "Overlay templates only get PDF/A when the uploaded PDF embeds its fonts and has no scripts or attachments; most government forms don't embed theirs. The PDF is still made, without the PDF/A claim, and the generation says why.",
      "PDF/UA is for designed templates and HTML renders only; overlays and packets aren't tagged.",
      "Accessibility depends on the content: images need alt text and tables need header rows. necodoc doesn't check that for you; run a checker such as veraPDF or PAC on a sample.",
      "Decorative images (empty alt text) and empty table cells fail the check because Chromium leaves them untagged: describe every image and put a non-breaking space in empty cells.",
      "An image that doesn't load (remote URLs never do) fails the check the same way.",
      "Packets (combined PDFs) can be PDF/A only if every part qualifies.",
    ],
    access: [
      { action: "Change a template's output settings", needs: edit },
      { action: "Ask for them per request through the API", needs: create },
    ],
    spec: "docs/features/archival-accessible-and-certified-output.md",
  },
  {
    feature: "Certified PDFs",
    group: "Templates",
    what: "Generated PDFs can carry an invisible certification signature from your organisation's certificate (PAdES, with a trusted timestamp when a timestamp server is configured). Acrobat shows who certified the document and that it hasn't changed since. Filling in form fields and signing it later, in DocuSign or another e-sign service, keep the certification valid.",
    howTo:
      "An administrator installs the certificate on every worker (CERTIFY_P12_PATH and CERTIFY_PASSWORD, or PEM files; CERTIFY_TSA_URL for timestamps) and restarts. Then switch on Certify in the template's Output tab, or send `output.certify` through the API. The generation page shows who certified it.",
    limitations: [
      "Without a certificate on the server, certified generations fail with an error rather than coming out uncertified.",
      "Previews aren't certified.",
      "Acrobat shows the signature as trusted only if the certificate chains to a root it trusts (for example an AATL certificate); a self-signed one shows as unknown.",
      "Signatures are long-term only as long as the certificate: no revocation data is embedded (PAdES B-B or B-T, not B-LT).",
      "Any change other than filling fields or signing, such as editing or merging the PDF elsewhere, breaks the certification, and so does putting a certified PDF in a packet.",
    ],
    access: [
      { action: "Turn certification on for a template", needs: edit },
      { action: "Install the certificate", needs: "admin" },
    ],
    spec: "docs/features/archival-accessible-and-certified-output.md",
  },
  {
    feature: "Sensitive fields and masking",
    group: "Templates",
    what: "A template field can be marked sensitive. Its values are then masked as [masked] in the audit log and when an admin opens someone else's generation. Signatures and fields whose key looks like a SIN/SSN, tax id, passport, birth date, bank account, IBAN or card number are sensitive automatically. The PDF, the stored input (used for re-runs), your own documents and downloads keep the real value. Server logs and traces never contain field values at all.",
    howTo:
      "Template › Fields: open a field and set Sensitive to Automatic, Yes or No. Automatic shows what it resolves to. Fields that are sensitive show a Sensitive badge.",
    limitations: [
      "Only flagged or automatically matched fields are masked. A plain name or email field shows to admins unless you mark it.",
      "Audit entries written before a field was marked keep the values they recorded.",
      "HTML API renders have no field definitions, so only the key names decide what's masked.",
    ],
    access: [
      { action: "Mark fields sensitive", needs: edit },
      { action: "See other people's inputs (masked)", needs: "admin" },
    ],
    spec: "docs/features/personal-data-masking-and-erasure.md",
  },
  {
    feature: "Data subjects (GDPR erasure)",
    group: "Admin",
    what: "Finds everything necodoc stores about one person and deletes it on request: generations (their input and PDF, including the file in storage), packets built from them, webhook delivery logs, signed-link records, documents and share-link responses. Generations can carry a subject key (an email or customer number) given when they're generated; share-link responses use the respondent's email. You get an erasure report, and the audit log records the erasure with counts only.",
    howTo:
      "Admin › Data subjects: search an email, name or identifier, untick anything that isn't this person (packets built from a match are listed separately), then Erase selected and type erase to confirm. Download the report as JSON for your records. API callers should send `subject` on render and generate calls so their documents can be found.",
    limitations: [
      "Matches are exact whole values, ignoring case: misspellings and values inside longer text (such as an HTML API body) aren't found.",
      "The audit log and shipped server logs can't be erased; masking sensitive fields is what keeps personal data out of them.",
      "Share-link prefills, template sample data and test cases aren't searched or erased.",
      "Erasing is permanent, and analytics counts and batch progress drop accordingly.",
      "People with a necodoc account are removed through Admin › Users.",
      "Up to 500 matches of each kind per search; erase them and search again for more.",
    ],
    access: [{ action: "Search and erase data subjects", needs: "admin" }],
    spec: "docs/features/personal-data-masking-and-erasure.md",
  },
  {
    feature: "Document languages and translations",
    group: "Templates",
    what: "One template makes documents in several languages. The template is written in its document language (Output tab); dates, numbers and money format for it, Arabic, Hebrew and other right-to-left languages lay out right to left, and the PDF records its language. The Translations tab adds other languages: every field label, help text, choice, section title and piece of visual text is listed with a box for its translation, and anything left blank prints as written. The fill page and share links offer a language picker when a template has translations, and the PDF is made in the picked language. API calls pick one with output.lang.",
    howTo:
      "Template › Output: set the document language (en, fr-CA, ar…). Template › Translations: type a language tag, Add language, then fill in the translations; the preview's language menu shows the result. In code mode or overlay boxes, wrap text as {{ \"Thank you\" | t }}. Publish to make it available. Share links take ?lang=fr to start in a language; otherwise they follow the browser's language.",
    limitations: [
      "Visual text is translated run by run: a bold word or merge field in the middle of a sentence splits it into separate strings.",
      "Editing a sentence orphans its translation: the new text prints untranslated until it's translated again (Remove unused clears the old one).",
      "Overlay templates (uploaded PDFs) can't draw right-to-left or joined scripts such as Arabic correctly; formatting and translations work there.",
      "Chinese, Japanese and Korean use the server's fonts; upload a font to a theme for a particular look.",
      "Form validation messages and the app itself stay in English.",
      "Translations don't handle plurals or placeholders inside a sentence.",
    ],
    access: [
      { action: "Set the language and translations", needs: edit },
      { action: "Fill in another language", needs: view },
    ],
    spec: "docs/features/document-localization.md",
  },
];
