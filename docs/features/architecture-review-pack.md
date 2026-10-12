---
type: feature
title: Architecture review pack
description: One versioned PDF for an insurer's architecture and security review board (architecture, deployment, data flows, identity, controls, audit, data protection, compliance helpers, benchmark results, limits), rendered by necodoc's own renderer on each release and linked from the site.
tags: [marketing, enterprise, pdf, release]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T14:02:29Z }
---

# Architecture review pack

## Summary

The architect who evaluates necodoc forwards one PDF to their review board.
`pnpm review-pack` builds it from the repo at a given commit and writes
[necodoc-architecture-review.pdf](../../apps/web/public/review-pack/necodoc-architecture-review.pdf),
which the site links through `links.reviewPack` in
[links.ts](../../apps/web/src/lib/links.ts). It is made with necodoc, so it
is also a sample of the output: tagged, archival, with bands and a contents
page.

## Motivation

Review boards want a document, not a website: something dated and
versioned they can file, annotate and check against the build they're asked
to approve. Every claim in it has to match the site and the specs, so it is
generated from the same sources rather than written separately
([Marketing site](marketing-site.md), Calls to action).

## Audience

The enterprise architect at a P&C insurer or surety carrier and the board
they report to: security reviewer, platform lead, risk and privacy
([Marketing site](marketing-site.md#audience)).

## Contents

Concise, factual, each section pointing to its spec at the pack's commit.
No customer names, no named core systems, no claim from
[We must not make](marketing-site.md#we-must-not-make).

1. **Cover:** release version (the Helm chart's `appVersion`), git commit,
   generation date, benchmark date.
2. **Contents** with page numbers.
3. **Product summary.**
4. **Reference architecture:** the site's diagram
   ([reference-architecture.svg](../../apps/web/src/assets/reference-architecture.svg)).
5. **Components and state:** what each process does, how it scales, what
   holds state ([Self-hosting](self-hosting.md)).
6. **Deployment options:** Docker image, Compose, Helm and KEDA, stating
   that the chart hasn't run on a live cluster and that there's no published
   image registry ([Self-hosting](self-hosting.md#known-limitations)).
7. **Integration patterns:** sync, async with signed webhooks, batch
   ([HTML to PDF API](html-to-pdf-api.md), [Webhooks](webhooks.md)).
8. **Data flows,** including the AI caveat
   ([AI template assistant](ai-template-assistant.md)).
9. **Identity and access:** SSO over SAML and OIDC, roles, service
   accounts, scoped API keys, IP allowlists
   ([Single sign-on](single-sign-on.md),
   [ADR 0029](../adrs/0029-service-accounts-and-scoped-api-keys.md)).
10. **Security controls:** the same rows as the site's controls table and
    CSV, read from [security.astro](../../apps/web/src/pages/security.astro)
    so there is one list.
11. **Audit and observability** ([Audit log](audit-log.md),
    [Generation log](generation-log.md), [Observability](observability.md)).
12. **Data protection:** storage drivers, signed links, PII masking, erasure,
    retention ([ADR 0023](../adrs/0023-generated-outputs-in-object-storage.md),
    [Personal data masking and erasure](personal-data-masking-and-erasure.md)).
13. **Compliance:** which features help with each requirement and what stays
    the customer's; what we don't claim.
14. **Performance:** the latest [benchmark](performance-benchmark.md) run
    with its environment and caveats, read from
    [latest.json](../../scripts/bench/results/latest.json). A quick or
    dirty-tree run is flagged on the page.
15. **Known limits,** collected from the specs.
16. **Support and licence:** support "coming soon"; MIT.

## How it's built

- [scripts/review-pack](../../scripts/review-pack/src/build.ts) turns the
  prose in [pack.md](../../scripts/review-pack/pack.md) into HTML, fills in
  the generated parts (cover, contents, controls, benchmark tables, diagram)
  and renders it with the API's renderer directly
  ([render.ts](../../apps/api/src/render/render.ts), DB-free), the same code
  path as a customer's HTML render ([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)).
- Letter size; the site's typefaces; header and footer bands with the
  version and page numbers; a contents page whose page numbers come from a
  first pass's outline.
- Finished as PDF/A-2u and PDF/UA-1
  ([ADR 0037](../adrs/0037-pdf-a-2-and-pdf-ua-1-by-post-processing-chromium-output-in-pdf-lib.md)),
  and checked with veraPDF when it is on PATH.

## When it's regenerated

- On each release, by `pnpm release:assets`. It refuses to run on a dirty
  tree or with a benchmark result that isn't publishable (quick run or
  uncommitted tree), requires veraPDF, then writes the PDF. The release
  commits it with the version bump.
- By hand with `pnpm review-pack` while editing; that run marks an
  unpublishable benchmark on the page instead of failing.
- The PDF is committed, like the benchmark's `latest.json`, so the site's
  link works in dev and in any build without a generation step. Its cover
  names the commit it was built from, so a stale copy is visible.

There's no CI in the repo, so nothing runs this automatically yet.

## Acceptance criteria

- [ ] `pnpm review-pack` writes the PDF with every section above, and the
      contents page numbers match the pages.
- [ ] veraPDF reports it compliant with PDF/A-2u and PDF/UA-1.
- [ ] The controls section has the same rows as the site's controls table.
- [ ] Every benchmark number comes from `latest.json`, with the hardware,
      date and commit beside it.
- [ ] `pnpm release:assets` fails on a dirty tree or an unpublishable
      benchmark run.
- [ ] No customer, no core-system vendor, and no claim from
      [We must not make](marketing-site.md#we-must-not-make) appears.

## Open questions

- **Release process.** There's no release script or CI yet; when one
  exists, `release:assets` becomes a step in it.
- **Controls list.** It lives in the security page's frontmatter; moving it
  to a module both the page and the pack import would be cleaner than
  reading it out of the page.
