import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "@cantoo/pdf-lib";
import type { PdfaLevel } from "@necodoc/shared";
import { SRGB_ICC } from "./srgb-icc";

// ADR 0035: PDF/A-2 and PDF/UA-1 by post-processing in pdf-lib. Chromium already embeds every
// font (as subsets with ToUnicode maps), uses no encryption and, with `tagged: true`, writes the
// structure tree. What's left is document-level: identification and matching metadata, an output
// intent, a file id, annotation flags, language and title. Verified with veraPDF in
// conformance.test.ts.

export type ConformanceOptions = {
  pdfa: PdfaLevel | null;
  /** Only claimed for a tagged PDF (a Chromium render with `tagged: true`). */
  pdfua: boolean;
  lang: string;
  title: string;
};

const PRODUCER = "necodoc";

const xmlEscape = (text: string) =>
  text.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] ?? ch);

/** XMP whose values match the Info dictionary exactly (PDF/A-2 6.6.3). */
function xmp({ pdfa, pdfua, title }: ConformanceOptions, date: string) {
  const ids = [
    pdfa
      ? `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${pdfa[0]}</pdfaid:part><pdfaid:conformance>${pdfa[1]?.toUpperCase()}</pdfaid:conformance></rdf:Description>`
      : "",
    pdfua
      ? `<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part></rdf:Description>`
      : "",
  ].join("");
  return `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>${date}</xmp:CreateDate><xmp:ModifyDate>${date}</xmp:ModifyDate><xmp:MetadataDate>${date}</xmp:MetadataDate><xmp:CreatorTool>${PRODUCER}</xmp:CreatorTool></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${PRODUCER}</pdf:Producer></rdf:Description>
${ids}
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

// Annotation flags (PDF 32000-1 12.5.3).
const HIDDEN = 2;
const PRINT = 4;
const NO_VIEW = 32;
const TOGGLE_NO_VIEW = 256;

/** Fonts whose program isn't in the file: PDF/A forbids them, and only a re-render can fix it. */
export function unembeddedFonts(doc: PDFDocument) {
  const missing = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of("Type")) !== PDFName.of("Font")) {
      continue;
    }
    const subtype = object.get(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Type0") || subtype === PDFName.of("Type3")) continue;
    const descriptor = object.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    const embedded = ["FontFile", "FontFile2", "FontFile3"].some((key) =>
      descriptor?.has(PDFName.of(key)),
    );
    if (!embedded) missing.add(object.get(PDFName.of("BaseFont"))?.toString().slice(1) ?? "?");
  }
  return [...missing];
}

/**
 * Makes a PDF identify as PDF/A-2 and/or PDF/UA-1. Returns what it could claim: PDF/A is dropped
 * (with a warning) when a font isn't embedded, which happens only with uploaded overlay sources.
 */
export async function applyConformance(pdf: Uint8Array, options: ConformanceOptions) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const warnings: string[] = [];
  let { pdfa } = options;
  const { pdfua, lang, title } = options;
  if (pdfa) {
    const missing = unembeddedFonts(doc);
    if (missing.length) {
      warnings.push(
        `Not PDF/A: the source PDF uses fonts it doesn't embed (${missing.join(", ")})`,
      );
      pdfa = null;
    }
  }
  const { context, catalog } = doc;

  const now = new Date();
  now.setMilliseconds(0);
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  catalog.set(PDFName.of("Lang"), PDFString.of(lang));

  const metadata = context.stream(
    new TextEncoder().encode(xmp({ ...options, pdfa }, now.toISOString().replace(".000", ""))),
    { Type: "Metadata", Subtype: "XML" },
  );
  catalog.set(PDFName.of("Metadata"), context.register(metadata));

  if (pdfa) {
    const profile = context.register(context.stream(SRGB_ICC, { N: 3 }));
    const intent = context.obj({
      Type: "OutputIntent",
      S: "GTS_PDFA1",
      OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
      Info: PDFString.of("sRGB IEC61966-2.1"),
      DestOutputProfile: profile,
    });
    catalog.set(PDFName.of("OutputIntents"), context.obj([intent]));
    // A form must not ask viewers to build appearances (6.4.1); pdf-lib wrote them all.
    catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.delete(PDFName.of("NeedAppearances"));
  }

  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots?.size()) continue;
    // PDF/UA 7.18.3: tab order follows the structure.
    if (pdfua) page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
    if (!pdfa) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      // Printable and visible (PDF/A-2 6.3.2).
      const fixed = (flags | PRINT) & ~(HIDDEN | NO_VIEW | TOGGLE_NO_VIEW);
      annot.set(PDFName.of("F"), PDFNumber.of(fixed));
    }
  }

  // A file identifier (6.1.3), derived from the content so it's stable for the same bytes.
  const id = PDFHexString.of(createHash("md5").update(pdf).digest("hex"));
  context.trailerInfo.ID = context.obj([id, id]);

  return { pdf: new Uint8Array(await doc.save()), pdfa, pdfua, warnings };
}
