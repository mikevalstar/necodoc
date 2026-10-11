---
title: Introduction
description: What necodoc is and what it does.
sidebar:
  order: 1
---

necodoc turns answers into finished PDFs. Template authors design a document once; the people who fill it answer a guided form, and necodoc renders the PDF.

It does three things:

- **Templates and guided forms.** Authors build a document in a visual editor (or in HTML and [Liquid](/guides/templates-and-liquid/)) and declare its fields. necodoc generates a step-by-step form from those fields, validates the answers, and renders the document with them.
- **HTML to PDF.** Any HTML with CSS, a theme, header and footer bands and Liquid data renders to PDF with the same renderer the templates use, so a preview matches the output. See [HTML to PDF](/guides/html-to-pdf/).
- **Volume.** Renders run as queued jobs on worker processes you scale out. One template can generate thousands of documents from a JSON array or a CSV file. See [Batches and async renders](/guides/batches-and-async/).

Every render is recorded in the [generation log](/guides/generation-log/) with its input, timings and output.

## Self-hosted

necodoc runs on your infrastructure: a Postgres database, the API and worker processes, and a static web app. Generated PDFs go to local disk, an S3-compatible bucket or Azure Blob storage. See [Self-hosting](/self-hosting/).

## How it renders

The renderer is headless Chromium. Rendered pages can't reach the network: images and fonts come from necodoc's own [asset library](/guides/themes-and-assets/), or from `data:` URLs. Headers and footers are rendered separately and stamped onto each page, so they can be full HTML with page numbers and a different first page. See [Headers, footers and page tokens](/guides/headers-footers/).

Next: [Concepts](/getting-started/concepts/), or go straight to the [Quickstart](/getting-started/quickstart/).
