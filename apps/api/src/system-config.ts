import type { SystemConfig } from "@necodoc/shared";
import { hostOf } from "./addresses";
import { certifier } from "./certifier";
import { env, instance, passwordEnabled, ssoProviders } from "./env";
import { tracingEnabled } from "./observability/tracing";
import { chromiumVersion } from "./render/browser";
import { certificateInfo } from "./render/certify";
import { retentionSettings } from "./retention";
import { storageReachable } from "./routes/health";
import { storage } from "./storage";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (Configuration). What this process is
// configured with, for Admin > System. Nothing secret leaves here: URLs go out as their host only
// (hostOf).

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function certification(): Promise<SystemConfig["certification"]> {
  if (!env.CERTIFY_P12_PATH && !(env.CERTIFY_CERT_PATH && env.CERTIFY_KEY_PATH)) return null;
  const tsaHost = hostOf(env.CERTIFY_TSA_URL);
  try {
    return { ...certificateInfo(await certifier()), error: null, tsaHost };
  } catch (error) {
    return { subject: null, issuer: null, notAfter: null, error: message(error), tsaHost };
  }
}

export async function systemConfig(): Promise<SystemConfig> {
  const [chromium, cert, stored, retention] = await Promise.all([
    chromiumVersion().then(
      (version) => ({ version, error: null }),
      (error: unknown) => ({ version: null, error: message(error) }),
    ),
    certification(),
    storageReachable(),
    retentionSettings(),
  ]);
  const { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, OTEL_EXPORTER_OTLP_ENDPOINT } = process.env;
  return {
    instance: instance(),
    role: env.ROLE,
    chromium,
    ai: { enabled: !!env.ANTHROPIC_KEY, model: env.AI_MODEL },
    auth: {
      password: passwordEnabled,
      trustedHeader: ssoProviders.some((p) => p.type === "header"),
      sso: ssoProviders.map(({ id, label, type }) => ({ id, label, type })),
    },
    certification: cert,
    storage: {
      driver: storage.name,
      target: storage.target,
      redirect: env.STORAGE_REDIRECT,
      ok: stored.ok,
      error: stored.ok ? null : stored.error,
    },
    metricsPort: env.METRICS_PORT ?? null,
    tracing: {
      enabled: tracingEnabled,
      endpointHost: hostOf(OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? OTEL_EXPORTER_OTLP_ENDPOINT),
    },
    logging: { level: env.LOG_LEVEL, format: env.LOG_FORMAT },
    retention,
  };
}
