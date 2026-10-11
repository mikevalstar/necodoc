---
title: Quickstart
description: Run necodoc locally with Docker Compose, create the admin account and an API key, and render a first PDF.
sidebar:
  order: 3
---

This runs the whole stack on one machine: Postgres, the API, one render worker and the web app. For production setups, see [Self-hosting](/self-hosting/).

## 1. Start the stack

Follow [Docker Compose](/self-hosting/docker-compose/): copy the example env file, set `BETTER_AUTH_SECRET` (32 or more random characters), and run `docker compose up -d`. The examples below assume the app is on `http://localhost:8080`; use whatever host port you configured.

## 2. Create the admin account

Open the app and sign up. The first account becomes an admin.

Anyone who signs up after that has no roles, so they can sign in but do nothing until an admin grants a role under Admin > Users. See [Concepts: roles](/getting-started/concepts/#roles).

## 3. Render a PDF in the app

Open **Render**. It takes the same request the API does, field by field: HTML, CSS, theme, header and footer, page options and Liquid data. Preview mode renders without logging. Rendering for real logs a generation you can find under **Generations**.

## 4. Create an API key

Under **Settings › API keys**, create a key with the `render:html` scope. Copy the secret (it starts with `nd_`); it's shown once. For a system rather than a person, an admin can create a service account under **Admin › Service accounts** and give the key to it instead. See [API keys and errors](/guides/api-keys/).

## 5. Render a PDF with curl

```sh
export NECODOC_API_KEY=nd_...
curl -H "x-api-key: $NECODOC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"html":"<h1>Hello {{ name }}</h1>","data":{"name":"world"}}' \
  -o hello.pdf -D - \
  http://localhost:8080/api/v1/render
```

The response headers include `X-Generation-Id` and `X-Page-Count`, and the render shows under **Generations** with your key's name. Add `"response":"json"` to get the generation id and a download link instead of the bytes. See [HTML to PDF](/guides/html-to-pdf/).

The app's **API** page lists every endpoint and can send requests with your key.

## Next

- [Templates and Liquid](/guides/templates-and-liquid/): build a template with fields and a guided form.
- [Headers, footers and page tokens](/guides/headers-footers/).
- [Roles and scaling](/self-hosting/roles-and-scaling/): add workers.
