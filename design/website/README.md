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
| Français | `/fr/` | Placeholder until the fr-CA site is written and reviewed |

Product, Compare and Open source and pricing pages from the spec aren't built yet; nothing
links to them, so there are no dead links.

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

Captured from the dev app with seed data, then staged in the browser before capture: test
template names were renamed or hidden, a 29 s outlier row was removed from the generations
log, and the Admin › System figures, hostnames and storage path were replaced with plausible
production values. Workspace "Harbour Surety" and the people are fictional. **Before
launch, retake them from a seeded demo instance** so nothing on the site is edited.

## Open questions for Mike

1. **Support line.** The site says "docs, source and GitHub issues; no paid support plan
   yet". Is that the answer, or is there an offer to name?
2. **Docs domain and FR URL scheme.** Docs links use `DOCS_URL` (default the local devdocs
   port). FR lives under `/fr/` with EN at the root; OK, or a `fr.` subdomain?
3. **Review pack.** Linked from every page but not built. Who writes it, and does it ship
   per release? Until then the links point at `#review-pack`.
4. **"Run it in 10 minutes".** Needs a timed clean-machine run before launch (spec
   acceptance criterion). Keep the wording or say "Run it on a laptop"?
5. **French.** The bilingual certificate example and `/fr/` page need review by a fluent
   Québec speaker.
6. **Missing pages.** Product, Compare (dated competitor rows) and Open source and pricing:
   build next, or fold Compare into Home's "where it stops"?
7. **Benchmark.** Rerun on a clean commit so the dirty-tree warning goes away, and decide
   whether to show laptop numbers on Home or only on Performance.
8. **Guidewire.** A worked PolicyCenter example (or sample plugin) would make the
   Architecture page's worked pattern concrete. Worth a spec?
