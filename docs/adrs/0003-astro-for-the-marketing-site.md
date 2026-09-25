---
type: adr
title: Astro for the marketing site
description: The public site is a static Astro build kept separate from the app.
tags: [architecture, frontend, web]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Astro for the marketing site

## Status

Accepted.

## Context

The public site is mostly static content: what necodoc is, pricing, docs. It
wants fast pages and good SEO, and it has none of the app's needs (auth, forms,
API calls). Building it inside the SPA would tie its deploys to the app's
and ship the app's JavaScript to visitors who never sign in.

## Decision

[apps/web](../../apps/web) is a standard Astro site built to static HTML, styled
with Tailwind. It shares no code with the app for now: no shared UI package
until the site actually needs an app component.

## Consequences

The site deploys anywhere static files can be hosted, independently of the app.
If the site and app need to look alike, the styles will be duplicated until a
shared package is worth creating.
