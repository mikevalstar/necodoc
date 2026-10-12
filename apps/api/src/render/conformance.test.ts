import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { importAcroFields, pageOptionsSchema, sampleTemplateData } from "@necodoc/shared";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "./browser";
import { applyConformance } from "./conformance";
import { renderOverlay } from "./overlay";
import { inspectUpload } from "./pdf-source";
import { renderPdf } from "./render";
import { hasVerapdf, verapdf } from "./testing/verapdf";

// ADR 0037. Structural checks always; veraPDF, when it's on PATH, validates the real thing:
// PDF/A-2u and PDF/UA-1 (its machine-checkable rules).

afterAll(closeBrowser);

const html = `<h1>Invoice {{ n }}</h1>
<p>Questions? <a href="https://example.com/help">Ask us</a>. Zoë Łukasz</p>
<table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody><tr><td>Bond</td><td>1</td></tr></tbody></table>
<img alt="A dot" width="20" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">
<p style="opacity: .5">Half-transparent text</p>
<ol><li><p>Visual-editor list items wrap a paragraph</p></li><li><p>Two</p><ul><li>Nested</li></ul></li></ol>
<p>Sign here: <span data-sign="signature" data-signer="client" style="width:50mm;height:10mm;border-bottom:1px solid currentColor"></span></p>`;

async function renderTagged() {
  const { pdf } = await renderPdf(
    {
      html,
      page: pageOptionsSchema.parse({}),
      data: { n: 42 },
      header: { html: "<p>necodoc</p>", height: 10 },
      footer: { html: "<p>Page {{ page }} of {{ pages }}</p>", height: 10 },
      signers: [{ id: "client", role: "Client", routingOrder: 1, name: "", email: "" }],
      output: { pdfa: "2u", pdfua: true, certify: false, lang: "en-CA" },
    },
    async () => null,
  );
  return pdf;
}

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../../fixtures/pdfs/surety-bonds/${name}.pdf`, import.meta.url)),
  );

async function overlay(name: string) {
  const bytes = fixture(name);
  const imported = importAcroFields((await inspectUpload(bytes)).fields, [], []);
  const { pdf } = await renderOverlay(
    {
      kind: "overlay",
      sourceId: "x",
      boxes: imported.boxes,
      flatten: false,
      data: sampleTemplateData(imported.sections),
      preview: false,
    },
    async () => bytes,
    async () => null,
  );
  return pdf;
}

describe("applyConformance", () => {
  it("makes a tagged Chromium render (lists, sign boxes, bands) PDF/A-2u and PDF/UA-1", async () => {
    const rendered = await renderTagged();
    // Chromium alone isn't PDF/A (no output intent, metadata or file id).
    if (hasVerapdf) expect(verapdf(rendered, "2u").compliant).toBe(false);
    const result = await applyConformance(rendered, {
      pdfa: "2u",
      pdfua: true,
      lang: "en-CA",
      title: "Invoice 42",
    });
    expect(result).toMatchObject({ pdfa: "2u", pdfua: true, warnings: [] });

    const doc = await PDFDocument.load(result.pdf);
    expect(doc.getTitle()).toBe("Invoice 42");
    expect(doc.catalog.get(PDFName.of("Lang"))?.toString()).toBe("(en-CA)");
    expect(doc.catalog.has(PDFName.of("StructTreeRoot"))).toBe(true);
    expect(doc.catalog.lookup(PDFName.of("OutputIntents"), PDFArray).size()).toBe(1);
    expect(doc.context.trailerInfo.ID).toBeDefined();
    const link = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).lookup(0, PDFDict);
    expect(link.get(PDFName.of("Contents"))).toBeDefined();

    if (hasVerapdf) {
      expect(verapdf(result.pdf, "2u")).toEqual({ compliant: true, failed: [] });
      expect(verapdf(result.pdf, "ua1")).toEqual({ compliant: true, failed: [] });
    }
  });

  it("claims PDF/A for an overlay whose source embeds its fonts", async () => {
    const result = await applyConformance(await overlay("moraine-oh-row-bond"), {
      pdfa: "2b",
      pdfua: false,
      lang: "en",
      title: "Bond",
    });
    expect(result).toMatchObject({ pdfa: "2b", warnings: [] });
    if (hasVerapdf) expect(verapdf(result.pdf, "2b")).toEqual({ compliant: true, failed: [] });
  });

  it.each([
    ["phoenix-az-permit-bond", "fonts it doesn't embed (Helvetica, ZapfDingbats)"],
    ["castle-pines-co-row-permit-bond", "file attachments"],
  ])("refuses the PDF/A claim when %s has %s", async (name, reason) => {
    const result = await applyConformance(await overlay(name), {
      pdfa: "2b",
      pdfua: false,
      lang: "en",
      title: "Bond",
    });
    expect(result.pdfa).toBeNull();
    expect(result.warnings).toEqual([`Not PDF/A: the source PDF has ${reason}`]);
  });
});
