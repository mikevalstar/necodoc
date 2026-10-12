---
type: feature
title: Marketing site
description: Positioning and messaging for the public site (apps/web), written for the enterprise architect at a P&C insurer or surety carrier, Canadian market first. Audience concerns, message pillars mapped to shipped features, claims we can and can't make, competitor framing, page list, reference architecture, CTAs and tone.
tags: [product, marketing, web, enterprise]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T13:13:08Z }
---

# Marketing site

## Summary

The public site ([apps/web](../../apps/web/src/pages/index.astro),
[ADR 0003](../adrs/0003-astro-for-the-marketing-site.md)) has to get one
person to say yes: the enterprise architect at a P&C insurer or surety
carrier who will sign off on how necodoc fits their estate. This spec
records who that is, what they need to see, and what we say to them. Page
structure and design are W3 (NECO-zpkfijww); numbers come from the W2
benchmark (NECO-zaltzigs).

## Motivation

Insurance architects already trust GhostDraft, even where it does less than
necodoc ([Competitive scope](competitive-scope.md)). They trust it because it
speaks their language: insurance documents, core-system integration,
governance, deployment they control, named customers. A developer-tool site
(pricing per PDF, a playground, "ship in minutes") reads as a toy to this
reader. The site has to answer an architecture review before anyone asks,
and every claim on it has to survive one.

## Audience

**Primary:** the enterprise or solution architect at a Canadian P&C insurer
or surety carrier, evaluating document generation for policy documents,
certificates of insurance, surety bonds on obligee forms (municipal,
provincial, state), bulk renewals and claims letters.

**Secondary:** the platform/DevOps lead who will run it, the security
reviewer, and the business owner (underwriting, surety, forms team) who
brought the request.

**Decisions taken** (Mike, 2026-10-12, on NECO-jcechdfg):

- No customer is named on the site, including the one that prompted it.
  Write for P&C and surety carriers with details that resonate: Canadian,
  bilingual EN/FR, Entra ID sign-in, accessibility, self-hosted.
- E-signature is "e-signature ready", never "e-signature".

**Decisions taken** (Mike, 2026-10-12, on NECO-dimhbgii):

- No French site for now. The site is English only; the product's EN/fr-CA
  document output stays a feature on it.
- Named core systems (Guidewire, Duck Creek, PolicyCenter) aren't discussed
  for now. Say "your policy admin system" or "core systems".
- Support is "coming soon", with no further detail.
- The architecture review pack is generated on each release (W8,
  NECO-syjjmvla).
- Product, Compare and Open source and pricing pages are a separate ticket
  (W9, NECO-igeuyzto), now built and linked from the header and footer.

### What the architect needs to sign off

Each concern needs an answer on the site, with a link to the spec or doc that
proves it.

| Concern | Their question | Our answer |
|---|---|---|
| Architecture and deployment fit | Does it run where we run things? | Containers, Compose or Helm, one Postgres, any Kubernetes or VM, in their own cloud or data centre ([Self-hosting](self-hosting.md)) |
| Integration patterns | How does our policy admin system call it? | No packaged connector. A versioned REST API with OpenAPI and a JSON Schema per template; sync, async + signed webhook, batch; SDKs for TypeScript, Python, .NET, Java. The Architecture page shows the pattern: core system posts data, gets a PDF or a webhook ([HTML to PDF API](html-to-pdf-api.md), [Webhooks](webhooks.md)) |
| Separation of duties | Can the business own wording while IT owns data and integration? | Editors change content; fields are the data contract; publishing and review are separate permissions ([User management and roles](user-management-and-roles.md)) |
| Security and identity | Does it use our IdP? How are systems authenticated? | Entra ID, Auth0, SiteMinder over OIDC or SAML, group-to-role mapping; service accounts with scoped, expiring, IP-restricted keys ([Single sign-on](single-sign-on.md), [ADR 0029](../adrs/0029-service-accounts-and-scoped-api-keys.md)) |
| Data residency | Where does policyholder data go? | Nowhere they didn't put it: their Postgres, their bucket or blob container or disk, in their region; downloads through signed links. AI is off unless they add a key ([ADR 0023](../adrs/0023-generated-outputs-in-object-storage.md)) |
| Scalability and HA | Month-end renewals, peak hours, node loss? | Stateless API and workers scale out; queued jobs with priorities; a killed worker's job retries elsewhere ([Render queue](render-queue-batch-jobs-and-scaling.md)) |
| Observability | Does it plug into our monitoring? | JSON logs, Prometheus, OpenTelemetry traces, request ids end to end, health endpoints ([Observability](observability.md)) |
| Governance and change control | Who changed the bond wording, who approved it, can we prove it? | Immutable published versions, review gate, test cases and visual diff, append-only audit log with diffs ([Publishing](publishing-and-versions.md), [Review](review-and-approval.md), [Test cases](template-test-cases-and-visual-diff.md), [Audit log](audit-log.md)) |
| Compliance and accessibility | French-first policies (Bill 96), accessible formats (AODA), archives, privacy requests (PIPEDA, Law 25)? | EN/FR (fr-CA) from one template, PDF/UA-1, PDF/A-2, PAdES certification, PII masking and data-subject erasure ([Localization](document-localization.md), [Archival output](archival-accessible-and-certified-output.md), [Personal data](personal-data-masking-and-erasure.md)) |
| Vendor risk and lock-in | What if the vendor disappears? What's our exit plan (OSFI B-10)? | MIT source they can fork, standard Postgres, PDFs in their storage, templates as data; nothing phones home. It runs inside their own controls, so there is no third party holding their data |
| TCO and licensing | What do 20 workers cost? | No per-worker, per-document or per-seat licence; cost is their infrastructure |
| Support | Who do we call at 2 a.m.? | "Coming soon", nothing more for now |

## Message pillars

Lead with what an insurance document team can't get elsewhere in one
product. Order is the order on the home page.

1. **Fill the forms you already have.** Upload the obligee's bond form or the
   regulator's PDF and place fields on it; AI proposes the boxes, a person
   confirms them. Output looks exactly like the original.
   Proof: [PDF overlay templates](pdf-overlay-templates.md), AcroForm import,
   empty-password government PDFs, hybrid XFA handled.
2. **Fast, and it scales out.** Per-render timing on every generation.
   Numbers only from the [Performance benchmark](performance-benchmark.md)
   JSON, with its hardware, date and commit beside them. Placeholders until
   the schema lands: `{bench.html.p50}`, `{bench.overlay.p50}`,
   `{bench.designed.p95}`, `{bench.batch.docsPerMin}`, scaling at
   `{bench.scale.1}` / `{bench.scale.4}` / `{bench.scale.8}` workers, on
   `{bench.env.cpu}`. Batches of up to 10,000 rows from JSON or CSV, with
   progress, cancel, ZIP or one packet.
   Proof: [Render queue, batch jobs and scaling](render-queue-batch-jobs-and-scaling.md),
   [Generation log](generation-log.md).
3. **Add workers, not licences.** Workers are a replica count. There is no
   per-worker, per-core or per-document fee because there is no licence fee.
   Proof: `ROLE` / `RENDER_CONCURRENCY`, Helm with KEDA
   ([ADR 0020](../adrs/0020-pg-boss-job-queue-and-separate-render-worker-processes.md),
   [Self-hosting](self-hosting.md)).
4. **Built for insurance documents.** Surety bonds with principal, surety and
   attorney-in-fact signers; certificates and policy packets combined into
   one PDF; bilingual EN/FR output from one template; certified PDFs a
   recipient can check against an edited copy.
   Proof: [Signing packages](signing-packages.md),
   [Combining PDFs into packets](combining-pdfs-into-packets.md),
   [Document localization](document-localization.md),
   [Archival, accessible and certified output](archival-accessible-and-certified-output.md).
5. **Templates the business owns, under change control.** Typed fields with
   conditional logic drive the guided form, API validation and a JSON Schema.
   Snippets for shared clauses, themes for house style, a review gate, test
   cases and visual diff before publish.
   Proof: [Template fields and guided form](template-fields-and-guided-form.md),
   [Snippet library](snippet-library.md), [Document themes](document-themes.md),
   [Review and approval](review-and-approval.md),
   [Template test cases and visual diff](template-test-cases-and-visual-diff.md).
6. **An API your systems can depend on.** HTML to PDF and template generation
   over a versioned, OpenAPI-described API; sync, async with signed webhooks,
   or batch; generated SDKs.
   Proof: [HTML to PDF API](html-to-pdf-api.md), [Webhooks](webhooks.md),
   [ADR 0030](../adrs/0030-openapi-for-the-public-api-with-hono-openapi.md),
   [ADR 0041](../adrs/0041-python-net-and-java-sdks-generated-with-openapi-generator.md).
7. **E-signature ready.** Signature capture in the form, and a signing package
   per document: signers, routing order and every box's position, as envelope
   JSON for DocuSign, Dropbox Sign or Adobe Acrobat Sign. The provider runs
   the legally binding signing. Proof: [Signing packages](signing-packages.md).
8. **Runs in your cloud, answers to your auditors.** Their IdP, their storage,
   their monitoring. Append-only audit log, a log entry for every PDF with
   its input and timing, PII kept out of logs, erasure per data subject.
   Proof: [Single sign-on](single-sign-on.md), [Audit log](audit-log.md),
   [Observability](observability.md),
   [Personal data masking and erasure](personal-data-masking-and-erasure.md).

**Mentioned, not led with:** open source under MIT, and extendable (fork it,
read it, add a storage driver). It belongs on the vendor-risk and TCO
answers and the footer, not the hero: to this buyer "open source" alone can
read as "unsupported".

## Claims

### We can defend

Each needs a link to its spec or doc on the page where it appears.

- Overlay onto existing PDFs, including flat forms with no fields; AI field
  detection is a suggestion an editor accepts.
- Every render logged with input, output, version and a timing breakdown,
  and re-runnable against the exact version.
- Horizontal workers with no licence cost per worker; scaling is
  configuration.
- Interactive renders jump ahead of batch rows.
- Append-only audit log, enforced by a database trigger, with before/after
  diffs, sign-ins and failures, impersonation and API key use, CSV export.
- Generated PDFs stored in S3-compatible buckets (AWS S3, MinIO, Wasabi,
  Cloudflare R2 and the like), Azure Blob or disk, served through signed
  links.
- SSO with Entra ID, Auth0, SiteMinder (OIDC, SAML 2.0, trusted header).
- PDF/A-2b/2u, PDF/UA-1 for designed and HTML documents, PAdES B-B/B-T
  certification; never claimed on a file that can't honestly carry it.
- One template, many languages, including fr-CA and right-to-left.
- Performance numbers, only as generated by the
  [benchmark](performance-benchmark.md), p50 and p95 from a full run, with
  hardware and method linked and its
  [caveats](performance-benchmark.md#caveats-and-limits-on-claims) honoured
  (local laptop stack, sequential latency, single-machine scaling).

### We must not make

- **"E-signature", "legally binding", "ESIGN/eIDAS/UECA compliant".** We
  hand off to a provider ([Signing packages](signing-packages.md)).
- **"Unlimited workers"** as a performance claim. Say "no per-worker
  licence"; throughput is bounded by Postgres, which also carries the queue
  ([Known limitations](render-queue-batch-jobs-and-scaling.md#known-limitations)).
- **SOC 2, ISO 27001, "certified secure", "bank-grade".** There is no hosted
  service to certify; we can describe controls, not attestations. The honest
  line is "runs inside your SOC 2 / B-13 boundary".
- **"Compliant with" OSFI B-10/B-13, Bill 96, AODA/WCAG, PIPEDA.** We can say
  which features help a carrier meet them (French output, PDF/UA, erasure,
  self-hosting), not that the product makes them compliant.
- **"Tamper-proof" audit log.** It's tamper-resistant, not tamper-evident (no
  hash chain; a DBA can disable the trigger) ([Audit log](audit-log.md#known-limitations)).
- **Native connectors** for any core system, or marketplace listings. We integrate over the REST API; say that.
- **"The only" / "first" / "100%"** anything; analyst placements we don't
  have.
- **Word/DOCX output, prebuilt ISO/AAIS form libraries, multi-step
  approvals** ([Competitive scope](competitive-scope.md#out-of-scope)).
- **"Data never leaves your environment"** without the AI caveat: with
  `ANTHROPIC_KEY` set, the AI assistant and field detection send template
  content and page images to Anthropic
  ([AI template assistant](ai-template-assistant.md)).
- **Published, signed images** or "production-proven on Kubernetes" until
  [Self-hosting](self-hosting.md#known-limitations) says so.
- **Customer names, logos, quotes or case studies** we don't have. Use worked
  examples (a surety bond, a bilingual certificate) labelled as examples.
- **Any number not produced by W2**, and no "x times faster than"
  competitors we haven't benchmarked.

## Competitor framing

Factual rows only, checked on their sites and dated; no adjectives about
them. The aim is "here's where each fits", which architects respect, not a
takedown. Source of truth for rows: [Competitive scope](competitive-scope.md);
recheck before publishing.

| | necodoc | GhostDraft | DocSpring / Anvil | Enterprise CCM (Smart Communications, Quadient Inspire, OpenText Exstream, Messagepoint) |
|---|---|---|---|---|
| Deployment | Self-hosted only, in your cloud or data centre | SaaS on Azure | SaaS (DocSpring: on-prem on request) | SaaS; Quadient Inspire Flex also on-prem or containers |
| Core-system integration | REST API, webhooks, SDKs; no packaged connectors | Packaged core-system integrations | REST API | Core-system accelerators |
| Authoring | In-app editor, HTML, or fields on an existing PDF | Microsoft Word | HTML or fields on a PDF | Vendor designer tools |
| Fill existing PDFs | Yes, with AI field proposals | Not a stated focus | Yes | Varies |
| Bureau forms (ISO/AAIS) | No | Yes | No | Varies |
| Bulk generation | Queued batches, workers scale out | Interactive, batch, on-demand | Async and batch APIs | Core strength |
| Licensing | MIT, no licence fee | Annual subscription | Per document | Commercial enterprise |
| Vendor attestations | None (you run it; it inherits your controls) | SOC 2 Type II | SOC 2 Type II | SOC 2, ISO 27001 and others |
| E-signature | Handoff packages to DocuSign, Dropbox Sign, Adobe Sign | Integrations | Own e-sign | Integrations |
| Channels | PDF only | Documents and communications | PDF | Print, email, SMS, web |

Rows from vendor sites, checked 2026-10-12 ([Research](#research)); recheck
before publishing.

Where a competitor is the better fit (multi-channel CCM, Word-native
authoring, a vendor SLA), the site may say so in one line. It costs little and
buys credibility.

## Pages

| Page | Its job |
|---|---|
| Home | In one screen: what it is (document generation for insurers, self-hosted), the three lead pillars (overlay, speed + scale-out, insurance fit), the reference architecture thumbnail, both CTAs |
| Insurance (W4) | The jobs: surety bonds on obligee forms, certificates of insurance, policy packets, bulk renewals, claims letters, bilingual output. One worked example each |
| Product | The pillars in full, each with screenshots and links to the spec and developer docs |
| Architecture | The reference architecture, deployment options, integration patterns, scaling and HA, data flow: what goes where |
| Security and governance | Identity, keys, data residency, audit, privacy, change control, output integrity; the controls list a security reviewer copies into a questionnaire; the AI data caveat |
| Performance | W2 numbers with method, hardware and the script to reproduce them |
| Compare | The competitor rows above, dated |
| Open source and pricing | MIT, no licence cost, what you pay for (your infra); support "coming soon" |
| Docs | Links out to the developer docs site ([ADR 0026](../adrs/0026-astro-starlight-for-the-developer-docs-site.md)) |

A French site is deferred.

Built pages: Home, Insurance, Architecture, Security and governance and
Performance (W3), and [Product](../../apps/web/src/pages/product.astro),
[Compare](../../apps/web/src/pages/compare.astro) and
[Open source and pricing](../../apps/web/src/pages/open-source.astro) (W9), in
[apps/web/src/pages](../../apps/web/src/pages/index.astro). The Compare page
dates its rows and links the vendor sources from [Research](#research), minus
the ones that name core systems.
Benchmark numbers are imported from the W2 JSON by
[bench.ts](../../apps/web/src/lib/bench.ts) and show as placeholders when it's
missing. Design decisions and open questions:
[design/website](../../design/website/README.md).

## Reference architecture

What the Architecture page diagram shows, matching
[Self-hosting](self-hosting.md) and the devdocs
[roles and scaling](../../apps/devdocs/src/content/docs/self-hosting/roles-and-scaling.md):

- **Callers:** core and policy systems over `/api/v1` (API keys, service
  accounts), people in the browser app (SSO), public share links.
- **necodoc API** (stateless, `ROLE=api`, scaled behind a load balancer).
- **Render workers** (`ROLE=worker`, N replicas, headless Chromium inside).
- **Postgres** (the customer's own, managed or not): templates, versions,
  logs, audit, and the job queue.
- **Object storage:** S3-compatible bucket, Azure Blob container, or shared
  disk; signed download links.
- **Identity provider:** Entra ID, Auth0, SiteMinder, or any OIDC/SAML IdP.
- **Observability stack:** Prometheus scrape, OTLP collector, log shipper.
- **Optional, outbound:** webhooks to the customer's systems; e-sign provider
  (the customer's own integration, fed by the signing package); Anthropic API
  only if AI is enabled.
- **Trust boundary** drawn around everything except the optional outbound
  items.

Deployment options shown beside it: one-host Docker Compose (evaluation,
small installs), Helm on Kubernetes (AKS, EKS, GKE, OpenShift, verify
OpenShift before naming it), API and worker split, autoscaling with KEDA.

## Calls to action

There is no sales team to book a demo with, so the CTAs are things an
architect can do alone, in the order they'd do them:

1. **Run it in 10 minutes:** the Compose quick start
   ([quickstart](../../apps/devdocs/src/content/docs/getting-started/quickstart.md)).
   The claim holds only if a timed run from a clean machine does it.
2. **Read the docs:** developer docs, especially self-hosting and the API
   reference.
3. **Get the architecture review pack:** one PDF (made with necodoc) with the
   reference architecture, data flows, controls list, the claims table above
   and the known limitations. This is the document the architect forwards to
   their review board. Generated per release ([Architecture review pack](architecture-review-pack.md)); every link
   uses one path in [links.ts](../../apps/web/src/lib/links.ts).
4. **View the source on GitHub.**

A contact route (email or GitHub Discussions) for questions, stated as what
it is.

## Tone

- Write like an architecture document, not an ad: concrete nouns, mechanisms,
  limits. "Workers retry a job lost to a crash" beats "resilient".
- Every claim links to its proof (spec, devdocs, source).
- State limits plainly, near the claim. Architects trust the vendor that
  tells them where it stops.
- Insurance vocabulary used correctly: obligee, principal, attorney-in-fact,
  certificate of insurance, renewal run, declarations page. No generic
  "documents at scale".
- Canadian spelling. Any French on the site (the bilingual examples) is
  reviewed by a fluent Québec speaker, not machine output.
- No hype words: revolutionary, seamless, effortless, enterprise-grade,
  AI-powered as a headline.
- Never disparage competitors.

## Research

Web research, 2026-10-12. Vendor claims are their own marketing.

**Why architects trust GhostDraft.** It is insurance-only and fits the core
system they already run: packaged integrations with the major policy admin
platforms
([2024 announcement](https://www.guidewire.com/about/press-center/press-releases/20241030/modernize-customer-communication-experiences-with-the-new-ghostdraft)),
and ISO/AAIS bureau content. Its modules follow
the design, develop, review and test, deploy stages IT already uses; the
business owns the wording in Word and IT owns the data mapping once
([GhostDraft 360 overview](https://www.duckcreek.com/wp-content/uploads/2022/02/GhostDraft-360-Overview.pdf)).
Third-party proof: SOC 2 Type II
([page](https://www.ghostdraft.com/soc-2-compliance)), Aspire and Celent
placement, named insurer quotes, SI partners. Pricing is an annual
subscription with unlimited users and templates
([benefits](https://ghostdraft.com/ghostdraft-benefits)). It is SaaS on Azure
([why](https://www.ghostdraft.com/why-ghostdraft)), and we found no public
statement about data residency or bilingual French output.

**Enterprise CCM vocabulary** (Smart Communications, Quadient Inspire,
OpenText Exstream, Messagepoint): interactive, on-demand and batch;
core-system integration; business users with less reliance on IT;
"any-premise" deployment (Quadient); template rationalization (Messagepoint,
a Toronto competitor); certifications as proof (SOC 2, ISO 27001, CSA STAR);
analyst rankings (Aspire, Celent). Sources:
[Smart Communications trust](https://www.smartcommunications.com/trust/),
[Quadient on Insurance-Canada](https://insurance-canada.ca/insurtech-spotlight/quadient/),
[OpenText Exstream for insurance](https://www.opentext.com/assets/documents/en-US/pdf/opentext-ao-exstream-for-insurance-en.pdf),
[Messagepoint](https://www.messagepoint.com/resources/why-messagepoint-is-the-ideal-solution-for-modernizing-health-life-and-pc-insurance-communications).

**Developer tools** (DocSpring, Anvil) sell time to first integration,
per-document pricing, free test modes and SOC 2 / HIPAA, with nothing about
governance or core systems ([DocSpring pricing](https://docspring.com/pricing/),
[Anvil pricing](https://www.useanvil.com/pricing)). That is the register to
avoid for this reader.

**Canadian context**, as it bears on what the site can say:

- Bill 96: since 2023, contracts of adhesion (most policies and endorsements)
  must be offered in French first in Québec
  ([Gowling WLG](https://gowlingwlg.com/en-ca/insights-resources/articles/2023/bill-96-s-french-first-rule-takes-effect)).
  Supports pillar 4: one template, fr-CA and EN, no drift between copies.
- OSFI B-10 (third-party risk, in force 2024) expects audit and access
  rights, exit plans and data returned in a usable format; B-13 covers
  technology and cyber risk
  ([OSFI B-10](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/third-party-risk-management-guideline),
  [Torys on B-13](https://www.torys.com/en/our-latest-thinking/publications/2024/03/osfis-guidance-on-technology-and-cyber-risk-management)).
  Self-hosted MIT software inside the carrier's boundary makes exit and
  audit simple; say so as "fits within", not "compliant with".
- Québec Law 25 s.17 requires an assessment before personal information
  leaves Québec ([BLG](https://www.blg.com/en/insights/2022/12/cross-border-transfers-of-personal-information-outside-quebec));
  PIPEDA has no residency rule but keeps the carrier accountable
  ([OPC](https://priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127)).
  Self-hosting lets the carrier choose the region.
- AODA expects accessible formats on request
  ([Slaw](https://www.slaw.ca/?p=32940)); PDF/UA output answers it.

**What this means for us.** The gaps we can fill honestly: residency,
exit and audit (B-10), French-first bilingual output, and no licence per
worker. The gaps we can't paper over: no packaged core-system
connector, no vendor attestation, no named customers, no analyst coverage.
The site answers those directly (integration over the API with a worked
policy-admin pattern; "runs inside your SOC 2 and B-13 boundary";
worked examples instead of logos) rather than leaving the architect to find
them.

## Acceptance criteria

- [ ] Every claim on the site links to a spec, devdocs page or source file.
- [ ] No claim from [We must not make](#we-must-not-make) appears on the
      site.
- [ ] Every number on the site is imported from the W2 benchmark output.
- [ ] No customer is named.
- [ ] Each concern in [What the architect needs to sign off](#what-the-architect-needs-to-sign-off)
      is answered on at least one page.
- [ ] The Architecture page shows the reference architecture above.
- [ ] The Compose quick start is timed from a clean machine before "10
      minutes" is published.
- [ ] Competitor rows carry the date they were checked.

## Open questions

- **Support.** The site says "coming soon". What gets offered (paid
  support, partner, none) is still open.
- **E-sign provider.** Mike mentioned "Accusign"; confirm whether that's a
  fourth provider or one of DocuSign, Dropbox Sign, Adobe Acrobat Sign.
- **Image registry.** Publishing signed images (GHCR) before launch would
  remove "build it yourself" from the quick start.
- **Domain** (W3). A French site and its URL scheme are deferred.
