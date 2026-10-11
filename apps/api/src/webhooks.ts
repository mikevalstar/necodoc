import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  WEBHOOK_TEST_EVENT,
  type WebhookAttempt,
  type WebhookDeliveryStatus,
  type WebhookEvent,
} from "@necodoc/shared";
import { and, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { isAllowedAddress } from "./addresses";
import { db } from "./db";
import { batch, generation, templateVersion, webhook, webhookDelivery } from "./db/schema";
import { mintLink } from "./download";
import { env } from "./env";
import type { Tx } from "./generate";
import { boss, queues } from "./queue";
import { signatureHeader, type WebhookSubject, webhookMatches } from "./webhook-rules";

// Spec: docs/features/webhooks.md. Events are queued in the transaction that finishes the
// generation; each delivery is a pg-boss job that POSTs once and throws to be retried.

// ---------------------------------------------------------------------------------------------
// Where a webhook may point (the address rules are in addresses.ts)

export type WebhookTarget = { url: URL; address: string; family: 4 | 6 };

/**
 * Parses and resolves a webhook URL, refusing non-HTTPS and any host with a non-public address.
 * Run on save and again before every POST, which then connects to the address checked here.
 */
export async function resolveWebhookUrl(
  raw: string,
): Promise<{ ok: true; target: WebhookTarget } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Not a URL" };
  }
  const insecureOk = env.WEBHOOK_ALLOW_LOCALHOST && url.protocol === "http:";
  if (url.protocol !== "https:" && !insecureOk) {
    return { ok: false, error: "Webhook URLs must use https://" };
  }
  if (url.username || url.password)
    return { ok: false, error: "Put credentials in the secret, not the URL" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: `Couldn't resolve ${host}` };
  }
  // Every address must pass: a host with one public and one private address could be either.
  const refused = addresses.find((a) => !isAllowedAddress(a.address, env.WEBHOOK_ALLOW_LOCALHOST));
  if (refused || !addresses[0]) {
    return { ok: false, error: `${host} resolves to a private or reserved address` };
  }
  const { address, family } = addresses[0];
  return { ok: true, target: { url, address, family: family === 6 ? 6 : 4 } };
}

// ---------------------------------------------------------------------------------------------
// Signing

// ---------------------------------------------------------------------------------------------
// Which webhooks an event goes to (webhookMatches, in webhook-rules.ts)

async function subscribers(tx: Tx, event: WebhookEvent, subject: WebhookSubject) {
  const candidates = await tx
    .select({
      id: webhook.id,
      ownerId: webhook.ownerId,
      apiKeyId: webhook.apiKeyId,
      templateId: webhook.templateId,
    })
    .from(webhook)
    .where(
      and(
        eq(webhook.enabled, true),
        sql`${webhook.events} ? ${event}`,
        or(
          subject.apiKeyId ? eq(webhook.apiKeyId, subject.apiKeyId) : undefined,
          subject.templateId ? eq(webhook.templateId, subject.templateId) : undefined,
          subject.userId ? eq(webhook.ownerId, subject.userId) : undefined,
        ),
      ),
    );
  return candidates.filter((w) => webhookMatches(w, subject));
}

/** One delivery row and job per webhook, in the caller's transaction. */
async function queueDeliveries(
  tx: Tx,
  webhookIds: string[],
  event: string,
  data: Record<string, unknown>,
  refs: { generationId?: string; batchId?: string } = {},
) {
  if (!webhookIds.length) return;
  const createdAt = new Date().toISOString();
  const rows = webhookIds.map((webhookId) => {
    const id = randomUUID();
    return { id, webhookId, event, payload: { id, event, createdAt, data }, ...refs };
  });
  await tx.insert(webhookDelivery).values(rows);
  await boss.insert(
    queues.webhook,
    rows.map((row) => ({ data: { deliveryId: row.id } })),
    { db: fromDrizzle(tx, sql) },
  );
}

const DOWNLOAD_LINK_SECONDS = 24 * 60 * 60;

/** generation.succeeded / generation.failed for a finished generation. Batch rows don't fire. */
export async function queueGenerationEvents(tx: Tx, generationId: string) {
  const [g] = await tx
    .select({
      id: generation.id,
      status: generation.status,
      source: generation.source,
      userId: generation.userId,
      apiKeyId: generation.apiKeyId,
      templateId: generation.templateId,
      templateVersionId: generation.templateVersionId,
      version: templateVersion.version,
      batchId: generation.batchId,
      filename: generation.filename,
      pageCount: generation.pageCount,
      size: generation.size,
      error: generation.error,
      requestId: generation.requestId,
      outputFileId: generation.outputFileId,
      finishedAt: generation.finishedAt,
    })
    .from(generation)
    .leftJoin(templateVersion, eq(templateVersion.id, generation.templateVersionId))
    .where(eq(generation.id, generationId));
  if (!g || g.batchId || (g.status !== "success" && g.status !== "error")) return;
  const event = g.status === "success" ? "generation.succeeded" : "generation.failed";
  const targets = await subscribers(tx, event, g);
  if (!targets.length) return;
  const { outputFileId, ...fields } = g;
  const download = outputFileId
    ? {
        downloadUrl: (
          await mintLink(
            {
              fileId: outputFileId,
              generationId,
              userId: g.userId,
              expiresInSeconds: DOWNLOAD_LINK_SECONDS,
            },
            tx,
          )
        ).url,
        pdfPath: `/api/v1/generations/${generationId}/pdf`,
      }
    : {};
  await queueDeliveries(
    tx,
    targets.map((w) => w.id),
    event,
    { generation: { ...fields, ...download } },
    { generationId },
  );
}

const counted = (status: "success" | "error" | "cancelled") =>
  sql<number>`count(*) filter (where ${generation.status} = ${status})`.mapWith(Number);

/**
 * Marks a batch completed once no row is left to run, and fires batch.completed. Call it after
 * a row's outcome has committed; of two last rows finishing together, only one wins the update.
 */
export async function completeBatch(batchId: string) {
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(batch)
      .set({ completedAt: new Date() })
      .where(
        and(
          eq(batch.id, batchId),
          isNull(batch.completedAt),
          notExists(
            tx
              .select({ id: generation.id })
              .from(generation)
              .where(
                and(
                  eq(generation.batchId, batchId),
                  inArray(generation.status, ["queued", "running"]),
                ),
              ),
          ),
        ),
      )
      .returning();
    if (!done) return;
    const targets = await subscribers(tx, "batch.completed", done);
    if (!targets.length) return;
    const [counts] = await tx
      .select({
        done: counted("success"),
        failed: counted("error"),
        cancelled: counted("cancelled"),
      })
      .from(generation)
      .where(eq(generation.batchId, batchId));
    await queueDeliveries(
      tx,
      targets.map((w) => w.id),
      "batch.completed",
      {
        batch: {
          id: done.id,
          status: done.cancelledAt ? "cancelled" : "completed",
          templateId: done.templateId,
          templateVersionId: done.templateVersionId,
          templateName: done.templateName,
          version: done.version,
          total: done.total,
          ...counts,
          apiKeyId: done.apiKeyId,
          requestId: done.requestId,
          createdAt: done.createdAt,
          completedAt: done.completedAt,
          zipPath: `/api/v1/batches/${done.id}/zip`,
          packetPath: `/api/v1/batches/${done.id}/packet`,
        },
      },
      { batchId },
    );
  });
}

/** "Send test": a sample event through the same queue, signing and log. */
export async function queueTestDelivery(webhookId: string) {
  await db.transaction((tx) =>
    queueDeliveries(tx, [webhookId], WEBHOOK_TEST_EVENT, {
      message: "A test event from necodoc. Verify the signature, then answer 2xx.",
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Sending (worker side)

const TIMEOUT_MS = 10_000;

/** POSTs to the address that was checked, with the URL's host for TLS and the Host header. */
function post(target: WebhookTarget, headers: Record<string, string>, body: string) {
  const { url, address } = target;
  const client = url.protocol === "https:" ? https : http;
  return new Promise<number>((resolve, reject) => {
    const request = client.request(
      {
        host: address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        // An IP literal can't be a TLS server name; the certificate is then checked against it.
        servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
        headers: { ...headers, Host: url.host, "Content-Length": String(Buffer.byteLength(body)) },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
        response.on("error", reject);
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error(`No response in ${TIMEOUT_MS / 1000} s`)),
    );
    request.on("error", reject);
    request.end(body);
  });
}

/** Why a POST counted as failed, for the next retry. */
export class DeliveryFailed extends Error {}

/**
 * Sends one delivery once and records the attempt. Throws `DeliveryFailed` when it should be
 * retried, so pg-boss schedules the next attempt with backoff.
 */
export async function deliver(deliveryId: string, retriesLeft: boolean) {
  const [row] = await db
    .select({
      payload: webhookDelivery.payload,
      event: webhookDelivery.event,
      status: webhookDelivery.status,
      url: webhook.url,
      secret: webhook.secret,
      enabled: webhook.enabled,
    })
    .from(webhookDelivery)
    .innerJoin(webhook, eq(webhook.id, webhookDelivery.webhookId))
    .where(eq(webhookDelivery.id, deliveryId));
  if (row?.status !== "pending") return;

  const at = new Date();
  const started = performance.now();
  let status: number | null = null;
  let error: string | null = null;
  if (!row.enabled) {
    error = "The webhook is disabled";
  } else {
    const resolved = await resolveWebhookUrl(row.url);
    if (!resolved.ok) {
      error = resolved.error;
    } else {
      const body = JSON.stringify(row.payload);
      try {
        status = await post(
          resolved.target,
          {
            "Content-Type": "application/json",
            "User-Agent": "necodoc-webhooks/1",
            "Necodoc-Event": row.event,
            "Necodoc-Delivery": deliveryId,
            "Necodoc-Signature": signatureHeader(row.secret, body),
          },
          body,
        );
        if (status < 200 || status >= 300) error = `Answered ${status}`;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
  }
  const attempt: WebhookAttempt = {
    at: at.toISOString(),
    status,
    ms: Math.round(performance.now() - started),
    error,
  };
  // A disabled webhook doesn't get better by retrying; DNS and network failures might.
  const next: WebhookDeliveryStatus =
    error === null ? "success" : retriesLeft && row.enabled ? "pending" : "failed";
  await db
    .update(webhookDelivery)
    .set({
      status: next,
      attempts: sql`${webhookDelivery.attempts} || ${JSON.stringify([attempt])}::jsonb`,
      finishedAt: next === "pending" ? null : new Date(),
    })
    .where(eq(webhookDelivery.id, deliveryId));
  if (next === "pending") throw new DeliveryFailed(error ?? "Failed");
}
