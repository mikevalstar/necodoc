# Public website: structure and design (W3)

The site is built in [apps/web](../../apps/web/src/pages/index.astro), not mocked here. This
file records the design decisions for review and the questions still open. Positioning,
claims and tone come from the [Marketing site](../../docs/features/marketing-site.md) spec;
screenshots of the build are in [shots/](shots/).

## Site map

| Page | Route | Its job |
|---|---|---|
| Home | `/` | What necodoc is, for whom, the three lead pillars (overlay, scale-out, insurance fit), real numbers, the reference architecture, the review board's questions, the six insurance jobs, where it stops, and four self-serve CTAs |
| Insurance | `/insurance/` | Six jobs (surety bonds, certificates, packets, renewals, claims letters, bilingual), each with how, limits, proof and a labelled example. W4 deepens it |
| Architecture | `/architecture/` | Reference architecture, components and state, deployment (Compose, Helm, KEDA), integration patterns with a worked PAS pattern, data flows, scaling and HA, observability, known limits |
| Security and governance | `/security/` | AI caveat first, the controls list (downloadable as CSV), audit, change control, output integrity, privacy, Canadian requirements (what helps, what stays yours), what we don't claim |
| Performance | `/performance/` | Every W2 number, read from `scripts/bench/results/latest.json`: latency, throughput by worker count, cold start and archival cost, environment, caveats, how to rerun |
| Product | `/product/` | The full feature tour (W9): six pillars with screenshots, then grids for output, change control, AI (with the data caveat), integrations and admin. Every item has its limit and spec link |
| Compare | `/compare/` | Dated rows vs GhostDraft, DocSpring, Anvil and enterprise CCM suites with sources, where the others are stronger, and a "which fits" table |
| Open source and pricing | `/open-source/` | MIT, what you pay for (your infrastructure and time), the licence, extension points, contributing, support "coming soon" |

The header nav reads Product, Insurance, Architecture, Security, Performance, Compare,
Pricing, Docs; "Security & governance" is shortened there to fit, and keeps its full name in
the footer. The site is English only; a French site is deferred.

## Section outline

- **Home:** night hero with blueprint grid and the overlay editor in the ear tray → product
  tour slot → four figures with provenance → three pillars (copy, checks, a limit, proof,
  cropped screenshot) → reference architecture → six review-board questions → six jobs →
  where necodoc stops → four self-serve steps.
- **Insurance:** hero with the four roles involved → six job blocks (copy and a
  how/limit/proof list beside a screenshot or figure) → CTA band.
- **Architecture:** hero with page TOC → diagram (SVG download) → components table →
  deployment cards → sync/async/batch sequences and the worked curl → data-flow table →
  scaling figures and behaviours → observability → known limits → CTA band.
- **Security:** hero → AI callout → controls table → audit screenshots and the
  tamper-resistance limit → change control → output/privacy/signatures → Canadian table →
  what we don't claim.
- **Performance:** hero with provenance → latency chart and table → throughput chart and
  table → cold start and archival → generation log in production → caveats and environment
  → rerun commands.

## Design rationale

- **Cobalt, quieter.** Same tokens and fonts as the app ([ADR 0042](../../docs/adrs/0042-cobalt-design-system-with-bricolage-figtree-and-phosphor.md)),
  but white paper instead of lavender, hairline rules instead of card stacks, and
  Fragment Mono eyebrows. It reads like an architecture document, which is what this
  reader trusts. No gradient blobs, stock art, logos or testimonials.
- **One texture.** A faint blueprint grid on the night hero and page heroes, a nod to the
  drawing the architect will check. It's the only decoration.
- **Marigold means "do this next".** Only the primary CTA ("Run it in 10 minutes") and the
  focus ring use it, as in the app.
- **Ears once per page at most.** Only the home hero's screenshot tray wears them, the way
  the app's PDF tray does.
- **Limits beside claims.** Every pillar and job carries a limit box and proof links to the
  spec. Each page ends with what necodoc doesn't do.
- **Numbers are imported, never typed.** [bench.ts](../../apps/web/src/lib/bench.ts)
  parses the W2 JSON with its zod schema, so a schema change fails the build. A missing file
  renders dashed `{bench.…}` placeholders. A quick or dirty-tree run shows a warning beside
  the numbers (the current run is dirty-tree, so the warning shows).
- **Light only.** Enterprise vendor sites are overwhelmingly light, the screenshots are
  light, pages get printed and pasted into review decks, and one theme halves the QA. The
  night bands give enough contrast. Revisit if the docs site goes dark-first.
- **Self-hosted assets.** Fontsource for fonts, Phosphor SVGs inlined at build time, images
  through `astro:assets` (WebP, responsive widths). Nothing loads from a CDN.
- **Reel slot.** [Reel.astro](../../apps/web/src/components/Reel.astro) shows a poster and
  the chapter list. It never autoplays; the video loads muted with captions on click. With
  no video yet it says "Video coming soon" instead of a dead play button. Reduced motion
  needs nothing extra because nothing moves until asked.

## Screenshots

Every image in [apps/web/src/assets/screens](../../apps/web/src/assets/screens) and
[apps/reel/public/screens](../../apps/reel/public/screens) is captured by `pnpm demo:screens`
from the seeded demo instance and not edited afterwards
([Demo data and screenshots](../../docs/features/demo-data-and-screenshots.md)). Workspace
"Harbour Surety" and its people are fictional. Retake them after UI changes, before a release.
`bond-page.png` (the fixture's page 1) and the reel's `bond-boxes.json` aren't app screenshots
and stay as they are.

## Decisions (Mike, 2026-10-12)

- **Support.** The site says "coming soon" and nothing more.
- **French.** No French site for now; the header switch and `/fr/` are gone. The bilingual
  certificate example stays (it shows a product feature) and still needs review by a fluent
  Québec speaker.
- **Review pack.** Generated on each release (W8, NECO-syjjmvla). Every link uses
  `links.reviewPack` in [links.ts](../../apps/web/src/lib/links.ts)
  (`/review-pack/necodoc-architecture-review.pdf`), which 404s until W8 ships.
- **"Run it in 10 minutes"** stays; it still needs the timed clean-machine run before launch.
- **Missing pages.** Product, Compare and Open source and pricing were W9; built.
- **Benchmark.** Laptop numbers on Home are fine, labelled with the hardware.
- **Named core systems.** Guidewire and Duck Creek aren't mentioned for now; copy says
  "your policy admin system" or "core systems".

## Open questions

1. **Docs domain.** Docs links use `DOCS_URL` (default the local devdocs port).
2. **Benchmark.** Rerun on a clean commit so the dirty-tree warning goes away.
