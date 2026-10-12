import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { pageOptionsSchema } from "@necodoc/shared";
import * as pkijs from "pkijs";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "./browser";
import {
  type Certifier,
  CertifyError,
  certificateInfo,
  certifierFromP12,
  certifierFromPem,
  certifyPdf,
} from "./certify";
import { finishPdf } from "./finish";
import { renderPdf } from "./render";
import { hasVerapdf, verapdf } from "./testing/verapdf";

// ADR 0038. Certifies with the TEST-ONLY identities in fixtures/certs and checks the result the
// way a validator does: the byte range covers everything but the signature, the CMS verifies
// over it, and the DocMDP certification allows form filling (P=2). pyHanko and pdfsig agree
// (see the ADR); they're not needed here.

afterAll(closeBrowser);

const certs = new URL("../../../../fixtures/certs/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, certs));
const p12 = () => certifierFromP12(new Uint8Array(read("test-only.p12")), "test-only");

async function samplePdf(pdfa: boolean) {
  const { pdf } = await renderPdf(
    { html: "<h1>Bond</h1><p>Certified.</p>", page: pageOptionsSchema.parse({}), data: {} },
    async () => null,
  );
  if (!pdfa) return pdf;
  const finished = await finishPdf(pdf, {
    output: { pdfa: "2b", pdfua: false, certify: false, lang: "en" },
    tagged: false,
    title: "Bond",
    preview: false,
    certifier: p12,
  });
  return finished.pdf;
}

/** Checks the signature the way a validator does; returns the signature dictionary. */
async function verify(pdf: Uint8Array) {
  const text = Buffer.from(pdf).toString("latin1");
  const range = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(text)?.slice(1).map(Number);
  if (!range) throw new Error("No byte range");
  const [a = 0, b = 0, c = 0, d = 0] = range;
  expect(a).toBe(0);
  expect(c + d).toBe(pdf.length);
  expect(text[b]).toBe("<");
  expect(text[c - 1]).toBe(">");
  const der = Buffer.from(text.slice(b + 1, c - 1), "hex");
  const signed = new Uint8Array(b + d);
  signed.set(pdf.subarray(a, b));
  signed.set(pdf.subarray(c, c + d), b);
  const content = pkijs.ContentInfo.fromBER(der);
  const signedData = new pkijs.SignedData({ schema: content.content });
  const ok = await signedData.verify({ signer: 0, data: signed.buffer, checkChain: false });
  expect(ok).toBe(true);
  const attributes = signedData.signerInfos[0]?.signedAttrs?.attributes.map((x) => x.type);
  // content-type, message-digest, signing-certificate-v2; no signing-time (PAdES).
  expect(attributes).toEqual([
    "1.2.840.113549.1.9.3",
    "1.2.840.113549.1.9.4",
    "1.2.840.113549.1.9.16.2.47",
  ]);

  const doc = await PDFDocument.load(pdf);
  const perms = doc.catalog.lookup(PDFName.of("Perms"), PDFDict);
  const signature = perms.lookup(PDFName.of("DocMDP"), PDFDict);
  return { signature, signedData, doc };
}

describe("certifyPdf", () => {
  it("certifies with a PKCS#12 identity and its chain, keeping PDF/A", async () => {
    const certifier = await p12();
    expect(certifier.subject).toBe("necodoc TEST ONLY certifier");
    expect(certifier.chain).toHaveLength(2);
    const { pdf, timestamped } = await certifyPdf(await samplePdf(true), certifier);
    expect(timestamped).toBe(false);
    const { signature, signedData } = await verify(pdf);
    expect(signature.get(PDFName.of("SubFilter"))?.toString()).toBe("/ETSI.CAdES.detached");
    expect(signature.toString()).toMatch(/\/TransformMethod \/DocMDP/);
    expect(signature.toString()).toMatch(/\/P 2\b/);
    expect(signedData.certificates).toHaveLength(2);
    if (hasVerapdf) expect(verapdf(pdf, "2b")).toEqual({ compliant: true, failed: [] });
    // veraPDF starts a JVM; under a full parallel run that alone can pass 5 s.
  }, 60_000);

  it("certifies with a PEM EC key", async () => {
    const certifier = await certifierFromPem(
      read("test-only-ec.cert.pem").toString(),
      read("test-only-ec.key.pem").toString(),
    );
    const { pdf } = await certifyPdf(await samplePdf(false), certifier);
    await verify(pdf);
    const info = certificateInfo(certifier);
    expect(info.subject).toBe(certifier.subject);
    expect(info.issuer).toBeTruthy();
    expect(Date.parse(info.notAfter ?? "")).toBeGreaterThan(Date.now());
  });

  it("refuses a wrong password and a key without its certificate", async () => {
    await expect(
      certifierFromP12(new Uint8Array(read("test-only.p12")), "wrong"),
    ).rejects.toBeInstanceOf(CertifyError);
    await expect(
      certifierFromPem(read("test-ca.cert.pem").toString(), read("test-only.key.pem").toString()),
    ).rejects.toThrow("No certificate matches the private key");
  });
});

describe("finishPdf", () => {
  const unavailable = async (): Promise<Certifier> => {
    throw new CertifyError("no certificate");
  };

  it("skips certification on previews and fails logged renders without a certificate", async () => {
    const pdf = await samplePdf(false);
    const output = { pdfa: null, pdfua: false, certify: true, lang: "en" };
    const options = { output, tagged: false, title: "Bond", certifier: unavailable };
    const preview = await finishPdf(pdf, { ...options, preview: true });
    expect(preview.profile).toEqual({ pdfa: null, pdfua: false, certified: null });
    await expect(finishPdf(pdf, { ...options, preview: false })).rejects.toThrow("no certificate");
  });

  it("doesn't claim PDF/UA for untagged input", async () => {
    const result = await finishPdf(await samplePdf(false), {
      output: { pdfa: null, pdfua: true, certify: false, lang: "en" },
      tagged: false,
      title: "Bond",
      preview: false,
      certifier: unavailable,
    });
    expect(result.profile).toEqual({ pdfa: null, pdfua: false, certified: null });
    expect(result.warnings).toEqual([
      "Not PDF/UA: only HTML renders are tagged, not overlays or packets",
    ]);
  });
});
