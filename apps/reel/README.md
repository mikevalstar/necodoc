# @necodoc/reel

The product tour on the home page of the marketing site, made with
[Remotion](https://www.remotion.dev). What it shows and why:
[Product tour reel](../../docs/features/product-tour-reel.md); why Remotion:
[ADR 0043](../../docs/adrs/0043-remotion-for-the-product-tour-reel.md).

## Licence

**Remotion is not MIT.** It is free for individuals, for-profit companies with
up to 3 employees, non-profits, and for evaluation. A for-profit company with
more than 3 employees needs a Remotion
[company licence](https://www.remotion.pro/license) to render or edit this
reel. See [Remotion's licence](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).

The code in this folder and the rest of the repository are MIT. Nothing here
ships in necodoc itself; the licence only matters to whoever re-renders the
video.

## Edit

```sh
pnpm --filter @necodoc/reel studio    # Remotion Studio, live preview with a timeline
```

- [src/timeline.ts](src/timeline.ts): scene order, lengths in frames (30 fps)
  and captions. The burned-in captions, the VTT track and the site's chapter
  list all come from here.
- [src/scenes](src/scenes): one file per group of scenes. Screenshot scenes
  use `Screen` from [src/components/screen.tsx](src/components/screen.tsx):
  a camera (`shots`: focus point and zoom over time), `Highlight` and
  `Cursor`, all in the screenshot's 2000x1125 coordinate space.
- [src/bench.ts](src/bench.ts): every number on screen, read from
  [scripts/bench/results/latest.json](../../scripts/bench/results/latest.json).
  Never type a number into a scene.
- [public/screens](public/screens): screenshots of the seeded demo instance,
  1600x900 CSS px saved as 2400 px JPEGs, taken by `pnpm demo:screens` (the list is
  [scripts/demo/src/shots.ts](../../scripts/demo/src/shots.ts); see
  [Demo data and screenshots](../../docs/features/demo-data-and-screenshots.md)). Don't edit
  them by hand. `bond-page.png` is page 1 of
  [the OR CCB bond fixture](../../fixtures/pdfs/surety-bonds/or-ccb-commercial-contractor-bond.pdf)
  at 200 dpi; [bond-boxes.json](src/scenes/bond-boxes.json) is what AI detection proposed for
  it.

## Render

```sh
pnpm --filter @necodoc/reel render                   # concurrency defaults to a third of the cores
pnpm --filter @necodoc/reel render --concurrency 2
```

Writes `necodoc-tour.mp4` (H.264), `.webm` (VP9), `-poster.png`, `.vtt` and
`reel.json` into [apps/web/public/reel](../web/public/reel). The site's
[Reel component](../web/src/components/Reel.astro) picks them up from
`reel.json`. It refuses a quick benchmark run; re-render after a new full
`pnpm bench` so the numbers match the rest of the site. Keep the MP4 under
8 MB (the `crf` values are in [scripts/render.ts](scripts/render.ts)).
