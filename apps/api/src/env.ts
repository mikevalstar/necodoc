import { processRoleSchema } from "@necodoc/shared";
import { z } from "zod";
import { storageEnvSchema } from "./storage/config";

export const env = z
  .object({
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
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
    /** ADR 0023: `presigned` redirects output downloads to an S3 presigned URL or Azure SAS. */
    STORAGE_REDIRECT: z.enum(["off", "presigned"]).default("off"),
    /** Signs download links; falls back to BETTER_AUTH_SECRET. Changing it voids live links. */
    DOWNLOAD_SIGNING_SECRET: z.string().min(32).optional(),
  })
  .parse(process.env);

/** ADR 0023: where generated outputs go (src/storage). */
export const storageConfig = storageEnvSchema.parse(process.env);

export const servesApi = env.ROLE !== "worker";
export const runsWorker = env.ROLE !== "api";
