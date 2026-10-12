# Copy pass (W6b, NECO-ijpejxan)

A pass over every page, the reel captions and the review pack, so the copy reads like a person
wrote it. Guide: ASD-STE100 loosely (one idea per sentence, active voice, common verbs, one word
per meaning), stricter on Architecture and Security. Claims stay inside the
[Marketing site](../../docs/features/marketing-site.md) defendable list. Notable changes only.

## Patterns removed

- Slogan headlines and punchlines: "Month-end is a replica count.", "No badges we haven't
  earned.", "Run it, and answer for it.", "These gaps are real. If one of them decides it for
  you, it should."
- "X, not Y" and "because there isn't one" closers, where the contrast added nothing.
- Semicolon chains and fragments in body copy, split into sentences with a subject and a verb.
- Passive voice with a hidden actor ("is logged", "is audited", "are created") turned active.
- Signposting ("This page is the reference for…", "answered here", "walks through").
- Disclaimers readers already understand ("example, not a connector", "We don't claim unlimited
  workers" beside a limit that already says so).
- Jargon and idiom: "minting" a link, "plugs into", "rewrite history", "where its time went".
- One term per meaning: "audit log" (not "audit trail"), "worker process", "signing".

## Home

| Before | After |
|---|---|
| What it does differently. | Existing forms, month-end volume and insurance documents. |
| Month-end is a few more workers. | Add workers for month-end. Remove them after. |
| Renders run as queued jobs on worker processes. Month-end is a replica count, and every render records where its time went. | Each render is a job in a queue, and worker processes take jobs from it. For month-end, raise the worker replica count. Each render records how long each step took. |
| One drawing your review board can check line by line. | What runs, and where the data lives. |
| No third party holds your data, because there isn't one. | necodoc isn't a hosted service, so no vendor holds your data. |
| With AI off, which is the default, nothing leaves. | AI is off by default. With AI off, nothing leaves except the webhooks you configure. |
| What it doesn't do, so you don't find out in month three. | What necodoc doesn't do. |
| MIT-licensed. Fork it, audit it, add a storage driver. | MIT licence. Read the code your review needs, or fork it and add a storage driver. |
| Hero rotor: "government forms", "teams stuck with old PDF forms" | "government agencies", "teams still filling PDFs by hand" |

## Insurance

| Before | After |
|---|---|
| Two templates means two copies that drift. necodoc keeps one. | With two templates, the French and English copies drift apart. necodoc uses one template with a translation per language. |
| Progress, cancel, invalid rows fail alone; download one ZIP or one combined packet. | Watch progress or cancel the run. An invalid row fails alone. Download one ZIP or one combined packet. |

## Architecture

| Before | After |
|---|---|
| …in a Postgres and a bucket you already operate. This page is the reference for your architecture review. | All durable state is in a Postgres database and a bucket that you operate. |
| Everything necodoc runs can be killed and replaced. | You can stop and replace any necodoc process. |
| No packaged connector. A versioned REST API described by OpenAPI 3.1, a JSON Schema per template version, and generated SDKs… | There is no packaged connector. Your systems call a versioned REST API, described by OpenAPI 3.1. Each template version has a JSON Schema. … |
| Everything stays in your account except what you send out on purpose. AI is the only third party… | Data stays in your account unless you configure it to go out. The only third party is Anthropic, for the AI features… |
| Stated here so your review doesn't have to find them. | What it doesn't do yet. |

## Security and governance

| Before | After |
|---|---|
| The table your security reviewer copies into the questionnaire. | Every control, and the spec that defines it. |
| Together they answer the auditor's question without a spreadsheet. | (cut) |
| Streamed through signed, expiring links. Minting a link is audited. | Files download through signed links that expire. The audit log records each link that is issued. |
| Roles add up; each grants one job. | A user can hold several roles, and each role grants one kind of work. |
| No badges we haven't earned. | Attestations and claims we don't make. |

## Performance, Product, Compare, Open source

| Before | After |
|---|---|
| The benchmark tells you what to expect. The generation log tells you what happened: … | In production, the generation log records the queue wait, run time and a per-step breakdown for every PDF. |
| Our documents, not yours. / Cold start is a process, not a machine. | The test documents are ours. / Cold start means a new process. |
| A rich-text editor for the forms team, code mode for developers, one renderer behind both. | The forms team uses a rich-text editor, and developers can switch to code mode. The live preview uses the production renderer… |
| Files that hold up in an archive, a screen reader and Québec. | Archival, accessible and bilingual PDFs. |
| The business owns the wording. Nothing goes live unreviewed. | The business owns the wording. Your systems own the fields. ("Nothing goes live unreviewed" is only true with the review gate on.) |
| Most changes are configuration. The rest is the source. | Extend it with settings, or with code. |

## Reel captions ([timeline.ts](../../apps/reel/src/timeline.ts))

| Before | After |
|---|---|
| Or call it from your policy system: HTML and data in, PDF out. | Your policy system can also post HTML and data to the API and get the PDF back. |
| Every change and sign-in lands in an audit log that can't be edited. | Every change and sign-in goes into an append-only audit log. ("Can't be edited" overstated tamper resistance.) |
| Add workers to go faster: … | More workers, more throughput: … |

## Review pack ([pack.md](../../scripts/review-pack/pack.md))

Already close to the guide. Fragments split ("Health and readiness endpoints on every process;
readiness fails without…"), passives made active, the "so your review doesn't have to find
them" closer cut.

## Left as is, on purpose

- "Tamper-resistant, not tamper-evident", "E-signature ready", "We describe controls, not
  attestations": the contrast is the legal point.
- The six home Q&A titles are questions because they quote the reviewer.
- "Example:" labels on worked examples: the spec requires them.
- The demo line ("A shared public demo. It resets every night at midnight Eastern.") is fixed by
  the spec.
- Headlines that already name concrete things ("Bonds on the obligee's own form.").

# W7 review (NECO-cpnsebim)

A launch review of claims, competitor rows, links and accessibility, with fresh eyes. Copy that
already met the W6b rules stayed as it was.

## Claim fixes

| Page | Before | After | Backed by |
|---|---|---|---|
| Home Q&A, Security controls, review pack | "scoped, expiring, IP-restricted keys" / "an expiry date" | "scoped keys, with optional expiry and IP allowlists" / "an optional … expiry date" | [HTML to PDF API](../../docs/features/html-to-pdf-api.md): expiry and allowlist are optional |
| Home pillar 03, Security (Bill 96), review pack | "from one template, so the two copies can't drift" | "with one set of fields and one layout"; Security and Insurance add "An untranslated string prints in the source language." | [Document localization](../../docs/features/document-localization.md): untranslated strings fall back to the source text |
| Insurance (forms team, claims letters), Home card | "A reviewer approves each change" / "the wording an adjuster sends is the wording legal approved" | "With the review gate on, a reviewer approves…" / "Claims letters from one reviewed template." / "so one reviewed template covers each case" | [Review and approval](../../docs/features/review-and-approval.md): the gate is an admin setting |
| Architecture hero and components, review pack | "necodoc is one container image" / API "Serves /api/v1 and the web app" | "The API and the render workers run from one container image… A static image serves the web app." / "the web app's API; renders live previews" | [Self-hosting](../../docs/features/self-hosting.md) (app is its own Deployment), [roles and scaling](../../apps/devdocs/src/content/docs/self-hosting/roles-and-scaling.md) (previews on API nodes) |
| Performance, throughput | "Above its core count, more workers don't add throughput." | "…from two workers up they compete for its CPU and the curve levels off. More cores or more machines add throughput." | [Performance benchmark](../../docs/features/performance-benchmark.md) findings; the run never went above the core count |
| Performance, caveats | "Each worker slot waits up to 0.5 s between jobs…" | "Each run is timed from the batch's creation to its last row, so it includes the time a job waits for a worker slot." | The 0.5 s wait was fixed (benchmark spec, "The fetch loop capped batches (fixed)") |
| Performance, rerun | "about fifteen minutes on a laptop" | "under fifteen minutes on a laptop" | Benchmark spec acceptance; the published run took about five minutes |
| Performance, in production | "p50, p95 and p99 for any time window" | "over a window you select" | [Render queue](../../docs/features/render-queue-batch-jobs-and-scaling.md): selectable windows |
| Reel caption ([timeline.ts](../../apps/reel/src/timeline.ts)), re-rendered | "AI proposes a box for every blank" | "AI proposes a box for each blank it finds" | [PDF overlay templates](../../docs/features/pdf-overlay-templates.md): recall 0.97, suggestions only |
| Home reel chapter fallback | "Read the audit trail" | "Read the audit log" | W6b one-term rule |

## Compare page

Rechecked on the vendors' sites on 2026-10-12. Each row now has a vendor page in the sources
list. The OpenText PDF was removed because it names core systems (and refuses browsers);
`ghostdraft-benefits` and Smart Communications `/trust/` redirect, so the targets are linked.

| Row | Before | After | Source |
|---|---|---|---|
| Anvil, integration | REST API | REST and GraphQL APIs | useanvil.com/docs/api/getting-started |
| Anvil, bulk | Async and batch APIs | One PDF per API call | No batch endpoint in Anvil's docs; its bulk guide loops one call per PDF |
| DocSpring, licensing | Per document | Monthly plan with a PDF allowance, then a fee per PDF | docspring.com/pricing |
| Anvil, licensing | Per document | Monthly plan or pay as you go, per PDF and per e-signature packet | useanvil.com/pricing |
| GhostDraft, e-signature | Integrations | E-signature support | why-ghostdraft lists "E-Signature Support", no providers |
| DocSpring / Anvil, e-signature | Own e-signature | Own e-signature (Data Requests) / (Etch) | docspring.com/faq, useanvil.com/products/etch |
| GhostDraft, channels | Documents and communications | Print, email, portals and other channels | why-ghostdraft ("10+ digital channels") |
| GhostDraft, fill existing PDFs | Not a stated focus | Not stated on its site | Absence only, so say only that |
| Stronger: attestations | "publish SOC 2 Type II reports" | "state that they have SOC 2 Type II reports" | SOC 2 reports aren't public |
| Stronger: support, SaaS | "Each of them sells support." / "The others run the service for you." | "offers support as a vendor" / "offer a managed service" | DocSpring offers on-premises on request |
| Stronger: channels; Which fits | CCM suites only | GhostDraft and the CCM suites | as above |

The [Marketing site](../../docs/features/marketing-site.md) competitor table carries the same rows.

## Links, meta and accessibility

- Docs links default to `https://docs.necodoc.com` ([links.ts](../../apps/web/src/lib/links.ts)), so
  a build without `DOCS_URL` no longer ships `localhost` links.
- Every page has a canonical URL, Open Graph and Twitter card tags, and `og.png` (1200×630, rendered
  from the hero copy and the overlay screenshot) ([Layout.astro](../../apps/web/src/layouts/Layout.astro)).
- Headings: footer column titles were `h4` under `h2` (now `h2`); the Insurance certificate
  examples were `h4` (now `h3`); Product jumped from `h1` to `h3` (a visually hidden `h2`).
- Compare at 390 px: the GhostDraft cell was indented. Throughput tooltip said "1 workers".
- Checked: the hero rotor stays on the first audience under reduced motion; the reel poster has
  empty alt (it's decorative, and the chapter list is the text alternative); every other image has
  alt text; GoatCounter is on every page; no page overflows at 390 px.

# Marketing pass

A pass over every page to make the copy sell, not only inform: headlines that say what the
buyer gets, shorter ledes, and nothing a visitor already knows. Mike's target density was the
home lede: "Fill the PDF forms you already have, or design new documents from your data.
necodoc runs in your own cloud." Explanations of basics went (what a queue does, why stateless
scales, what PDF/UA is for, what a webhook saves you). Numbers, claims and limits are unchanged,
and the W6b "left as is" list still holds.

## Headlines

| Page | Before | After |
|---|---|---|
| Home, pillars | Existing forms, month-end volume and insurance documents. | Built for the documents a carrier already issues. |
| Home, architecture | What runs, and where the data lives. | It all runs inside your boundary. |
| Home, Q&A | Six questions from an architecture review. | The six questions your review board will ask. |
| Home, limits | What necodoc doesn't do. | Know the limits before you start. |
| Home, evaluate | Everything you need to evaluate it is public. | Evaluate it on your own schedule. Everything is public. |
| Product hero | Everything necodoc does, and where each part stops. | Everything necodoc does, with the limits up front. |
| Insurance hero | The documents a carrier issues every day, on its own forms and in both languages. | Bonds, certificates and renewals, on your own forms and in both languages. |
| Insurance, renewals | The month-end renewal run, behind the day's work. | The month-end renewal run, without holding up the day's work. |
| Architecture, components | What runs, and what holds state. | Stateless processes. Your Postgres and bucket hold the rest. |
| Architecture, scaling | Throughput by worker count. | Add workers, add throughput. |
| Architecture, CTA | The architecture review pack: one PDF, made with necodoc. | Give your review board one PDF, made with necodoc. |
| Compare, which fits | A short guide, by what you need most. | Pick by what you need most. |

## Body copy

| Page | Before | After |
|---|---|---|
| Home lede | necodoc fills the PDF forms you already have and renders designed documents from your data. It runs in your own cloud. Your systems call it through one versioned API, and you set the number of render workers. necodoc logs every template change and every PDF. | Fill the PDF forms you already have, or design new documents from your data. necodoc runs in your own cloud. |
| Home, pillar 02 | Each render is a job in a queue, and worker processes take jobs from it. For month-end, raise the worker replica count. Each render records how long each step took. | Scale render workers up for month-end and back down after, with no licence per worker. Every render records its step timings. |
| Home Q&A, month-end | The API and the workers are stateless, so you add replicas. Interactive renders go ahead of batch rows. If a worker stops, another worker retries its job. | Add replicas. Interactive renders go ahead of batch rows, and a stopped worker's job retries on another. |
| Home Q&A, exit plan | MIT source you can fork, standard Postgres, and PDFs in your own storage. necodoc isn't a hosted service, so no vendor holds your data. | You already have one: MIT source you can fork, standard Postgres, and PDFs in your own storage. No vendor holds your data. |
| Home, $0 stat | There is no licence fee. You pay for the machines the workers run on. | You pay for the machines. Nothing else. |
| Product, fields | Each template declares typed fields with validation, help text, sections and show-if conditions. The same definition becomes the guided form a person fills, the validation the API applies, and a JSON Schema per published version. | Define typed fields once. They become the guided form, the API's validation and a JSON Schema per published version. |
| Product, archival | Set per template or per request: PDF/A-2b or 2u for retention, tagged PDF/UA-1 for screen readers, and certification with your certificate (PAdES B-B or B-T). … | PDF/A-2b or 2u, tagged PDF/UA-1, and PAdES B-B or B-T certification with your certificate. … |
| Product, CTA | There is no paid tier. | No paid tier, and nothing held back for an enterprise edition. |
| Insurance, surety | Municipalities, provinces and states publish their own bond forms and expect them back unchanged. necodoc fills the form they published. | Obligees expect their own form back, unchanged. necodoc fills the form they published. |
| Insurance, claims | Conditional sections and shared clauses mean one reviewed template covers the cases, instead of a folder of near-copies. | Conditional sections and shared clauses let one reviewed template cover the cases. Retire the folder of near-copies. |
| Architecture, integration | There is no packaged connector. Your systems call a versioned REST API, described by OpenAPI 3.1. Each template version has a JSON Schema. Generated SDKs are available for … | There's no packaged connector. You get a versioned OpenAPI 3.1 REST API, a JSON Schema per template version, and SDKs for … |
| Security, AI callout | Generation data, the policyholder data that fills real documents, isn't sent. | Generation data isn't sent. |
| Security, controls | Each spec lists the control's known limits. Download the table as CSV for a vendor questionnaire. | Download it as CSV and paste it straight into a vendor questionnaire. Each spec lists that control's known limits. |
| Open source, webhooks | Signed callbacks when generations and batches finish, so your systems pick up the PDF without polling. | Signed callbacks when generations and batches finish. |

Meta descriptions for Home and Product now lead with what the buyer gets rather than a feature
list.

## Claim fixes

- Insurance, certificates: "an expiring share link" became "a share link, which can expire".
  Expiry is an option ([Share links](../../docs/features/share-links-and-data-requests.md)).
- Architecture scaling and Performance throughput now say the figures above one worker are
  modelled at one worker per server, as [bench.ts](../../apps/web/src/lib/bench.ts) computes them.
  Before, Architecture read "expect about these figures" and Performance didn't say.

## Cut

- Home hero: the versioned API, the worker count and the change log sentences (all covered
  further down the page).
- Home pillar 01: "Nobody redraws the form." Home architecture: "at the bottom".
- Product hero: "Each section links to its spec, which lists its limits." (the Proof links show it).
- Product output and Security output: "for retention", "for screen readers", "for accessible
  formats".
- Product change control: "Your systems call a published version." Product SDKs: "the same
  OpenAPI document as the API reference".
- Architecture hero: the durable-state sentence (the headline already says it). Components: "Only
  Postgres and object storage hold state." KEDA: how KEDA reads queue depth.
- Insurance bilingual: "Since 2023" and "The template holds a translation for each language".
- Security: "and inherits your controls" (twice), "Review and publishing are separate
  permissions." in the change-control pillar (the checklist says it).
- Open source: "like any service you host"; "Workers are a replica count; add them for month-end
  and remove them after."

## Left for the reel and review pack

Neither was touched. Nothing in them now contradicts the site. The review pack's AI callout still
has "Generation data, the policyholder data that fills real documents, is not sent", and it
explains more than the site now does, which suits a review document.
