---
title: Webhooks
description: Signed HTTP callbacks when generations finish. Coming.
sidebar:
  order: 7
  badge: { text: Coming, variant: note }
---

:::note[Coming]
Webhooks aren't available yet. Until then, poll `GET /api/generations/:id` (see [Batches and async renders](/guides/batches-and-async/#async-renders)).
:::

Webhooks will let your systems hear about generations without polling. They will be set on an API key (for that key's generations) or on a template (for every generation of it, from any source), and fire on `generation.completed`, `generation.failed` and `submission.created`. Payloads will be JSON with the generation's id, template, status and a download path, never the PDF bytes, and every request will carry an HMAC-SHA256 signature of the body and a timestamp so you can verify it. This page will document the payloads and signature verification when they ship.
