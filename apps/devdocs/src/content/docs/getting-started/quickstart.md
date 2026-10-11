---
title: Quickstart
description: Run necodoc locally with Docker Compose, create the admin account and render a first PDF.
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

## 4. Render a PDF with curl

The app's own API takes a session cookie. Sign in and keep the cookie:

```sh
curl -c cookies.txt -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8080' \
  -d '{"email":"admin@example.com","password":"your-password"}' \
  http://localhost:8080/api/auth/sign-in/email
```

Then render:

```sh
curl -b cookies.txt -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8080' \
  -d '{"html":"<h1>Hello {{ name }}</h1>","data":{"name":"world"}}' \
  -o hello.pdf -D - \
  http://localhost:8080/api/render
```

The response headers include `X-Generation-Id` and `X-Page-Count`.

:::caution
`/api/render` is the app's internal, session-authenticated API. The public API, with API keys under `/api/v1`, is coming; paths and payloads may change. See [HTML to PDF](/guides/html-to-pdf/).
:::

## Next

- [Templates and Liquid](/guides/templates-and-liquid/): build a template with fields and a guided form.
- [Headers, footers and page tokens](/guides/headers-footers/).
- [Roles and scaling](/self-hosting/roles-and-scaling/): add workers.
