import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
} from "@cantoo/pdf-lib";
import type { PdfaLevel } from "@necodoc/shared";
import { SRGB_ICC } from "./srgb-icc";

// ADR 0037: PDF/A-2 and PDF/UA-1 by post-processing in pdf-lib. Chromium already embeds every
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
  text.replace(
    /[<>&"]/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] ?? ch,
  );

const PDFUA_EXTENSION = `<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>PDF/UA Universal Accessibility Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI><pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq><rdf:li rdf:parseType="Resource"><pdfaProperty:name>part</pdfaProperty:name><pdfaProperty:valueType>Integer</pdfaProperty:valueType><pdfaProperty:category>internal</pdfaProperty:category><pdfaProperty:description>Indicates, which part of ISO 14289 standard is followed</pdfaProperty:description></rdf:li></rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>`;

/** XMP whose values match the Info dictionary exactly (PDF/A-2 6.6.3). */
function xmp({ pdfa, pdfua, title }: ConformanceOptions, date: string) {
  const ids = [
    pdfa
      ? `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${pdfa[0]}</pdfaid:part><pdfaid:conformance>${pdfa[1]?.toUpperCase()}</pdfaid:conformance></rdf:Description>`
      : "",
    pdfua
      ? `<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part></rdf:Description>`
      : "",
    // PDF/A only knows its own schemas: pdfuaid needs declaring as an extension (6.6.2.3.2).
    pdfa && pdfua ? PDFUA_EXTENSION : "",
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

function linkDescription(link: PDFDict) {
  const uri = link.lookupMaybe(PDFName.of("A"), PDFDict)?.lookup(PDFName.of("URI"));
  return uri instanceof PDFString || uri instanceof PDFHexString
    ? `Link to ${uri.decodeText()}`
    : "Link within this document";
}

const name = (dict: PDFDict, key: string) => dict.get(PDFName.of(key));

/**
 * Walks every object once: fixes what PDF/A-2 lets us fix in place (image interpolation, 6.2.8)
 * and lists what it can't: fonts without their program (6.2.11.4), JavaScript (6.6.1) and
 * attachments (6.8). Chromium output has none of these; uploaded overlay sources often do.
 */
export function pdfaPreflight(doc: PDFDocument) {
  const fonts = new Set<string>();
  let javascript = false;
  let attachments = false;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFDict ? object : object instanceof PDFRawStream ? object.dict : null;
    if (!dict) continue;
    if (name(dict, "Subtype") === PDFName.of("Image") && dict.has(PDFName.of("Interpolate"))) {
      dict.delete(PDFName.of("Interpolate"));
    }
    if (name(dict, "S") === PDFName.of("JavaScript") || dict.has(PDFName.of("JS"))) {
      javascript = true;
    }
    if (dict.has(PDFName.of("EF"))) attachments = true;
    if (name(dict, "Type") !== PDFName.of("Font")) continue;
    const subtype = name(dict, "Subtype");
    if (subtype === PDFName.of("Type0") || subtype === PDFName.of("Type3")) continue;
    const descriptor = dict.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (!["FontFile", "FontFile2", "FontFile3"].some((key) => descriptor?.has(PDFName.of(key)))) {
      fonts.add(name(dict, "BaseFont")?.toString().slice(1).replace(/#20/g, " ") ?? "unnamed");
    }
  }
  const blockers: string[] = [];
  if (fonts.size) blockers.push(`fonts it doesn't embed (${[...fonts].join(", ")})`);
  if (javascript) blockers.push("JavaScript");
  if (attachments) blockers.push("file attachments");
  return blockers;
}

/**
 * PDF/UA 7.2: a list item holds only Lbl and LBody. Chromium puts block content (a `<p>` in an
 * `<li>`, which the visual editor always writes) straight under LI, so it's moved into an LBody.
 */
function wrapListBodies(doc: PDFDocument) {
  const { context } = doc;
  const S = PDFName.of("S");
  const K = PDFName.of("K");
  const P = PDFName.of("P");
  const kidsOf = (element: PDFDict) => {
    const k = element.lookup(K);
    return k instanceof PDFArray ? k : null;
  };
  const visit = (element: PDFDict, depth: number) => {
    const kids = kidsOf(element);
    if (!kids || depth > 200) return;
    const elements: PDFDict[] = [];
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict && kid.has(S)) elements.push(kid);
    }
    for (const kid of elements) visit(kid, depth + 1);
    if (element.get(S) !== PDFName.of("LI")) return;
    const stray = elements.filter(
      (kid) => kid.get(S) !== PDFName.of("Lbl") && kid.get(S) !== PDFName.of("LBody"),
    );
    // Inline content comes as NonStruct, which is fine where it is.
    if (!stray.some((kid) => kid.get(S) !== PDFName.of("NonStruct"))) return;
    const bodyKids = context.obj([]);
    const bodyRef = context.register(
      context.obj({ Type: "StructElem", S: "LBody", P: element, K: bodyKids }),
    );
    const kept = context.obj([]);
    for (let i = 0; i < kids.size(); i++) {
      const raw = kids.get(i);
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict && stray.includes(kid)) {
        kid.set(P, bodyRef);
        bodyKids.push(raw);
      } else {
        kept.push(raw);
      }
    }
    kept.push(bodyRef);
    element.set(K, kept);
  };
  const root = doc.catalog.lookupMaybe(PDFName.of("StructTreeRoot"), PDFDict);
  const top = root?.lookup(K);
  if (top instanceof PDFDict) visit(top, 0);
  else if (top instanceof PDFArray) {
    for (let i = 0; i < top.size(); i++) {
      const element = top.lookup(i);
      if (element instanceof PDFDict) visit(element, 0);
    }
  }
}

/**
 * Makes a PDF identify as PDF/A-2 and/or PDF/UA-1. Returns what it could claim: PDF/A is dropped,
 * with a warning, when preflight finds something it can't fix.
 */
export async function applyConformance(pdf: Uint8Array, options: ConformanceOptions) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const warnings: string[] = [];
  let { pdfa } = options;
  const { pdfua, lang, title } = options;
  if (pdfa) {
    const blockers = pdfaPreflight(doc);
    if (blockers.length) {
      warnings.push(`Not PDF/A: the source PDF has ${blockers.join(", ")}`);
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

  if (pdfua) wrapListBodies(doc);

  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots?.size()) continue;
    // PDF/UA 7.18.3: tab order follows the structure.
    if (pdfua) page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      // PDF/UA 7.18.5: a link needs a description; Chromium writes none, so name its target.
      if (pdfua && annot.get(PDFName.of("Subtype")) === PDFName.of("Link")) {
        if (!annot.has(PDFName.of("Contents"))) {
          annot.set(PDFName.of("Contents"), PDFHexString.fromText(linkDescription(annot)));
        }
      }
      if (!pdfa) continue;
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
