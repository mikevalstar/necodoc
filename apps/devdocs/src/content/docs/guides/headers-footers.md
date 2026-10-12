---
title: Headers, footers and page tokens
description: Full-HTML header and footer bands with page numbers and a first-page variant, and how they sit on the page.
sidebar:
  order: 3
---

Headers and footers are **bands**: full HTML and Liquid at a fixed height, rendered for every page and stamped onto it. Unlike Chromium's built-in header templates, bands can use the theme, template CSS, images, fonts and your data.

## A band

```json
{
  "header": {
    "html": "<p>Acme Ltd · {{ client_name }}</p>",
    "firstPageHtml": "<img src=\"{{ logo_id | asset_url }}\" style=\"height: 18mm\">",
    "height": 25
  },
  "footer": {
    "html": "<p style=\"text-align: right\">Page {{ page }} of {{ pages }}</p>",
    "height": 10
  }
}
```

- `html`: the band on every page.
- `firstPageHtml` (optional): the band on page 1 instead, for a letterhead on the first page and a slim header after. An empty string gives page 1 an empty band.
- `height`: millimetres, greater than 0.

In the template editor, each band is its own rich-text document with a height and an optional first-page variant. In code mode, and in [HTML renders](/guides/html-to-pdf/), it's the JSON above.

## Page tokens

Inside a band, two extra variables are set for each page:

- `{{ page }}`: the page number, from 1.
- `{{ pages }}`: the total page count.

The band's Liquid also sees the same `data` as the body. The tokens exist only in bands; the editor flags them in the body. `page` and `pages` are reserved, so no field can use those keys.

## Layout

Page size is Letter (215.9 × 279.4 mm), A4 (210 × 297 mm) or Legal (215.9 × 355.6 mm), portrait or landscape. Margins are millimetres on each side, 20 by default.

Bands sit **inside** the margins, directly against the body:

- The header's top edge is `margins.top` from the top of the page; the body starts below the header.
- The footer's bottom edge is `margins.bottom` from the bottom of the page; the body ends above the footer.
- Bands share the body's left and right margins.

So the body's effective top margin is `margins.top + header.height`, and its bottom margin is `margins.bottom + footer.height`. With A4, margins of 10 mm top and 12 mm bottom, a 25 mm header and an 8 mm footer, the body gets 35 mm at the top and 20 mm at the bottom.

Content taller than the band is clipped at the band's height; it doesn't push the body down. Size the band for its content.

## How it renders

The body renders first, which fixes the page count. Each band then renders as one document with one band-height page per body page, with the page tokens and first-page variant applied, and is stamped onto the body pages. A render with both bands takes three Chromium passes, one after another on the same page. The time shows up as "bands" in the [generation's timings](/guides/generation-log/#timings).
