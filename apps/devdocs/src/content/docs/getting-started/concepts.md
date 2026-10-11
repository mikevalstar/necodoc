---
title: Concepts
description: The objects necodoc works with, and how they relate.
sidebar:
  order: 2
---

## Templates

A **template** is a document design plus the fields it needs. Designed templates are edited in a visual editor or, after a one-way conversion, as HTML and Liquid (code mode). Each template has a page setup (Letter, A4 or Legal; portrait or landscape; margins), an optional header and footer, a theme, template CSS, and sample data for previews.

PDF overlay templates (filling an existing PDF) are coming.

## Fields and the guided form

A template declares **fields**, grouped into **sections**. Types: text, long text, number, date, boolean, choice (single or multiple), email, image, signature, and repeating group. Fields carry validation (required, lengths, patterns, ranges, item counts) and optional show-if conditions.

The same definition drives the guided form in the app, the validation of every generation, and the JSON Schema export. See [Templates and Liquid](/guides/templates-and-liquid/).

## Drafts, versions and publishing

Every template has one **draft** and zero or more published **versions** (1, 2, 3...). Publishing snapshots everything a render needs, including the compiled HTML and the theme's CSS, so later edits don't change a published version. Generating without a version number uses the latest published version. Templates with published versions can be archived, not deleted.

## Themes

A **theme** sets fonts, sizes, colours and table styles, plus free CSS. It applies to a template's body and bands, and to HTML renders that name it. Built-in starters can be copied but not edited. See [Themes and assets](/guides/themes-and-assets/).

## Assets

**Assets** are uploaded images (PNG, JPEG, SVG, WebP) and fonts (TTF, OTF, WOFF2), up to 20 MB each. Templates reference them by id, and the renderer serves them in-process.

## Generations

A **generation** is one logged render: its source (app, API, share link, combine, re-run, batch), status, input, timings, worker, attempts and output PDF. Live previews are not logged. See [Generation log](/guides/generation-log/).

## Batches

A **batch** generates many documents from one published template version: one data object per row, from JSON or CSV. Each row is its own generation. See [Batches and async renders](/guides/batches-and-async/).

## Queue and workers

Every logged render is a job on a queue in Postgres (pg-boss). **Worker** processes take jobs and render them in Chromium. **API** processes serve HTTP and enqueue. A synchronous call waits for its job and returns the PDF; if the job takes too long, it answers `202` with the generation id instead. One image runs either role, chosen by `ROLE`. See [Roles and scaling](/self-hosting/roles-and-scaling/).

## Storage

Generated PDFs are written to the configured storage driver: local disk, an S3-compatible bucket, or Azure Blob. Templates, themes, assets and uploads stay in Postgres. See [Storage](/self-hosting/storage/).

## Roles

Users hold one or more roles; permissions add up across them.

| Role | Can |
| --- | --- |
| `viewer` | List and fill published templates, render, see own generations |
| `editor` | Viewer, plus create templates, themes and assets, and edit drafts |
| `reviewer` | Viewer, plus open drafts and their previews without changing them |
| `publisher` | Viewer, plus publish, archive and restore templates |
| `admin` | Everything, plus user management, every user's generations, and system settings |

The first account to sign up becomes an admin. Later sign-ups have no roles until an admin grants some.
