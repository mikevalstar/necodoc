<!--
  Prose for the architecture review pack (docs/features/architecture-review-pack.md).
  Each "# " heading is a numbered section. `spec:<path>` links point at docs/<path>.md at the
  pack's commit. `@name` comments are replaced with generated parts; `@newpage` starts a page.
  Keep it to what the specs say: no customer names, no named core systems, no claim from
  docs/features/marketing-site.md "We must not make".
-->

# About this document

This pack describes necodoc as of the release on the cover, for an architecture or security
review. It states what the software does, where data goes, which controls exist and where each
one stops.

- **Built from the repository.** The controls table and the performance figures are read from
  the same sources as the public site, and this PDF was rendered by necodoc's own renderer.
- **Every section links to its specification** at the commit on the cover. The specs record
  intent and known limitations in more detail than fits here.
- **No attestations.** necodoc is software you run, not a hosted service, so there is no SOC 2
  report or ISO certificate to attach. It runs inside your boundary and inherits your controls.

# Product summary

necodoc is self-hosted document generation. Your systems post data and get a PDF back; staff
fill a guided form and get the same PDF. It produces documents three ways:

- **Designed templates and HTML**, rendered by headless Chromium, with headers, footers, page
  numbers, conditional sections and repeating groups.
- **Overlays on existing PDFs**, such as an obligee's bond form or a regulator's form: fields are
  placed on the original pages, so the output looks exactly like it. AI can propose field
  positions when enabled; an editor accepts them.
- **Packets** that combine generated and uploaded PDFs into one file.

Templates have typed fields that drive the form, API validation and a JSON Schema per published
version. Published versions are immutable; review and publishing are separate permissions.
Output can be PDF/A-2b or 2u, tagged PDF/UA-1, and certified with your certificate. One template
produces English and fr-CA documents.

It runs as containers next to one Postgres database, in your cloud account or data centre.

[Self-hosting](spec:features/self-hosting) ·
[Competitive scope](spec:features/competitive-scope)

<!-- @newpage -->

# Reference architecture

Everything inside the dashed boundary runs in your environment. The items outside it are
optional and outbound only.

<!-- @diagram -->

- **Callers:** core and policy systems over `/api/v1` with API keys; staff in the browser app
  through your identity provider; recipients of public share links.
- **API and render workers** are stateless and scale by replica count. Workers run headless
  Chromium in-process with JavaScript off and no network access.
- **State** lives in your Postgres and your object storage only.
- **Outbound, optional:** webhooks to endpoints you configure, your own e-signature integration
  fed by signing packages, and Anthropic's API only if an admin enables AI.

[Render queue, batch jobs and scaling](spec:features/render-queue-batch-jobs-and-scaling) ·
[ADR 0012](spec:adrs/0012-headless-chromium-for-html-to-pdf)

# Components and state

Only Postgres and object storage hold state. Every necodoc process can be killed and replaced.

| Component | Does | Scales by | State |
| --- | --- | --- | --- |
| API (`ROLE=api`) | Serves `/api/v1` and the web app; authenticates keys and sessions; validates data against the template's fields; queues renders; issues signed download links | Replicas behind your load balancer | None |
| Render worker (`ROLE=worker`) | Claims render jobs; runs Chromium for designed and HTML documents; stamps overlays; applies PDF/A, PDF/UA and certification; writes the PDF | Replicas, each with `RENDER_CONCURRENCY` slots; KEDA on queue depth | None; a job on a lost worker retries |
| Postgres | Users, templates and versions, themes, assets and uploaded PDFs, the generation log, the audit log, settings and the job queue (pg-boss) | Your database tier; this is the throughput ceiling | All durable records |
| Object storage | Generated PDFs: an S3-compatible bucket, an Azure Blob container, or a shared disk | Your storage service | PDF bytes |
| Identity provider | Sign-in for people over OIDC, SAML 2.0 or a trusted header; groups map to roles | Yours | Yours |
| Single process (`ROLE=all`) | API and worker in one process, for evaluation and small installs | Not meant to | None |

Back up Postgres, then storage, plus three secrets: `BETTER_AUTH_SECRET`,
`DOWNLOAD_SIGNING_SECRET` and the storage credentials.

[ADR 0014](spec:adrs/0014-binary-files-stored-in-postgres) ·
[ADR 0020](spec:adrs/0020-pg-boss-job-queue-and-separate-render-worker-processes) ·
[ADR 0023](spec:adrs/0023-generated-outputs-in-object-storage)

# Deployment options

One image set and one set of environment variables in every option. Configuration is validated
at start; a bad value stops the process and names the variable. Nothing calls home, so it runs
without outbound internet.

| Option | For | What you get |
| --- | --- | --- |
| Docker images | Any container platform | An API and worker image (Node, with Chromium) and nginx images for the app and docs, built from the repository's Dockerfile |
| Docker Compose, one host | Evaluation and small installs | Postgres, migrations, API, workers and the app from one `.env`; `--scale worker=N`; an optional monitoring profile with Prometheus and Jaeger |
| Helm on Kubernetes | Production | Separate API and worker Deployments behind one Ingress, migrations as a pre-install hook, disruption budgets, graceful drain on scale-down, Prometheus annotations or a `PodMonitor`; bring your own Postgres |
| KEDA autoscaling | Peaks such as renewal runs | Worker replicas follow queue depth read from Postgres; without KEDA, a CPU autoscaler works |

Health and readiness endpoints on every process; readiness fails without the database, queue or
storage. Upgrades are explicit: new image tag, run migrations, roll the pods.

<p class="limit"><b>Limit</b> The Helm chart passes <code>helm lint</code>, <code>helm template</code> and kubeconform but has not yet been run on a live cluster, and OpenShift isn't tested. There is no published image registry: you build the images from source.</p>

[Self-hosting](spec:features/self-hosting) ·
[ADR 0025](spec:adrs/0025-container-images-compose-and-helm-for-self-hosting)

# Integration patterns

There is no packaged connector for any core system. Systems integrate over a versioned REST API
described by OpenAPI 3.1, with a JSON Schema per published template version and generated SDKs
for TypeScript, Python, .NET and Java.

| Pattern | Use | How |
| --- | --- | --- |
| Synchronous | A certificate issued while someone waits | `POST …/generate` returns the PDF, or JSON with a signed `downloadUrl`; `X-Generation-Id` names the log entry |
| Asynchronous | Bind and issue events | `async: true` returns 202 with an id; an HMAC-signed webhook brings the result |
| Batch | Renewal runs | Up to 10,000 rows of JSON or CSV per batch; progress, cancel, then one ZIP or one combined packet |

Interactive renders and synchronous calls go ahead of batch rows. Errors are JSON with a code and
per-field errors: 401 bad key, 403 scope or IP, 422 invalid data, 429 rate limit with
`Retry-After`. Every response carries `X-Request-Id`.

[HTML to PDF API](spec:features/html-to-pdf-api) · [Webhooks](spec:features/webhooks) ·
[ADR 0030](spec:adrs/0030-openapi-for-the-public-api-with-hono-openapi) ·
[ADR 0041](spec:adrs/0041-python-net-and-java-sdks-generated-with-openapi-generator)

# Data flows

| Data | Stored in | Leaves your boundary |
| --- | --- | --- |
| Templates, versions, snippets, themes, assets | Your Postgres | No |
| Input data for each PDF | Your Postgres (generation log), for a retention period you set | No |
| Generated PDFs | Your bucket, blob container or disk, in your region | Only through signed, expiring links you issue |
| Logs, metrics, traces | Your log shipper, Prometheus and OTLP collector; field values are never logged | No |
| Webhook payloads | Sent to endpoints you configure | Yes, to your URLs, HMAC-SHA256 signed |
| Signing packages | Your Postgres; fetched by your e-signature integration | Only if your code sends them on |
| Draft templates, form page images | Sent to Anthropic's API for the template assistant and AI field detection | Only if `ANTHROPIC_KEY` is set |

<p class="callout"><b>AI is the one thing that can leave your environment, and it's off by default.</b> If an admin sets <code>ANTHROPIC_KEY</code>, the template assistant sends the draft template (fields, content, sample data) and AI field detection sends page images of an uploaded form to Anthropic's API. Generation data, the policyholder data that fills real documents, is not sent. Each AI request is recorded in the audit log; prompts and replies aren't stored. Without the key, AI controls are absent and the AI routes return 404.</p>

[AI template assistant](spec:features/ai-template-assistant) ·
[PDF overlay templates](spec:features/pdf-overlay-templates)

# Identity and access

**People** sign in through your identity provider, with email and password, or both.

- OIDC and SAML 2.0 providers such as Entra ID, Auth0 or SiteMinder, plus a trusted-header mode
  for SiteMinder-style web agents that accepts the header only from proxy addresses you list.
- Accounts are created at first sign-in. IdP groups map to roles (admin, publisher, reviewer,
  editor, viewer) and are re-synced at every sign-in. A user in no mapped group gets no access
  until an admin grants it.
- An IdP can't take over an existing account with the same email unless the operator allows
  linking. Password sign-in can be turned off.
- Admins ban users, revoke sessions and reset passwords. Impersonation is admin-only and audited.

**Systems** call `/api/v1` with API keys.

- A key belongs to a person or to a service account. Service accounts can never sign in.
- Each key has scopes no wider than its owner's roles, an optional template allowlist, an
  optional IP allowlist, an expiry date and a rate limit, and shows its usage. Keys are revoked
  or rotated, not edited.

<p class="limit"><b>Limit</b> No SAML single logout, no IdP-initiated sign-in, no signed AuthnRequests or encrypted assertions. Providers are configured by environment variables and a restart. The IP allowlist sees the reverse proxy's address unless <code>TRUST_PROXY</code> is set.</p>

[Single sign-on](spec:features/single-sign-on) ·
[User management and roles](spec:features/user-management-and-roles) ·
[ADR 0029](spec:adrs/0029-service-accounts-and-scoped-api-keys)

<!-- @newpage -->

# Security controls

The same list as the controls table on the site's security page, which is also offered there as
a CSV for questionnaires. Each row links to the specification that defines the control and its
known limits.

<!-- @controls -->

# Audit and observability

**Audit log.** Every configuration and access change, sign-ins including failures, impersonation
and API key use, with before and after diffs, the actor, IP address and request id. Rows are
append-only, enforced by a database trigger, and export as CSV.

**Generation log.** Every PDF with its source, caller, template version, input, output, output
profile, worker, attempts and a timing breakdown (queue wait, Liquid, Chromium, bands, stamping,
finishing). Any entry can be re-run against the exact version it used.

**Operations.** JSON logs on stdout with one request id from the API call through the queue to
the worker. Prometheus metrics on a separate port: HTTP, render durations by phase, queue depth
and age, worker slots. OpenTelemetry traces with the standard `OTEL_*` variables, not loaded
unless configured. Secrets are redacted from logs, and logs and traces never carry field values.

<p class="limit"><b>Limit</b> The audit log is tamper-resistant, not tamper-evident: there is no hash chain, and a database administrator can disable the trigger. Ship it to your SIEM if you need proof against your own administrators. Audit entries are kept forever. File downloads aren't audited, only minting a signed link. The metrics port has no authentication and must not be exposed.</p>

[Audit log](spec:features/audit-log) · [Generation log](spec:features/generation-log) ·
[Observability](spec:features/observability) ·
[ADR 0032](spec:adrs/0032-append-only-audit-log-with-a-request-scoped-actor) ·
[ADR 0036](spec:adrs/0036-pino-logs-prometheus-metrics-and-opt-in-opentelemetry-traces)

# Data protection

- **Storage drivers.** Generated PDFs go to an S3-compatible bucket (AWS S3, MinIO, Wasabi,
  Cloudflare R2 and the like), an Azure Blob container, or a disk volume every process shares.
  You choose the region; encryption at rest is your storage service's.
- **Downloads** stream through the API, or through signed links that work without a session
  until they expire (up to 7 days). Minting a link is audited.
- **Sensitive fields.** Fields can be marked sensitive, and signatures and keys that look like a
  SIN, tax id, passport, birth date, bank account or card number are treated as sensitive
  automatically. Their values are masked in audit diffs and in other people's generation log
  entries.
- **Erasure.** Admins search everything stored about a data subject, by a subject key the caller
  sends or by any stored value, and erase it: inputs, PDFs and stored objects, packets, webhook
  delivery logs and share-link responses. The erasure report lists what was deleted; the audit
  entry records counts, never the search term.
- **Retention.** An admin setting deletes outputs, and optionally inputs, older than N days while
  keeping the log metadata.

<p class="limit"><b>Limit</b> Audit entries and logs you've shipped elsewhere can't be erased. Erasure matches exact values only, so callers should send a subject key. Signed links can't be revoked before they expire, except by deleting the entry.</p>

[Personal data masking and erasure](spec:features/personal-data-masking-and-erasure) ·
[ADR 0023](spec:adrs/0023-generated-outputs-in-object-storage) ·
[ADR 0039](spec:adrs/0039-sensitive-fields-masked-outside-stored-inputs-erasure-by-data-subject)

# Compliance: what helps and what stays yours

necodoc doesn't make a carrier compliant with anything. These are the features that help with
each requirement, and what remains the carrier's work.

| Requirement | How necodoc helps | Still yours |
| --- | --- | --- |
| OSFI B-10, third-party risk | Self-hosted MIT software: audit and access rights are yours, and the exit plan is your own Postgres and storage | Your third-party assessment and exit testing |
| OSFI B-13, technology and cyber risk | Runs inside your controls: your IdP, network, keys, logging and patch cycle | Operating and patching it |
| Bill 96, French first in Québec | English and fr-CA documents from one template, so the copies can't drift | Translation quality and legal review |
| Law 25 and PIPEDA, privacy | You choose the region; sensitive-field masking; erasure per data subject with a report | Privacy assessments, retention policy |
| AODA, accessible formats | Tagged PDF/UA-1 output from designed and HTML documents | Accessible content and alt text in templates |
| Records retention | PDF/A-2b or 2u output; retention settings for outputs and inputs | Your retention schedule |

## What we don't claim

- No SOC 2, ISO 27001 or "certified secure": we describe controls, not attestations.
- Not a "tamper-proof" audit log: it's tamper-resistant, as stated above.
- Not an e-signature service, and no ESIGN, eIDAS or UECA claims. Signing packages hand
  signers, routing order and box positions to your provider, which runs the signing.
- Not "data never leaves" without the AI caveat in Data flows.
- No packaged core-system connectors, prebuilt bureau form libraries, Word output or multi-step
  approval chains.

[Archival, accessible and certified output](spec:features/archival-accessible-and-certified-output) ·
[Document localization](spec:features/document-localization) ·
[Signing packages](spec:features/signing-packages)

# Performance

<!-- @bench -->

# Known limits

Collected from the specifications, so your review doesn't have to find them.

| Area | Limit |
| --- | --- |
| Integration | No packaged core-system connectors; integration is over the REST API. SDKs aren't on package registries yet. |
| Deployment | No published image registry; the Helm chart hasn't run on a live cluster; OpenShift isn't tested; Helm brings no Postgres. |
| Regions | One Postgres per install, so one region per install. Run one install per region if residency requires it. |
| Throughput | Postgres carries the queue as well as the data and is the ceiling. Very high volumes will need a dedicated queue. |
| Recovery | A killed worker's job is retried after a missed heartbeat, 10 to 20 seconds later. A render timeout is a template error and isn't retried. |
| Batches | Up to 10,000 rows and 20 MB of input per batch. |
| Identity | No SAML single logout, IdP-initiated sign-in, signed AuthnRequests or encrypted assertions. |
| Audit | Tamper-resistant, not tamper-evident; no retention; downloads aren't audited. |
| Privacy | Erasure matches exact values; audit entries and shipped logs can't be erased. |
| Output | PDF/A for overlays depends on the uploaded form embedding its fonts. PDF/UA is only as good as the template's content. One certificate per server; no HSM or cloud KMS yet; signatures are PAdES B-B or B-T, not B-LT. |
| Change control | One review step; no multi-step approval chains. |
| Observability | The metrics port is unauthenticated; no spans for database queries or outbound calls. |

# Support and licence

**Support:** coming soon.

**Licence:** MIT. You can read, fork and modify the source. There is no licence fee per worker,
document or seat; the cost is your infrastructure.

**Exit:** standard Postgres, PDFs in your storage, templates stored as data, and the source you
already have. No vendor holds your data.

Source: [github.com/mikevalstar/necodoc](https://github.com/mikevalstar/necodoc)
