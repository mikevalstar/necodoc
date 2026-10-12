---
title: Hosting these docs
description: Build the developer docs as static files and serve them next to your deployment, so your integrators read docs that match your version.
sidebar:
  order: 12
---

This site is plain static HTML (Astro Starlight, with Pagefind search built in). Serving your own copy gives your integrators an API reference and SDK pages that match the necodoc version you run.

## Build

From a checkout of the necodoc repository at your version, with Node 24 and pnpm:

```sh
pnpm install
DEVDOCS_SITE=https://docs.necodoc.example.com pnpm --filter @necodoc/devdocs build
```

The output is in `apps/devdocs/dist`. The build writes the API reference from the API's code; it doesn't need a database or a running API. `DEVDOCS_SITE` is optional: the public URL, for the sitemap and canonical links.

## Serve

Any static host works: nginx, Apache, an S3 or Azure Blob static website, an internal web server. Serve `dist` at the root of a host name (the site doesn't support a sub-path). Pages are `directory/index.html`, which every static server resolves.

Or build the `docs` image, nginx serving the same files on port 8080, like the other necodoc images:

```sh
docker build --target docs --build-arg DEVDOCS_SITE=https://docs.necodoc.example.com -t necodoc-docs .
docker run -p 8080:8080 necodoc-docs
```

The Helm chart and Compose file don't run it; add it as one more Deployment or service if you want it beside the app.

## Preview locally

`pnpm --filter @necodoc/devdocs dev` serves the docs with live reload on port 4322; `pnpm --filter @necodoc/devdocs preview` serves a finished build there.
