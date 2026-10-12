import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
} from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "@cantoo/pdf-lib";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

// ADR 0038: a PAdES baseline (B-B, or B-T with a timestamp authority) certification signature
// with DocMDP P=2, so form filling and later approval signatures (an e-sign provider's) stay
// allowed. The signature dictionary is placed with pdf-lib; the CMS is built with PKI.js.

/** The server's certifying identity, loaded once from env (src/certifier.ts). */
export type Certifier = {
  key: CryptoKey;
  /** Signing certificate first, then its issuers. */
  chain: pkijs.Certificate[];
  /** The signing certificate's subject common name (or full DN). */
  subject: string;
  /** RFC 3161 timestamp authority: with it, B-T; without, B-B. */
  tsaUrl?: string;
};

export class CertifyError extends Error {}

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  timeStampToken: "1.2.840.113549.1.9.16.2.14",
  sha256: "2.16.840.1.101.3.4.2.1",
  certBag: "1.2.840.113549.1.12.10.1.3",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  commonName: "2.5.4.3",
};

/**
 * Room for the CMS: the chain, the signature and attributes, and a timestamp token (which
 * carries the TSA's own certificates). Unused room is zero padding, so it's kept tight.
 */
const contentsBytes = (certifier: Certifier) =>
  certifier.chain.reduce((sum, cert) => sum + cert.toSchema().toBER().byteLength, 0) +
  2048 +
  (certifier.tsaUrl ? 12_288 : 0);
const BYTE_RANGE_PLACEHOLDER = "**********";

const view = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const sha256 = (bytes: Uint8Array | ArrayBuffer) =>
  new Uint8Array(createHash("sha256").update(new Uint8Array(bytes)).digest());

// ---------------------------------------------------------------------------------------------
// Loading the identity

/** A WebCrypto signing key for PKI.js (RSA PKCS#1 v1.5 or ECDSA, with SHA-256). */
function webKey(key: KeyObject) {
  const der = new Uint8Array(key.export({ format: "der", type: "pkcs8" }));
  let algorithm: RsaHashedImportParams | EcKeyImportParams;
  if (key.asymmetricKeyType === "rsa") {
    algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  } else if (key.asymmetricKeyType === "ec") {
    const curve = key.asymmetricKeyDetails?.namedCurve ?? "";
    const curves: Record<string, string> = {
      prime256v1: "P-256",
      secp384r1: "P-384",
      secp521r1: "P-521",
    };
    const namedCurve = curves[curve];
    if (!namedCurve) throw new CertifyError(`Unsupported EC curve ${curve}`);
    algorithm = { name: "ECDSA", namedCurve };
  } else {
    throw new CertifyError(`Unsupported key type ${key.asymmetricKeyType}; use RSA or EC`);
  }
  return crypto.subtle.importKey("pkcs8", der, algorithm, false, ["sign"]);
}

/** A name's common name, or the full DN. */
function nameOf(name: pkijs.RelativeDistinguishedNames) {
  const cn = name.typesAndValues.find((tv) => tv.type === OID.commonName);
  return cn ? String(cn.value.valueBlock.value) : name.toString();
}

const subjectOf = (cert: pkijs.Certificate) => nameOf(cert.subject);

/** The signing certificate's details for Admin > System. */
export function certificateInfo(certifier: Certifier) {
  const leaf = certifier.chain[0];
  return {
    subject: certifier.subject,
    issuer: leaf ? nameOf(leaf.issuer) : null,
    notAfter: leaf ? leaf.notAfter.value.toISOString() : null,
  };
}

/** Puts the certificate matching the key first, then its issuers in order, as far as they go. */
function orderChain(certs: pkijs.Certificate[], key: KeyObject) {
  const publicDer = createPublicKey(key).export({ format: "der", type: "spki" });
  const leaf = certs.find((cert) =>
    Buffer.from(cert.subjectPublicKeyInfo.toSchema().toBER()).equals(publicDer),
  );
  if (!leaf) throw new CertifyError("No certificate matches the private key");
  const chain = [leaf];
  for (let last = leaf; !last.issuer.isEqual(last.subject); ) {
    const issuer = certs.find((cert) => !chain.includes(cert) && cert.subject.isEqual(last.issuer));
    if (!issuer) break;
    chain.push(issuer);
    last = issuer;
  }
  return chain;
}

async function identity(certs: pkijs.Certificate[], key: KeyObject, tsaUrl?: string) {
  const chain = orderChain(certs, key);
  const leaf = chain[0] as pkijs.Certificate;
  const now = new Date();
  if (leaf.notAfter.value < now || leaf.notBefore.value > now) {
    throw new CertifyError(`The certificate for ${subjectOf(leaf)} isn't valid now`);
  }
  return { key: await webKey(key), chain, subject: subjectOf(leaf), tsaUrl } satisfies Certifier;
}

const pemBlocks = (pem: string, label: string) =>
  [...pem.matchAll(new RegExp(`-----BEGIN ${label}-----([^-]+)-----END ${label}-----`, "g"))].map(
    (m) => new Uint8Array(Buffer.from(m[1] ?? "", "base64")),
  );

/** PEM: one or more certificates (signing certificate and chain) and a private key. */
export function certifierFromPem(
  certPem: string,
  keyPem: string,
  password?: string,
  tsaUrl?: string,
) {
  const certs = pemBlocks(certPem, "CERTIFICATE").map((der) => pkijs.Certificate.fromBER(der));
  if (!certs.length) throw new CertifyError("The certificate file has no PEM certificate");
  const key = createPrivateKey({ key: keyPem, format: "pem", passphrase: password });
  return identity(certs, key, tsaUrl);
}

/** PKCS#12 (.p12/.pfx) with the key and its chain, password-protected (PBES2 or legacy PBE). */
export async function certifierFromP12(bytes: Uint8Array, password: string, tsaUrl?: string) {
  const secret = view(new TextEncoder().encode(password));
  const pfx = pkijs.PFX.fromBER(view(bytes));
  try {
    await pfx.parseInternalValues({ password: secret, checkIntegrity: true });
  } catch (error) {
    throw new CertifyError(`Can't open the PKCS#12 file (wrong password?): ${String(error)}`);
  }
  const safe = pfx.parsedValue?.authenticatedSafe;
  if (!safe) throw new CertifyError("The PKCS#12 file has no content");
  await safe.parseInternalValues({
    safeContents: safe.safeContents.map(() => ({ password: secret })),
  });
  const certs: pkijs.Certificate[] = [];
  let key: KeyObject | undefined;
  for (const contents of safe.parsedValue?.safeContents ?? []) {
    for (const bag of contents.value.safeBags) {
      if (bag.bagId === OID.certBag && bag.bagValue instanceof pkijs.CertBag) {
        if (bag.bagValue.parsedValue instanceof pkijs.Certificate)
          certs.push(bag.bagValue.parsedValue);
      } else if (
        bag.bagId === OID.shroudedKeyBag &&
        bag.bagValue instanceof pkijs.PKCS8ShroudedKeyBag
      ) {
        await bag.bagValue.parseInternalValues({ password: secret });
        const info = bag.bagValue.parsedValue;
        if (info)
          key = createPrivateKey({
            key: Buffer.from(info.toSchema().toBER()),
            format: "der",
            type: "pkcs8",
          });
      } else if (bag.bagId === OID.keyBag && bag.bagValue instanceof pkijs.PrivateKeyInfo) {
        key = createPrivateKey({
          key: Buffer.from(bag.bagValue.toSchema().toBER()),
          format: "der",
          type: "pkcs8",
        });
      }
    }
  }
  if (!key) throw new CertifyError("The PKCS#12 file has no private key");
  return identity(certs, key, tsaUrl);
}

// ---------------------------------------------------------------------------------------------
// The CMS (CAdES-detached)

/** ESS signing-certificate-v2 (RFC 5035), which PAdES requires: binds the signer's cert. */
function signingCertificateV2(cert: pkijs.Certificate) {
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 4 },
            value: [cert.issuer.toSchema()],
          }),
        ],
      }),
      cert.serialNumber,
    ],
  });
  const certId = new asn1js.Sequence({
    // hashAlgorithm defaults to SHA-256, so it's left out.
    value: [
      new asn1js.OctetString({ valueHex: view(sha256(cert.toSchema().toBER())) }),
      issuerSerial,
    ],
  });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [certId] })] });
}

async function timestamp(signature: ArrayBuffer, tsaUrl: string) {
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
      hashedMessage: new asn1js.OctetString({ valueHex: view(sha256(signature)) }),
    }),
    nonce: new asn1js.Integer({ valueHex: view(randomBytes(8)) }),
    certReq: true,
  });
  const response = await fetch(tsaUrl, {
    method: "POST",
    headers: { "content-type": "application/timestamp-query" },
    body: Buffer.from(request.toSchema().toBER()),
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => {
    throw new CertifyError(`The timestamp authority didn't answer: ${String(error)}`);
  });
  if (!response.ok) throw new CertifyError(`The timestamp authority answered ${response.status}`);
  const parsed = pkijs.TimeStampResp.fromBER(await response.arrayBuffer());
  // 0 granted, 1 granted with modifications.
  const status = parsed.status.status;
  if ((status !== 0 && status !== 1) || !parsed.timeStampToken) {
    throw new CertifyError(`The timestamp authority refused the request (status ${status})`);
  }
  return parsed.timeStampToken;
}

async function cms(digest: Uint8Array, certifier: Certifier) {
  const [leaf] = certifier.chain;
  if (!leaf) throw new CertifyError("No signing certificate");
  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    certificates: certifier.chain,
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: leaf.issuer,
          serialNumber: leaf.serialNumber,
        }),
        // No signing-time attribute: PAdES takes the time from the dictionary's M (or the TSA).
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({
              type: OID.contentType,
              values: [new asn1js.ObjectIdentifier({ value: OID.data })],
            }),
            new pkijs.Attribute({
              type: OID.messageDigest,
              values: [new asn1js.OctetString({ valueHex: view(digest) })],
            }),
            new pkijs.Attribute({
              type: OID.signingCertificateV2,
              values: [signingCertificateV2(leaf)],
            }),
          ],
        }),
      }),
    ],
  });
  await signedData.sign(certifier.key, 0, "SHA-256");
  const signer = signedData.signerInfos[0];
  let timestamped = false;
  if (certifier.tsaUrl && signer) {
    const token = await timestamp(view(signer.signature.valueBlock.valueHexView), certifier.tsaUrl);
    signer.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [new pkijs.Attribute({ type: OID.timeStampToken, values: [token.toSchema()] })],
    });
    timestamped = true;
  }
  const content = new pkijs.ContentInfo({
    contentType: OID.signedData,
    content: signedData.toSchema(true),
  });
  return { der: new Uint8Array(content.toSchema().toBER()), timestamped };
}

// ---------------------------------------------------------------------------------------------
// The PDF

/**
 * Adds an invisible certification signature: a zero-size widget on page 1, a signature
 * dictionary with a DocMDP reference (P=2: fill forms, sign; nothing else) and the catalog's
 * Perms entry. Saved without object streams so the placeholder is plain text in the file.
 */
async function withPlaceholder(pdf: Uint8Array, certifier: Certifier, signedAt: Date) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const { context, catalog } = doc;
  const page = doc.getPage(0);
  const placeholder = PDFName.of(BYTE_RANGE_PLACEHOLDER);
  const signature = context.register(
    context.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "ETSI.CAdES.detached",
      ByteRange: [0, placeholder, placeholder, placeholder],
      Contents: PDFHexString.of("0".repeat(contentsBytes(certifier) * 2)),
      M: PDFString.fromDate(signedAt),
      Name: PDFHexString.fromText(certifier.subject),
      Reason: PDFHexString.fromText("Certified as generated by necodoc"),
      Reference: [
        {
          Type: "SigRef",
          TransformMethod: "DocMDP",
          TransformParams: { Type: "TransformParams", P: 2, V: "1.2" },
        },
      ],
    }),
  );
  // An empty appearance keeps PDF/A happy (every annotation has one, 6.3.3).
  const appearance = context.register(
    context.stream(new Uint8Array(), { Type: "XObject", Subtype: "Form", BBox: [0, 0, 0, 0] }),
  );
  const widget = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFHexString.fromText("necodoc certification"),
      V: signature,
      Rect: [0, 0, 0, 0],
      // Print + Locked.
      F: 132,
      P: page.ref,
      AP: { N: appearance },
    }),
  );
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widget);
  else page.node.set(PDFName.of("Annots"), context.obj([widget]));

  let acroForm = catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acroForm) {
    acroForm = context.obj({ Fields: [] });
    catalog.set(PDFName.of("AcroForm"), context.register(acroForm));
  }
  const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (fields) fields.push(widget);
  else acroForm.set(PDFName.of("Fields"), context.obj([widget]));
  // SignaturesExist + AppendOnly: later changes must be incremental updates.
  acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  catalog.set(PDFName.of("Perms"), context.obj({ DocMDP: signature }));

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Certifies a finished PDF. Returns the signed bytes and whether a TSA timestamped it. */
export async function certifyPdf(pdf: Uint8Array, certifier: Certifier) {
  const placed = await withPlaceholder(pdf, certifier, new Date());
  const text = latin1(placed);

  const rangeText = `/ByteRange [ 0 /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} ]`;
  const rangeAt = text.indexOf(rangeText);
  const size = contentsBytes(certifier);
  const contentsAt = text.indexOf(`<${"0".repeat(size * 2)}>`);
  if (rangeAt < 0 || contentsAt < 0) throw new CertifyError("Couldn't place the signature");
  const contentsEnd = contentsAt + size * 2 + 2;
  const range = [0, contentsAt, contentsEnd, placed.length - contentsEnd];
  const filled = `/ByteRange [${range.join(" ")}]`.padEnd(rangeText.length, " ");
  if (filled.length !== rangeText.length) throw new CertifyError("The PDF is too large to sign");
  placed.set(new TextEncoder().encode(filled), rangeAt);

  const digest = createHash("sha256")
    .update(placed.subarray(0, contentsAt))
    .update(placed.subarray(contentsEnd))
    .digest();
  const { der, timestamped } = await cms(new Uint8Array(digest), certifier);
  if (der.length > size) throw new CertifyError("The signature is larger than its space");
  const hex = Buffer.from(der)
    .toString("hex")
    .padEnd(size * 2, "0");
  placed.set(new TextEncoder().encode(hex), contentsAt + 1);
  return { pdf: placed, timestamped };
}
