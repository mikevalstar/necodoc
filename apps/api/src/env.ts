import { instanceEnvSchema, processRoleSchema } from "@necodoc/shared";
import { z } from "zod";
import { parseSsoProviders } from "./sso-config";
import { storageEnvSchema } from "./storage/config";

export const env = z
  .object({
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    /** ADR 0031: `false` hides and refuses email/password sign-in and sign-up (SSO only). */
    AUTH_PASSWORD_ENABLED: z.stringbool().default(true),
    PORT: z.coerce.number().default(3000),
    /** ADR 0020: `api` serves HTTP, `worker` renders queued jobs, `all` does both. */
    ROLE: processRoleSchema.default("all"),
    /** Render jobs one worker process runs at once. */
    RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    /** How long a synchronous generate call waits for its job before answering 202. */
    RENDER_WAIT_MS: z.coerce.number().int().min(0).default(30_000),
    /** Live previews one API process renders at once (they skip the queue). */
    PREVIEW_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    /** Reported in worker heartbeats, to spot mixed versions mid-deploy. */
    APP_VERSION: z.string().default("dev"),
    /** The sidebar and login page label (docs/features/app-shell-and-navigation.md). */
    INSTANCE_NAME: z
      .string()
      .max(60)
      .optional()
      .transform((name) => name?.trim() || undefined),
    INSTANCE_ENV: instanceEnvSchema.optional(),
    /** ADR 0023: `presigned` redirects output downloads to an S3 presigned URL or Azure SAS. */
    STORAGE_REDIRECT: z.enum(["off", "presigned"]).default("off"),
    /** ADR 0022: AI is on only with a key. An empty value counts as unset. */
    ANTHROPIC_KEY: z
      .string()
      .optional()
      .transform((key) => key?.trim() || undefined),
    AI_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
    /** Signs download links; falls back to BETTER_AUTH_SECRET. Changing it voids live links. */
    DOWNLOAD_SIGNING_SECRET: z.string().min(32).optional(),
    /** Behind a reverse proxy: take the client address from the last X-Forwarded-For hop. */
    TRUST_PROXY: z.stringbool().default(false),
    /**
     * Development only (docs/features/webhooks.md): lets webhooks use http:// and loopback
     * addresses, for a receiver on this machine. Never set it in production.
     */
    WEBHOOK_ALLOW_LOCALHOST: z.stringbool().default(false),
    /**
     * ADR 0038: the certificate that certifies PDFs, on every worker. A PKCS#12 file, or PEM
     * files (certificate plus chain, and the private key). The password opens either.
     */
    CERTIFY_P12_PATH: z.string().min(1).optional(),
    CERTIFY_CERT_PATH: z.string().min(1).optional(),
    CERTIFY_KEY_PATH: z.string().min(1).optional(),
    CERTIFY_PASSWORD: z.string().optional(),
    /** ADR 0038: an RFC 3161 timestamp authority; certified PDFs are PAdES B-T with it, B-B without. */
    CERTIFY_TSA_URL: z.url().optional(),
    /** ADR 0036: pino level. */
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** ADR 0036: one JSON object per line, or readable lines for a terminal. */
    LOG_FORMAT: z
      .enum(["json", "pretty"])
      .default(process.env.NODE_ENV === "production" ? "json" : "pretty"),
    /** ADR 0036: serves Prometheus `/metrics` on this port; off when unset. Never expose it publicly. */
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .parse(process.env);

/** ADR 0023: where generated outputs go (src/storage). */
export const storageConfig = storageEnvSchema.parse(process.env);

/** ADR 0031: identity providers from SSO_PROVIDERS and SSO_<ID>_* (src/sso-config.ts). */
export const ssoProviders = parseSsoProviders(process.env, env.BETTER_AUTH_URL);
if (!env.AUTH_PASSWORD_ENABLED && !ssoProviders.length) {
  throw new Error("AUTH_PASSWORD_ENABLED=false needs at least one provider in SSO_PROVIDERS");
}

export const servesApi = env.ROLE !== "worker";
export const runsWorker = env.ROLE !== "api";
