---
title: Configuration
description: Every environment variable the necodoc images read, with defaults.
sidebar:
  order: 4
---

The API and worker read their configuration from the environment and validate it at start ([`apps/api/src/env.ts`](https://github.com/mikevalstar/necodoc/blob/main/apps/api/src/env.ts), [`storage/config.ts`](https://github.com/mikevalstar/necodoc/blob/main/apps/api/src/storage/config.ts)). An invalid or missing value stops the process with an error naming the variable.

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres connection URL. |
| `BETTER_AUTH_SECRET` | required | At least 32 characters. Signs sessions. Changing it signs everyone out, and voids download links unless `DOWNLOAD_SIGNING_SECRET` is set. |
| `BETTER_AUTH_URL` | required | The public URL people open, e.g. `https://necodoc.example.com`. The app and `/api` must be served from it. |
| `PORT` | `3000` | HTTP port. Workers listen too, for health checks. |
| `ROLE` | `all` | `api` serves HTTP and enqueues renders; `worker` renders queued jobs; `all` does both. See [Roles and scaling](/self-hosting/roles-and-scaling/). |
| `RENDER_CONCURRENCY` | `2` | Render jobs one worker process runs at once (1–32). |
| `RENDER_WAIT_MS` | `30000` | How long a synchronous render call waits for its job before answering `202` with the generation id. |
| `PREVIEW_CONCURRENCY` | `2` | Live previews one API process renders at once (1–32). Previews skip the queue. |
| `APP_VERSION` | `dev` | Reported in worker heartbeats, to spot mixed versions mid-deploy. The image sets it from the `APP_VERSION` build arg; the chart sets it from the image tag. |
| `DOWNLOAD_SIGNING_SECRET` | `BETTER_AUTH_SECRET` | At least 32 characters. Signs download links. Changing it voids live links. |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy: the client address is the last `X-Forwarded-For` hop. Used by API key IP allowlists, share-link rate limits and trusted-header SSO. Leave it off when clients can reach the API directly, or they can spoof their address. |
| `WEBHOOK_ALLOW_LOCALHOST` | `false` | Development only. `true` lets [webhooks](/guides/webhooks/) use `http://` and loopback URLs, for a receiver on the same machine. Never set it in production. |
| `STORAGE_REDIRECT` | `off` | `presigned` answers downloads with a redirect to a short-lived S3 presigned URL or Azure SAS instead of streaming through the API. Browsers must reach the bucket. |

## Sign-in

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_PASSWORD_ENABLED` | `true` | `false` hides and refuses email/password sign-in and registration. Needs at least one SSO provider. |
| `SSO_PROVIDERS` | none | Comma-separated SSO provider ids. Each reads `SSO_<ID>_*`: `TYPE` (`oidc`, `saml`, `header`), `LABEL`, `ROLE_MAP`, `DEFAULT_ROLES`, `LINK_EXISTING`, `EMAIL_DOMAINS`, plus the protocol's settings. Full list and IdP guides: [Single sign-on](/self-hosting/sso/). |

## Storage

| Variable | Default | Description |
| --- | --- | --- |
| `STORAGE_DRIVER` | `disk` | `disk`, `s3` or `azure`. See [Storage](/self-hosting/storage/). |
| `STORAGE_DIR` | `/data/files` in the image | `disk`: where outputs are written. Relative paths resolve from the working directory. |
| `STORAGE_PREFIX` | none | `s3`, `azure`: key prefix, e.g. `necodoc/outputs`. |
| `S3_BUCKET` | required for `s3` | Bucket name. |
| `S3_REGION` | `us-east-1` | Region. Cloudflare R2 uses `auto`. |
| `S3_ENDPOINT` | none | For MinIO, R2 and other S3-compatible stores. Leave unset for AWS. |
| `S3_FORCE_PATH_STYLE` | `false` | `true` for MinIO and most self-hosted stores. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | none | Static keys; set both or neither. Unset uses the AWS default credential chain (env, profile, IAM role). |
| `S3_SESSION_TOKEN` | none | With temporary keys. |
| `S3_SSE` | none | `AES256` or `aws:kms` server-side encryption. |
| `S3_KMS_KEY_ID` | none | With `S3_SSE=aws:kms`; unset uses the AWS-managed key. |
| `AZURE_STORAGE_CONTAINER` | required for `azure` | Container name. |
| `AZURE_STORAGE_CONNECTION_STRING` | none | One way to authenticate. |
| `AZURE_STORAGE_ACCOUNT` | none | Account name. With `AZURE_STORAGE_KEY`, shared-key auth; alone, `DefaultAzureCredential` (managed or workload identity). |
| `AZURE_STORAGE_KEY` | none | Account key. |
| `AZURE_STORAGE_ACCOUNT_URL` | `https://<account>.blob.core.windows.net` | Override for sovereign clouds or Azurite. |

Blank values (`S3_ENDPOINT=`) count as unset.

## Image only

| Variable | Image | Description |
| --- | --- | --- |
| `MIGRATE_ON_START` | `necodoc-api` | `true` runs migrations before the server starts. Off by default; for single-container installs only, because several replicas would race. |
| `API_URL` | `necodoc-app` | Where the app's nginx proxies `/api`. Default `http://api:3000`. nginx doesn't use DNS search domains, so on Kubernetes use the Service's full name (the chart does). |

The `necodoc-api` image's command is one of `serve` (default), `migrate` or `storage-migrate`. Anything else runs as a plain command.

## Proxies and load balancers

Anything in front of the app or API must:

- Serve the app and `/api` on the same origin, the one in `BETTER_AUTH_URL`.
- Allow request bodies of 25 MB. Uploads and request bodies are capped at 20 MB, plus multipart overhead.
- Allow upstream reads of at least `RENDER_WAIT_MS` plus a margin (the app image uses 120 seconds).
- Pass the `Origin` header through unchanged. Auth requests from another origin are rejected.
