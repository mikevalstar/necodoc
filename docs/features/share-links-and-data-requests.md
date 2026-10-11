---
type: feature
title: Share links and data requests
description: A published template can get a public link so someone without an account fills its guided form; the owner gets the submission and the generated PDF.
tags: [product, forms, app]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Share links and data requests

## Summary

A publisher creates a link to a published template and sends it to a client,
an applicant or a supplier. They fill the guided form without signing up. The
link's owner sees the answers and the PDF.

## Motivation

The people with the answers often aren't users: a customer completing an
intake form, a contractor filling a W-9. DocSpring's data requests and Anvil's
webforms exist for this. Emailing a PDF back and forth is the thing necodoc
replaces.

## Behavior

- **Create.** A user with `document: publish`
  ([Publishing and versions](publishing-and-versions.md)) creates a link for a
  published template, pinned to a version or following the latest one. Options:
  - a label (e.g. "Acme onboarding")
  - an expiry date
  - a maximum number of submissions (1 for a single-use request)
  - prefilled answers, which the filler can see and, per field, edit or not
  - whether the filler can download the PDF after submitting
  - whether the filler must give their email address

  The owner can disable and re-enable a link, change its options, or delete
  it (its submissions stay as documents).
- **Fill.** The link opens a public page with the template's
  [guided form](template-fields-and-guided-form.md), the same validation, and no app
  chrome beyond the necodoc mark. Progress is kept in the browser until submit.
  Query parameters named after unlocked fields prefill them
  (`?client_name=Acme`), so one link can be personalised per recipient.
- **Submit.** The API validates the answers, generates the PDF (logged with
  source "share link" in the [generation log](generation-log.md)), and stores
  the submission as a finished [document](filling-out-a-document.md) owned by
  the link's owner, with source "share link". The filler sees a confirmation
  and, if allowed, a download through a signed link that expires.
- **Owner view.** Each link lists its submissions with answers, the PDF, and
  submitted time; each opens as the owner's document. CSV export is not built
  yet.
- **Notify** through the template's or link's [webhook](webhooks.md) (not built
  yet). In-app, the link and the nav show a count of unseen submissions.
- **Revoke** disables a link at once. Expired, revoked and used-up links show
  a "no longer available" page.
- Links use an unguessable random token. Submissions are rate-limited per IP.
- API: [routes/share-links.ts](../../apps/api/src/routes/share-links.ts);
  app: [share links](../../apps/app/src/routes/_app/share-links/index.tsx) and
  the [public page](../../apps/app/src/routes/s.$token.tsx).

## Acceptance criteria

- [x] A logged-out visitor can open a link, fill the form, submit, and (if
      allowed) download the PDF.
- [x] The owner sees the submission and its PDF.
- [x] Prefilled locked fields can't be changed, including by editing the
      request.
- [x] Expired, revoked and used-up links refuse submissions.
- [x] Invalid answers are rejected by the API, not only the form.
- [ ] A webhook fires on submission when one is configured.

## Known limitations

- No email. necodoc doesn't send the link or notify anyone by email; the owner
  shares the URL and watches the app or a webhook
  ([ADR 0011](../adrs/0011-role-based-access-with-the-better-auth-admin-plugin.md)).
- No identity check on the filler. Anyone with the link can submit.
- No CAPTCHA. Rate limiting is the only spam control.
- A filler can't save and come back on another device.
- The rate limit lives in each API process's memory: with several API nodes a
  filler gets that many submissions per node, and a restart resets it. Behind
  a reverse proxy, set `TRUST_PROXY=true` so the client address comes from
  `X-Forwarded-For`; otherwise every filler shares the proxy's address.
- If the PDF takes longer than the API's wait to render, the filler gets the
  confirmation without a download; the owner still gets the PDF.
- Prefill and locking apply to top-level fields, not fields inside a
  repeating group.
