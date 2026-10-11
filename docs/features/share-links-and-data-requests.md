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
- **Fill.** The link opens a public page with the template's
  [guided form](template-fields-and-guided-form.md), the same validation, and no app
  chrome. Progress is kept in the browser until submit.
- **Submit.** The API validates the answers, generates the PDF (logged with
  source "share link" in the [generation log](generation-log.md)), and stores
  the submission. The filler sees a confirmation and, if allowed, a download.
- **Owner view.** Each link lists its submissions with answers, the PDF, and
  submitted time. The owner can export submissions as CSV.
- **Notify** through the template's or link's [webhook](webhooks.md). In-app,
  the link shows a count of unseen submissions.
- **Revoke** disables a link at once. Expired, revoked and used-up links show
  a "no longer available" page.
- Links use an unguessable random token. Submissions are rate-limited per IP.

## Acceptance criteria

- [ ] A logged-out visitor can open a link, fill the form, submit, and (if
      allowed) download the PDF.
- [ ] The owner sees the submission and its PDF.
- [ ] Prefilled locked fields can't be changed, including by editing the
      request.
- [ ] Expired, revoked and used-up links refuse submissions.
- [ ] Invalid answers are rejected by the API, not only the form.
- [ ] A webhook fires on submission when one is configured.

## Known limitations

- No email. necodoc doesn't send the link or notify anyone by email; the owner
  shares the URL and watches the app or a webhook
  ([ADR 0011](../adrs/0011-role-based-access-with-the-better-auth-admin-plugin.md)).
- No identity check on the filler. Anyone with the link can submit.
- No CAPTCHA. Rate limiting is the only spam control.
- A filler can't save and come back on another device.
