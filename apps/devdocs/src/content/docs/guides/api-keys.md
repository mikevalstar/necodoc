---
title: API keys and errors
description: Personal keys and service accounts, scopes, rotation, IP allowlists, rate limits, and the error codes /api/v1 answers with.
sidebar:
  order: 0
---

The public API lives under `/api/v1` and takes only API keys, sent in the `x-api-key` header. Session cookies don't work there, and keys don't work on the app's own `/api` routes.

```sh
curl -H "x-api-key: $NECODOC_API_KEY" https://necodoc.example.com/api/v1/templates
```

Every response carries `X-Request-Id`. Send your own (letters, digits, `.`, `:`, `_`, `-`, up to 128 characters) to trace a call across systems; it's recorded on the generation.

## Personal keys and service accounts

- **Personal keys** belong to you and act as you. Create them under **Settings › API keys**. Any user with a role can.
- **Service accounts** are identities for systems: a billing integration, a nightly job. They have a name, a description, an owner contact and roles, and can't sign in. Admins create them under **Admin › Service accounts** and manage their keys there. Keys on a service account keep working when the person who made them leaves.

Disabling a service account, or banning a user, stops all their keys at once. Admins see every key under **Admin › API keys**, with usage and a link to the generations each one made.

## Creating a key

A key has:

- a **name**, shown in lists and in the generation log
- **scopes** (below)
- an optional **expiry**, in days
- an optional list of **templates** it may use; empty means every template its owner can see
- an optional **IP allowlist** of addresses and CIDR ranges (`203.0.113.7`, `198.51.100.0/24`, `2001:db8::/32`); empty means any address
- a **rate limit** in requests per minute (default 120)

The secret starts with `nd_` and is shown once. Store it in your secret manager; a lost key is replaced, not recovered. Lists show its first characters, when it was created and last used (and from where), its total requests, and a warning when it expires within 14 days.

Scopes and the other settings are fixed when the key is made. To change them, rotate or make a new key.

## Scopes

| Scope | Allows |
| --- | --- |
| `render:html` | `POST /render` |
| `templates:read` | `GET /templates`, `GET /templates/:id`, `GET /templates/:id/versions/:version/schema` |
| `templates:generate` | `POST /templates/:id/versions/:version/generate` |
| `batches:write` | `POST /templates/:id/versions/:version/batch` |
| `batches:read` | `GET /batches/:id`, `.../zip`, `.../packet` |
| `generations:read` | `GET /generations/:id`, `.../pdf`, `POST .../link` |
| `combine:write` | `POST /combine` |

Every scope needs its owner to hold a role with `document: view` (all roles do). A key is checked against its owner's roles on every call, so removing someone's roles stops their keys too.

A key reads only its owner's own generations and batches.

## Rotating a key

**Rotate** makes a replacement with the same settings and shows its secret once. The old key keeps working for an overlap window (24 hours by default, up to 30 days), then expires. Deploy the new secret within the window. Rotating with an overlap of 0 stops the old key at once.

**Revoke** stops a key immediately. Revoked and expired keys stay listed, so the generation log still names them.

## Rate limits

Each key allows its number of requests per minute. Past that, calls answer `429` with `Retry-After` (seconds). The count resets once a full minute has passed since the key's last allowed request, so a client that keeps retrying inside the window stays blocked; wait out `Retry-After`.

## Errors

Errors are JSON:

```json
{ "error": "This key needs the templates:read scope", "code": "missing_scope" }
```

Invalid input adds `fieldErrors` (field path → messages). A failed render adds the `generationId` of the logged failure.

| Status | `code` | Meaning |
| --- | --- | --- |
| 401 | `missing_key` | No `x-api-key` header. |
| 401 | `invalid_key` | Unknown key. |
| 401 | `key_revoked` | The key was revoked. |
| 401 | `key_expired` | The key expired (or its rotation overlap ended). |
| 401 | `owner_disabled` | The key's user is banned or its service account is disabled. |
| 403 | `ip_not_allowed` | The caller's address isn't on the key's allowlist. |
| 403 | `missing_scope` | The key lacks the scope this call needs. |
| 403 | `owner_forbidden` | The owner no longer has a role that allows it. |
| 403 | `template_not_allowed` | The key is limited to other templates. |
| 404 | `not_found` | No such template, version, batch or generation, or it isn't the owner's. |
| 409 | `template_archived` | The template is archived. |
| 422 | `invalid_request` | The body or path doesn't match the schema. |
| 422 | `invalid_data` | Template data fails the version's fields; see `fieldErrors`. |
| 422 | `invalid_input` | A combine input isn't a PDF or a generation with one. |
| 422 | `render_failed` | The render failed (Liquid error, timeout); see `generationId`. |
| 429 | `rate_limited` | Over the key's rate limit; see `Retry-After`. |

## Behind a proxy

IP allowlists compare the address the API sees. Behind a reverse proxy or load balancer, set `TRUST_PROXY=true` so it reads the client from `X-Forwarded-For` (see [Configuration](/self-hosting/configuration/)). Without it every call appears to come from the proxy.

## The OpenAPI document

Each deployment serves its OpenAPI 3.1 document at `/api/v1/openapi.json`, no key needed. The [API reference](/reference/api/) here, the in-app **API** page and the [SDKs](/reference/sdks/) are generated from it.
