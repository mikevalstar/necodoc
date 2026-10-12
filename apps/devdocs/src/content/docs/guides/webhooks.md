---
title: Webhooks
description: Signed HTTPS callbacks when generations and batches finish, with retries, a delivery log and signature verification.
sidebar:
  order: 7
---

A webhook is a URL necodoc POSTs to when a PDF is ready, so your systems don't have to poll.

## Where they're set

A webhook belongs to an account: you, or a service account. It fires for:

- **one API key**: generations made with that key
- **the whole account**: every generation made with any of its keys
- **a template**: every generation of that template, from any source, the app included (needs the editor role)

A key or template webhook can also be narrowed to the other. Create your own under **Developers › API keys**; admins create service accounts' under **Admin › Service accounts**. Each webhook row's menu has **Deliveries** (the delivery log) and **Send test**.

## Events

| Event | When |
| --- | --- |
| `generation.succeeded` | A generation finished with a PDF. |
| `generation.failed` | A generation failed (Liquid error, timeout, lost worker). |
| `batch.completed` | A batch's last row finished, or it was cancelled. Fires once. |
| `webhook.test` | Sent by **Send test**. |

Batch rows don't fire generation events; subscribe to `batch.completed` instead.

## Payload

```json
{
  "id": "0b9d3c8e-6f62-4c5d-9a8e-2f1d6c0e7a41",
  "event": "generation.succeeded",
  "createdAt": "2026-10-11T22:41:03.401Z",
  "data": {
    "generation": {
      "id": "236cb0c5-8d19-4b85-a665-34aa8c53d240",
      "status": "success",
      "source": "api",
      "userId": "5524b4bf-b5b9-417b-bd28-71e766d188b6",
      "apiKeyId": "Q7visdtOPPZjwC1U7gIQOovCwJkUtqiU",
      "templateId": "c85d5621-51bf-4288-bbac-df1a422f7055",
      "templateVersionId": "ef081721-f0fd-4d0a-95ee-05ecd180abd3",
      "version": 2,
      "batchId": null,
      "filename": "Curl quote.pdf",
      "pageCount": 2,
      "size": 25968,
      "error": null,
      "requestId": "149edad3-d657-4fc9-ac03-3a155f93e4bf",
      "finishedAt": "2026-10-11T22:41:03.390Z",
      "downloadUrl": "https://necodoc.example.com/api/files/signed/...",
      "pdfPath": "/api/v1/generations/236cb0c5-8d19-4b85-a665-34aa8c53d240/pdf"
    }
  }
}
```

- `id` is the delivery id, also sent as `Necodoc-Delivery`. Use it to ignore duplicates.
- `downloadUrl` (successful generations only) is a signed link that works without a key for 24 hours. `pdfPath` works with a key.
- HTML renders have no template fields (`null`). PDF bytes are never included.

`batch.completed` sends `data.batch`: `id`, `status` (`completed` or `cancelled`), `templateId`, `templateVersionId`, `templateName`, `version`, `total`, `done`, `failed`, `cancelled`, `apiKeyId`, `requestId`, `createdAt`, `completedAt`, `zipPath` and `packetPath`.

## Headers

| Header | Value |
| --- | --- |
| `Necodoc-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` |
| `Necodoc-Event` | The event name. |
| `Necodoc-Delivery` | The delivery id. |
| `Content-Type` | `application/json` |
| `User-Agent` | `necodoc-webhooks/1` |

## Verifying the signature

Each webhook has a secret (`whsec_…`), shown once when it's created. To verify a request:

1. Read the raw body, before any JSON parsing.
2. Split `Necodoc-Signature` into `t` and `v1`.
3. Compute HMAC-SHA256 of `` `${t}.${body}` `` with the secret, as hex.
4. Compare it to `v1` in constant time.
5. Reject timestamps more than 5 minutes from now, so a captured request can't be replayed later.

Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyNecodoc(rawBody, header, secret, toleranceSeconds = 300) {
  const t = /(?:^|,)t=(\d+)/.exec(header ?? "")?.[1];
  const v1 = /(?:^|,)v1=([0-9a-f]+)/.exec(header ?? "")?.[1];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Express: app.post("/hooks/necodoc", express.raw({ type: "application/json" }), (req, res) => {
//   if (!verifyNecodoc(req.body.toString("utf8"), req.get("Necodoc-Signature"), SECRET)) {
//     return res.sendStatus(401);
//   }
//   res.sendStatus(200);
// });
```

Python:

```python
import hashlib
import hmac
import re
import time

def verify_necodoc(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    t = re.search(r"(?:^|,)t=(\d+)", header or "")
    v1 = re.search(r"(?:^|,)v1=([0-9a-f]+)", header or "")
    if not t or not v1:
        return False
    if abs(time.time() - int(t.group(1))) > tolerance:
        return False
    signed = t.group(1).encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1.group(1))
```

Answer with any `2xx` quickly and do slow work afterwards; the request times out after 10 seconds.

## Delivery and retries

- Deliveries run on the job queue, so they survive restarts.
- A non-2xx answer, a timeout or a connection error is retried 5 times with exponential backoff: the first retry comes 10 to 20 seconds later, the last 160 to 320 seconds after the one before. A delivery gives up 5 to 10 minutes after the first attempt.
- Redirects aren't followed; a `3xx` counts as a failure.
- The delivery log shows each delivery's status (pending, success, failed) and every attempt with its response code, time and error.
- Order isn't guaranteed, and a delivery can arrive twice if a worker dies mid-send. Deduplicate on the delivery id.
- A disabled webhook stops receiving; pending deliveries fail.

## Where they may point

- HTTPS only.
- The host must resolve only to public addresses. Private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback, link-local (including `169.254.169.254`), CGNAT, IPv6 unique-local and other reserved ranges are refused when the webhook is saved and again before every send. The request goes to the address that was checked, so a DNS change between the check and the send can't redirect it.

For a receiver on your own machine during development, set `WEBHOOK_ALLOW_LOCALHOST=true` on the API and worker processes. It allows `http://` and loopback URLs (not other private ranges). It's off by default; never set it in production. See [Configuration](/self-hosting/configuration/).

## Limits

- The secret can't be shown again or rolled. Delete the webhook and create a new one.
- Old events can't be redelivered by hand; re-run the generation instead.
- App generations (not made with a key) fire only template webhooks.
