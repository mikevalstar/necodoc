import { readFile } from "node:fs/promises";
import { env } from "./env";
import { type Certifier, CertifyError, certifierFromP12, certifierFromPem } from "./render/certify";

// ADR 0038: the server's certifying identity, from CERTIFY_* on the process that renders.

let loaded: Promise<Certifier> | null = null;

async function load(): Promise<Certifier> {
  const password = env.CERTIFY_PASSWORD;
  const tsaUrl = env.CERTIFY_TSA_URL;
  if (env.CERTIFY_P12_PATH) {
    const bytes = new Uint8Array(await readFile(env.CERTIFY_P12_PATH));
    return certifierFromP12(bytes, password ?? "", tsaUrl);
  }
  if (env.CERTIFY_CERT_PATH && env.CERTIFY_KEY_PATH) {
    const [cert, key] = await Promise.all([
      readFile(env.CERTIFY_CERT_PATH, "utf8"),
      readFile(env.CERTIFY_KEY_PATH, "utf8"),
    ]);
    return certifierFromPem(cert, key, password, tsaUrl);
  }
  throw new CertifyError(
    "This server has no certificate to certify with: set CERTIFY_P12_PATH, or CERTIFY_CERT_PATH and CERTIFY_KEY_PATH",
  );
}

/** Loaded once per process; a failed load is retried on the next certified render. */
export function certifier() {
  if (!loaded) {
    loaded = load();
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}
