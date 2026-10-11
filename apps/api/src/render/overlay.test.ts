import { readFileSync } from "node:fs";
import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import {
  importAcroFields,
  type OverlayBoxInput,
  overlayBoxSchema,
  sampleTemplateData,
} from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { renderOverlay } from "./overlay";
import { inspectUpload } from "./pdf-source";
import { openPdfjs } from "./pdfjs";

// Spec: docs/features/pdf-overlay-templates.md. AcroForm import and fill on the fillable
// surety bond fixtures, and drawn text (Unicode, auto-shrink, rotation) on generated pages.

const dir = new URL("../../../../fixtures/pdfs/surety-bonds/", import.meta.url);
const read = (name: string) => new Uint8Array(readFileSync(new URL(`${name}.pdf`, dir)));
const noAssets = async () => null;

async function pageText(pdf: Uint8Array) {
  const doc = await openPdfjs(pdf);
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items;
    texts.push(items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await doc.loadingTask.destroy();
  return texts.join("\n");
}

const fillable: [string, number][] = [
  ["or-ccb-commercial-contractor-bond", 15],
  ["phoenix-az-permit-bond", 35],
  ["ct-dmv-k158-dealer-bond", 3],
  ["ny-dmv-vs3-dealer-bond", 15],
  ["ca-dmv-ol25b-motorcycle-dealer-bond", 15],
  ["sc-dmv-dla1b-dealer-bond", 12],
  ["university-place-wa-street-use-bond", 27],
];

describe("AcroForm import", () => {
  it.each(fillable)("%s imports %i fields and fills them by name", async (name, count) => {
    const bytes = read(name);
    const source = await inspectUpload(bytes);
    const imported = importAcroFields(source.fields, [], []);
    expect(imported.added).toBe(count);
    const keys = imported.sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    // Importing again adds nothing: every field is mapped.
    expect(importAcroFields(source.fields, imported.sections, imported.boxes).added).toBe(0);

    const data = sampleTemplateData(imported.sections);
    const result = await renderOverlay(
      {
        kind: "overlay",
        sourceId: "x",
        boxes: imported.boxes,
        flatten: true,
        data,
        preview: false,
      },
      async () => bytes,
      noAssets,
    );
    expect(result.warnings).toEqual([]);
    const out = await PDFDocument.load(result.pdf);
    expect(out.getForm().getFields()).toHaveLength(0);
    const text = await pageText(result.pdf);
    const firstText = imported.sections[0]?.fields.find((f) => f.type === "text");
    if (firstText) expect(text).toContain(`Sample ${firstText.label}`.slice(0, 12));
  });

  it("keeps fields editable without flatten", async () => {
    const bytes = read("or-ccb-commercial-contractor-bond");
    const source = await inspectUpload(bytes);
    const imported = importAcroFields(source.fields, [], []);
    const result = await renderOverlay(
      {
        kind: "overlay",
        sourceId: "x",
        boxes: imported.boxes,
        flatten: false,
        data: { name: "Zoë Łukasz" },
        preview: false,
      },
      async () => bytes,
      noAssets,
    );
    const field = (await PDFDocument.load(result.pdf)).getForm().getTextField("Name");
    expect(field.getText()).toBe("Zoë Łukasz");
  });
});

async function blankPdf(rotation = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.setRotation(degrees(rotation));
  return new Uint8Array(await doc.save());
}

const box = (input: Partial<OverlayBoxInput> & Pick<OverlayBoxInput, "value">) =>
  overlayBoxSchema.parse({
    type: "text",
    id: Math.random().toString(36),
    page: 1,
    rect: { x: 72, y: 600, width: 300, height: 20 },
    ...input,
  });

describe("drawn boxes", () => {
  it("draws accents, Polish, Greek and Cyrillic", async () => {
    const bytes = await blankPdf();
    const value = "Zoë Łukasz Ωμέγα Привет";
    const result = await renderOverlay(
      {
        kind: "overlay",
        sourceId: "x",
        boxes: [box({ value: "{{ name }}" })],
        flatten: false,
        data: { name: value },
        preview: false,
      },
      async () => bytes,
      noAssets,
    );
    expect(result.warnings).toEqual([]);
    // Each script comes from its own font subset; pdf.js reads the runs apart.
    expect((await pageText(result.pdf)).replace(/\s+/g, "")).toContain(value.replace(/\s+/g, ""));
  });

  it("doesn't HTML-escape values", async () => {
    const bytes = await blankPdf();
    const result = await renderOverlay(
      {
        kind: "overlay",
        sourceId: "x",
        boxes: [box({ value: "{{ a }}" })],
        flatten: false,
        data: { a: "Smith & Sons <LLC>" },
        preview: false,
      },
      async () => bytes,
      noAssets,
    );
    expect(await pageText(result.pdf)).toContain("Smith & Sons <LLC>");
  });

  it("shrinks long text, and cuts it with a warning past the minimum", async () => {
    const bytes = await blankPdf();
    const narrow = { x: 72, y: 600, width: 80, height: 14 };
    const result = await renderOverlay(
      {
        kind: "overlay",
        sourceId: "x",
        boxes: [
          box({ value: "Fits after shrinking", rect: narrow }),
          box({
            value: "This is far too long to fit in a narrow box at all",
            rect: { ...narrow, y: 500 },
          }),
        ],
        flatten: false,
        data: {},
        preview: false,
      },
      async () => bytes,
      noAssets,
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/cut to fit/);
    expect(await pageText(result.pdf)).toContain("Fits after shrinking");
  });

  it("draws checkboxes, QR codes and barcodes", async () => {
    const bytes = await blankPdf(90);
    const result = await renderOverlay(
      {
        kind: "overlay",
        sourceId: "x",
        boxes: [
          box({
            type: "checkbox",
            value: "{{ agree }}",
            rect: { x: 72, y: 72, width: 12, height: 12 },
          }),
          box({
            type: "qrcode",
            value: "https://example.com",
            rect: { x: 100, y: 100, width: 60, height: 60 },
          }),
          box({
            type: "barcode",
            value: "ABC-123",
            rect: { x: 200, y: 100, width: 150, height: 40 },
          }),
          // Rotated 90°: tall in user space reads as wide on screen.
          box({
            value: "Upright on a rotated page",
            rect: { x: 400, y: 300, width: 20, height: 300 },
          }),
        ],
        flatten: false,
        data: { agree: true },
        preview: false,
      },
      async () => bytes,
      noAssets,
    );
    expect(result.warnings).toEqual([]);
    expect(await pageText(result.pdf)).toContain("Upright on a rotated page");
  });
});
