---
type: feature
title: Webhooks
description: Signed HTTPS callbacks when API generations or batches finish, set on an API key, a whole account (person or service account) or a template, delivered from the job queue with retries and a delivery log.
tags: [product, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Webhooks

## Summary

necodoc calls a URL you choose when a PDF is ready, so other systems don't
have to poll.

## Motivation

Async and batch renders finish while nobody is watching
([Render queue, batch jobs and scaling](render-queue-batch-jobs-and-scaling.md)).
Share-link submissions do too, and there is no email
([Share links and data requests](share-links-and-data-requests.md)). Zapier,
n8n and in-house systems all start from a webhook. DocSpring and Anvil both
offer them.

## Behavior

Code: [webhooks.ts](../../apps/api/src/webhooks.ts),
[routes/webhooks.ts](../../apps/api/src/routes/webhooks.ts).

- **Where they're set.** A webhook belongs to an account (a person or a
  [service account](html-to-pdf-api.md#keys)) and fires for:
  - one of that account's API keys: generations made with it
  - the whole account: every generation made with any of its keys
  - a template (needs `document: edit`): every generation of it, from any
    source
  A key or template webhook can also be narrowed to the other.
- People manage their own from Settings › API keys; admins manage service
  accounts' from Admin › Service accounts.
- **Events:** `generation.succeeded`, `generation.failed`, `batch.completed`
  (batch rows don't fire generation events). A share-link submission fires
  `generation.succeeded` (or `failed`) with source `share_link`; there is no
  separate submission event. A webhook subscribes to some or all of them.
- **Payload:** JSON with the event, a delivery id, the time, and the
  generation (id, status, source, template id and version, batch id, file
  name, page count, size, error, key id, request id) or the batch (id,
  template, counts, status). Successful generations add a signed `downloadUrl`
  valid for 24 hours, and the `/api/v1` download path. PDF bytes are not
  included.
- **Security:**
  - HTTPS URLs only
  - URLs that resolve to private, loopback, link-local or other non-public
    addresses are refused when saved and again at send time; the request goes
    to the address that was checked, so DNS can't be swapped in between
  - redirects aren't followed
  - each webhook has a secret (shown once); every request carries
    `Necodoc-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`,
    plus `Necodoc-Event` and `Necodoc-Delivery`
- **Delivery.** POST with a 10 second timeout, from a pg-boss queue
  ([ADR 0020](../adrs/0020-pg-boss-job-queue-and-separate-render-worker-processes.md)),
  so retries survive restarts. Non-2xx or a timeout retries 5 times with
  exponential backoff, from about half a minute up to ten, so a delivery
  gives up 10 to 20 minutes after the first attempt. Each delivery shows its status, attempts, last
  response code and time, and every attempt, on the webhook's delivery log.
- A **send test** button fires a `webhook.test` event.
- Webhooks can be disabled and deleted.
- **Developer docs** show the payloads and how to verify the signature.
- For local development only, `WEBHOOK_ALLOW_LOCALHOST=true` allows `http://`
  and loopback URLs. It's off by default and must stay off in production.

## Acceptance criteria

- [x] A generation made with a key fires its webhook with a valid signature.
- [x] A batch fires `batch.completed` once, when its last row finishes.
- [ ] A share-link submission fires the template's webhook.
- [x] A webhook to `https://127.0.0.1/` or a host resolving to a private
      address is refused.
- [x] A failing endpoint is retried, and each attempt shows in the delivery
      log.
- [x] The docs page shows how to verify the signature.

## Known limitations

- No manual redelivery of an old event, beyond re-running the generation.
- Delivery order is not guaranteed; an event can arrive more than once if a
  worker dies mid-delivery. Use the delivery id to deduplicate.
- The secret can't be shown again or rolled; delete the webhook and make a new
  one.
- App generations (not through a key) fire only template webhooks.
