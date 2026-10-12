---
type: adr
title: Remotion for the product tour reel
description: The home page product tour is a Remotion project in this repo (apps/reel), rendered to MP4, WebM, a poster and captions from real app screenshots and the benchmark JSON. Remotion's own licence applies to that package only.
tags: [architecture, marketing, web]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T13:58:20Z }
---

# Remotion for the product tour reel

## Status

Accepted. Serves the [Product tour reel](../features/product-tour-reel.md) on the
[marketing site](../features/marketing-site.md) ([ADR 0003](0003-astro-for-the-marketing-site.md)).

## Context

The home page needs a short product tour. A screen recording goes stale every
time the UI changes and can't show benchmark numbers without someone typing
them in. A hand-edited video in a desktop tool can't be rebuilt by anyone else.
The tour has to be rebuilt after UI changes and new benchmark runs, by whoever
is on the repo.

## Decision

- **Remotion** in a workspace package, [apps/reel](../../apps/reel/README.md):
  the video is React code, so scenes reuse Cobalt tokens and fonts and import
  [the benchmark results](../../scripts/bench/results/latest.json) directly,
  the same way the site does ([Performance benchmark](../features/performance-benchmark.md)).
- Scenes are built from real app screenshots (captured from the dev app) with
  pans, zooms, highlight boxes and a cursor, plus small Cobalt recreations
  where a screenshot can't carry the point (timings, worker scaling).
- One render script writes the site's files (MP4, WebM, poster, captions) into
  `apps/web/public/reel`; the outputs are committed so the site build doesn't
  need Chromium or Remotion.
- It stays in this repo (Mike, NECO-snldinrq).

## Consequences

- Remotion isn't MIT. Individuals and companies with up to 3 employees use it
  free; larger for-profit companies need a company licence
  ([remotion.pro](https://www.remotion.pro/license)). That only matters to
  someone re-rendering the reel; nothing ships to customers. The licence note
  lives in the [apps/reel README](../../apps/reel/README.md); the rest of the
  repo stays MIT.
- Re-rendering takes a few minutes of local Chromium; the rendered files are
  binaries in git, kept small (MP4 under 8 MB).
- Screenshots go stale with UI changes; recapturing them is a manual step.
