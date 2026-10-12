---
type: feature
title: HTML to PDF API
description: A versioned public API (/api/v1) that turns HTML into PDFs, generates from published templates singly or in batches, and combines PDFs. Scoped API keys for people and service accounts, an OpenAPI document, an in-app docs page and SDKs for TypeScript, Python, .NET and Java.
tags: [product, api, pdf]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# HTML to PDF API

## Summary

Developers and the systems they run send HTML or template data and get a PDF
back. The same renderer as the app, so API output matches previews.

## Motivation

Anvil and DocSpring both sell HTML to PDF as an API. Ours gets full-HTML
headers and footers with page numbers and a first-page variant, which
Chromium's own header templates can't do. Exposing the renderer lets necodoc
sit inside other products. Enterprise integrations need keys that outlive the
person who made them, and that can do only what the integration needs.

## Behavior

Mechanism: [ADR 0019](../adrs/0019-better-auth-api-keys-for-the-public-api.md),
[ADR 0029](../adrs/0029-service-accounts-and-scoped-api-keys.md) (service
accounts, scopes), [ADR 0030](../adrs/0030-openapi-for-the-public-api-with-hono-openapi.md)
(OpenAPI). Routes: [routes/v1.ts](../../apps/api/src/routes/v1.ts); key checks:
[api-keys.ts](../../apps/api/src/api-keys.ts).

### Keys

- **Personal keys** (Developers › API keys): every user with a role creates,
  lists, rotates and revokes their own. **Service-account keys** are managed
  by admins under Admin › Service accounts.
- **Service accounts**: non-human identities with a name, description, owner
  contact and roles. They can't sign in. Admins create, edit and disable them;
  a disabled account's keys stop working. Admin › Users doesn't list them.
- A key has a name, **scopes**, an optional expiry, an optional list of
  templates it may use, an optional **IP/CIDR allowlist**, and a rate limit.
  Scopes:
  - `render:html`: render HTML
  - `templates:read`: list templates, read versions and their JSON Schema
  - `templates:generate`: generate from a template
  - `batches:write` / `batches:read`: start batches / read them and download
    their ZIP or packet
  - `generations:read`: read generations and download their PDFs
  - `combine:write`: combine PDFs
- Every scope needs `document: view`; a key can't be given scopes its
  owner's roles don't allow, and it loses them when the owner loses the role.
- The secret is shown once, at creation, and starts with `nd_`. Lists show
  its first characters, created, expires, last used (time and IP) and total
  requests, and warn about keys expiring within 14 days.
- **Rotate** creates a replacement with the same settings (secret shown once)
  and makes the old key expire after an overlap window (default 24 hours).
- **Revoke** stops a key at once. Revoked and expired keys stay listed.
- **Admin › API keys** lists every key across users and service accounts,
  filters by owner and status, revokes, shows usage, and links to the
  generation log filtered by key.
- Keys never create sessions and work only on `/api/v1`. A banned owner's keys
  stop working.

### Endpoints

All under `/api/v1`, authenticated with the `x-api-key` header. Render and
generate take an optional `subject` (the person the document is about) so a
GDPR erasure can find it
([personal data masking and erasure](personal-data-masking-and-erasure.md)).

- `POST /render` (`render:html`): `html` (Liquid with `data`), optional `css`,
  `themeId` ([Document themes](document-themes.md)), `header`/`footer` bands
  (`html`, `height`, optional `firstPageHtml`), `page` (size, orientation,
  margins in mm), `filename`. Liquid's `date` filter takes dayjs tokens
  ([liquid.ts](../../apps/api/src/render/liquid.ts)).
- `GET /templates`, `GET /templates/:id` (`templates:read`): published,
  non-archived templates and their versions.
- `GET /templates/:id/versions/:version/schema` (`templates:read`): the JSON
  Schema for that version's data; `version` is a number or `latest`.
- `POST /templates/:id/versions/:version/generate` (`templates:generate`):
  `data` validated against the version's fields
  ([Template fields and guided form](template-fields-and-guided-form.md));
  invalid data returns 422 with every field error.
- `POST /templates/:id/versions/:version/batch` (`batches:write`): JSON rows;
  returns the batch. `GET /batches/:id`, `.../zip`, `.../packet`
  (`batches:read`). See
  [Render queue, batch jobs and scaling](render-queue-batch-jobs-and-scaling.md).
- `GET /generations/:id`, `GET /generations/:id/pdf`,
  `POST /generations/:id/link` (`generations:read`): the key owner's own
  generations; downloads stream from storage with ETag and range support like
  the app's ([generation log](generation-log.md)); the link works without a
  key until it expires.
- `POST /combine` (`combine:write`): see
  [Combining PDFs into packets](combining-pdfs-into-packets.md).
- `GET /openapi.json`: the OpenAPI 3.1 document, no key needed.

### Responses

- Render, generate and combine wait for the PDF. `response: "pdf"` (default)
  returns the bytes with `X-Generation-Id` and `X-Page-Count`;
  `response: "json"` returns the generation id, page count, size and a signed
  `downloadUrl`. `async: true`, or a render still queued when the wait runs
  out, returns `202` with the generation id to poll.
- `signing` on render and generate answers JSON with the
  [signing package](signing-packages.md) (signers, sign box positions,
  DocuSign / Dropbox Sign / Adobe Sign JSON);
  `GET /generations/{id}/signing-package` fetches it later.
- `output` on render, generate and combine asks for PDF/A, PDF/UA and
  certification; on generate it overrides the template's settings field by
  field ([Archival, accessible and certified output](archival-accessible-and-certified-output.md)).
  A generation's `outputProfile` says what was applied.
- Errors are JSON `{ error, code }`, plus `fieldErrors` for invalid data.
  401: missing, unknown, revoked or expired key, or a banned owner. 403: scope
  missing, owner's roles don't allow it, template not allowed, or IP not
  allowed. 429: rate limit, with `Retry-After` in seconds.
- Every response carries `X-Request-Id` (an incoming one is kept).

### Limits and logging

- Request bodies up to 20 MB, a render timeout, a per-key rate limit
  (requests per minute, set at creation, default 120). Remote URLs in the HTML
  don't load; use [assets](assets.md) or `data:` URLs.
- Every call that renders is logged in the [generation log](generation-log.md)
  with source "API" and the key; the log shows the key's name and filters by
  key.

### Docs and SDK

- **API page** in the app (nav: Developers › API reference): the OpenAPI document rendered with
  Scalar, listing every endpoint with request and response schemas, and a
  try-it client.
- The [developer docs](../adrs/0026-astro-starlight-for-the-developer-docs-site.md)
  reference is generated from the same document, with curl guides.
- SDKs are generated from it: TypeScript ([packages/sdk-ts](../../packages/sdk-ts)),
  Python ([packages/sdk-python](../../packages/sdk-python)), .NET
  ([packages/sdk-dotnet](../../packages/sdk-dotnet)) and Java
  ([packages/sdk-java](../../packages/sdk-java)), all regenerated by
  `pnpm sdk:generate` ([ADR 0041](../adrs/0041-python-net-and-java-sdks-generated-with-openapi-generator.md)).
  Each has a smoke example: render HTML, generate from a template, fetch a
  signing package. None is published to a package registry yet.
- **Render page** in the app ([render.tsx](../../apps/app/src/routes/_app/render.tsx)):
  the same request field by field, for trying HTML, bands, data and themes,
  plus the output options (PDF/A, PDF/UA, certification, document language).
  Its preview mode isn't logged. An **API call** panel shows the equivalent
  `POST /api/v1/render` as curl and TypeScript, Python, .NET and Java SDK
  code, updating as the form changes, with copy buttons. Snippets read the
  key from `$NECODOC_API_KEY`; the page never puts a real key in them.
- Optional [webhooks](webhooks.md) per key or service account.

## Acceptance criteria

- [x] A user can create a key, call render with it, and get a PDF; after
      revoking the key, the call returns 401.
- [x] A key from a user without `document: view` gets 403.
- [x] A key without the scope an endpoint needs gets 403.
- [x] A service account's key keeps working when the admin who made it is
      banned, and stops when the service account is disabled.
- [x] A rotated key works alongside its replacement until the overlap ends,
      then returns 401.
- [x] A call from an address outside the key's allowlist gets 403.
- [ ] HTML with a header, footer, first-page header and page tokens renders
      like the same design in a designed template.
- [x] Generating from a template with invalid data returns 422 with every
      failing field.
- [x] `response: "json"` returns a generation id whose PDF downloads.
- [x] Exceeding the rate limit returns 429 with `Retry-After`.
- [x] A request that references `http://169.254.169.254/` renders without
      fetching it.
- [x] The docs page lists every `/api/v1` endpoint.
- [ ] The render page's curl snippet, run with a real key, returns the same PDF
      as the page's Render button.

## Known limitations

- Synchronous calls wait up to a timeout, then return `202` with the
  generation id.
- Only a TypeScript SDK; other languages use plain HTTP and the OpenAPI
  document.
- No JavaScript in submitted HTML, and no URL-to-PDF.
- Scopes, allowlist and templates are set when a key is made; to change them,
  rotate or make a new key.
- The rate limit is a fixed count per window per key; after it's used up the
  key waits out the window from its last allowed request.
- The IP allowlist sees the reverse proxy's address unless `TRUST_PROXY` is
  set.
- Service accounts can't be deleted, only disabled.
- PDFs uploaded to `/combine` are stored as files of their own and aren't
  removed with the packet's generation.
- Every call that passes the secret check counts toward the rate limit and
  usage, including calls refused afterwards (scope, IP).
- Chromium rounds page sizes given in millimetres up by under a point (A4 comes out
  595.9 × 841.9 pt rather than 595.3 × 841.9). Bands are positioned from each
  page's real size, so they still line up.
