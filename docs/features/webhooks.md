---
type: feature
title: Webhooks
description: Optional per-API-key or per-template URLs that necodoc POSTs to, signed, when a generation completes or a share-link submission arrives.
tags: [product, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Webhooks

## Summary

necodoc calls a URL you choose when a PDF is ready, so other systems don't
have to poll.

## Motivation

Share-link submissions arrive while nobody is watching, and there is no email
([Share links and data requests](share-links-and-data-requests.md)). Zapier,
n8n and in-house systems all start from a webhook. DocSpring and Anvil both
offer them.

## Behavior

- **Where they're set:**
  - on an [API key](html-to-pdf-api.md): fires for generations made with that
    key
  - on a template: fires for every generation of it, from any source,
    including share-link submissions
- **Events:** `generation.completed`, `generation.failed`,
  `submission.created`. A webhook subscribes to some or all of them.
- **Payload:** JSON with the event, generation id, template id and version,
  source, status, page count, and a download path. Submissions add the
  submission id and answers. PDF bytes are not included.
- **Security:**
  - HTTPS URLs only
  - URLs that resolve to private, loopback or link-local addresses are
    refused, checked at send time, not just on save
  - each webhook has a secret; every request carries an HMAC-SHA256 signature
    of the body and a timestamp
- **Delivery.** POST with a short timeout. Non-2xx or timeout retries a few
  times with backoff. Each attempt is logged with status code and duration,
  visible on the webhook's page.
- A "send test" button fires a sample event.
- Template webhooks need `document: edit`. Key webhooks belong to the key's
  owner.

## Acceptance criteria

- [ ] A generation made with a key fires its webhook with a valid signature.
- [ ] A share-link submission fires the template's webhook.
- [ ] A webhook to `https://127.0.0.1/` or a host resolving to a private
      address is refused.
- [ ] A failing endpoint is retried, and each attempt shows in the delivery
      log.
- [ ] The docs page shows how to verify the signature.

## Known limitations

- Retries live in the API process. A restart drops pending retries.
- No manual redelivery of an old event, beyond re-running the generation.
- Delivery order is not guaranteed.
