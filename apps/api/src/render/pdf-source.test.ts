import { readdirSync, readFileSync } from "node:fs";
import { PDFBool, PDFDocument, PDFName, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { inspectUpload, loadSourcePdf, PdfUploadError } from "./pdf-source";
import { openPdfjs, pdfjs } from "./pdfjs";

// ADR 0027: every surety bond fixture, including the four encrypted with an empty password, must
// load, take new content, save unencrypted, and keep its pages, text, vectors and fields.

const dir = new URL("../../../../fixtures/pdfs/surety-bonds/", import.meta.url);
const fixtures = readdirSync(dir).filter((name) => name.endsWith(".pdf"));
const encrypted = [
  "ca-dmv-ol25b-motorcycle-dealer-bond.pdf",
  "ny-dmv-vs3-dealer-bond.pdf",
  "sc-dmv-dla1b-dealer-bond.pdf",
  "university-place-wa-street-use-bond.pdf",
];
const PROBE = "NECODOC-PROBE-123";

/** What pdf.js sees: text and operator count per page, widgets, encryption. */
async function inspect(bytes: Uint8Array) {
  const doc = await openPdfjs(bytes);
  const pages: { text: string; ops: number }[] = [];
  let widgets = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join("")
      .replace(/\s+/g, "");
    const ops = (await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }))
      .fnArray.length;
    const annotations: { subtype?: unknown }[] = await page.getAnnotations();
    widgets += annotations.filter((a) => a.subtype === "Widget").length;
    pages.push({ text, ops });
  }
  const { info } = await doc.getMetadata();
  await doc.loadingTask.destroy();
  return { pages, widgets, info: info as { EncryptFilterName?: string | null } };
}

describe("surety bond fixtures", () => {
  it("has all 11", () => expect(fixtures).toHaveLength(11));

  it.each(fixtures)("%s stamps and saves without losing anything", async (name) => {
    const source = new Uint8Array(readFileSync(new URL(name, dir)));
    const before = await inspect(source);
    const doc = await loadSourcePdf(source);
    expect(doc.context.isDecrypted).toBe(encrypted.includes(name));
    const fieldCount = doc.getForm().getFields().length;
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(0).drawText(PROBE, { x: 40, y: 20, size: 10, font, color: rgb(1, 0, 0) });
    const saved = new Uint8Array(await doc.save());

    const after = await inspect(saved);
    expect(after.pages).toHaveLength(before.pages.length);
    expect(after.pages[0]?.text).toContain(PROBE);
    after.pages.forEach((page, i) => {
      const original = before.pages[i];
      expect(page.text.replace(PROBE, "")).toBe(original?.text);
      if (i === 0) expect(page.ops).toBeGreaterThan(original?.ops ?? 0);
      else expect(page.ops).toBe(original?.ops);
    });
    expect(after.widgets).toBe(before.widgets);
    expect(after.info.EncryptFilterName ?? null).toBeNull();
    // Opens without any options: the output isn't encrypted.
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.context.trailerInfo.Encrypt).toBeUndefined();
    expect(reloaded.getForm().getFields()).toHaveLength(fieldCount);
  });
});

describe("inspectUpload", () => {
  it.each(fixtures)("accepts %s", async (name) => {
    const result = await inspectUpload(new Uint8Array(readFileSync(new URL(name, dir))));
    expect(result.encrypted).toBe(encrypted.includes(name));
    expect(result.pages.length).toBeGreaterThan(0);
  });

  it("reads AcroForm fields", async () => {
    const counts: Record<string, number> = {};
    for (const name of fixtures) {
      const { fields } = await inspectUpload(new Uint8Array(readFileSync(new URL(name, dir))));
      counts[name] = fields.filter((f) => f.type !== "button").length;
    }
    expect(counts["or-ccb-commercial-contractor-bond.pdf"]).toBe(15);
    expect(counts["phoenix-az-permit-bond.pdf"]).toBe(35);
    expect(counts["ct-dmv-k158-dealer-bond.pdf"]).toBe(3);
    expect(counts["castle-pines-co-row-permit-bond.pdf"]).toBe(0);
  });

  it("refuses a PDF that needs a password", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "secret", ownerPassword: "owner" });
    await expect(inspectUpload(new Uint8Array(await doc.save()))).rejects.toThrow(
      /needs a password/,
    );
  });

  it("refuses a pure XFA form and accepts a hybrid one", async () => {
    /** An AcroForm with an XFA packet, with or without a real field. */
    async function xfaPdf(withField: boolean) {
      const doc = await PDFDocument.create();
      doc.addPage();
      const form = doc.getForm();
      if (withField) form.createTextField("name").addToPage(doc.getPage(0));
      form.acroForm.dict.set(
        PDFName.of("XFA"),
        doc.context.flateStream("<xdp:xdp xmlns:xdp='http://ns.adobe.com/xdp/'/>"),
      );
      doc.catalog.set(PDFName.of("NeedsRendering"), PDFBool.True);
      // Saving with appearance updates calls getForm(), which would strip the XFA again.
      return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
    }
    await expect(inspectUpload(await xfaPdf(false))).rejects.toThrow(/XFA form/);
    expect((await inspectUpload(await xfaPdf(true))).xfa).toBe(true);
  });

  it("refuses something that isn't a PDF", async () => {
    await expect(inspectUpload(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(
      PdfUploadError,
    );
  });
});
