import fontkit from "@cantoo/fontkit";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import {
  type AcroField,
  MAX_OVERLAY_PAGES,
  type PdfPage,
  pageRotationSchema,
} from "@necodoc/shared";
import { z } from "zod";
import { openPdfjs, type PdfjsDocument } from "./pdfjs";

// Spec: docs/features/pdf-overlay-templates.md (upload). ADR 0027: uploads encrypted with an
// empty password load with password '' through our pdf-lib patch; real passwords are refused.
// ADR 0028: page boxes and AcroForm fields are read here, with pdf.js.

/** A reason to refuse an upload, worded for the person uploading it. */
export class PdfUploadError extends Error {}

/** An uploaded PDF, ready to fill: decrypted (if it had an empty password), fontkit registered. */
export async function loadSourcePdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { password: "", updateMetadata: false });
  doc.registerFontkit(fontkit);
  return doc;
}

const n = z.number();
/** The parts of a pdf.js widget annotation we read; pdf.js types annotations as `any`. */
const widgetSchema = z.object({
  subtype: z.literal("Widget"),
  fieldName: z.string(),
  fieldType: z.string().nullish(),
  rect: z.tuple([n, n, n, n]),
  alternativeText: z.string().nullish(),
  multiLine: z.boolean().nullish(),
  maxLen: z.number().nullish(),
  checkBox: z.boolean().nullish(),
  radioButton: z.boolean().nullish(),
  pushButton: z.boolean().nullish(),
  buttonValue: z.string().nullish(),
  options: z.array(z.object({ exportValue: z.string().nullish() })).nullish(),
  readOnly: z.boolean().nullish(),
  hidden: z.boolean().nullish(),
});
type Widget = z.infer<typeof widgetSchema>;

function fieldType(w: Widget): AcroField["type"] {
  switch (w.fieldType) {
    case "Tx":
      return "text";
    case "Ch":
      return "choice";
    case "Sig":
      return "signature";
    default:
      return w.checkBox ? "checkbox" : w.radioButton ? "radio" : "button";
  }
}

/** One entry per field, at its first widget; radio groups collect their export values. */
async function acroFields(doc: PdfjsDocument): Promise<AcroField[]> {
  const fields = new Map<string, AcroField>();
  for (let page = 1; page <= doc.numPages; page++) {
    const annotations: unknown[] = await (await doc.getPage(page)).getAnnotations();
    for (const annotation of annotations) {
      const parsed = widgetSchema.safeParse(annotation);
      if (!parsed.success || !parsed.data.fieldName) continue;
      const w = parsed.data;
      const existing = fields.get(w.fieldName);
      if (existing) {
        if (w.buttonValue && !existing.options.includes(w.buttonValue)) {
          existing.options.push(w.buttonValue);
        }
        continue;
      }
      const [x1, y1, x2, y2] = w.rect;
      const type = fieldType(w);
      fields.set(w.fieldName, {
        name: w.fieldName,
        type,
        page,
        rect: {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.max(Math.abs(x2 - x1), 1),
          height: Math.max(Math.abs(y2 - y1), 1),
        },
        ...(w.alternativeText?.trim() ? { label: w.alternativeText.trim() } : {}),
        multiline: Boolean(w.multiLine),
        ...(w.maxLen ? { maxLength: w.maxLen } : {}),
        options:
          type === "choice"
            ? (w.options ?? []).flatMap((o) => (o.exportValue ? [o.exportValue] : []))
            : type === "radio" && w.buttonValue
              ? [w.buttonValue]
              : [],
        readOnly: Boolean(w.readOnly),
      });
    }
  }
  return [...fields.values()];
}

const tooBig = `PDFs are limited to ${MAX_OVERLAY_PAGES} pages`;

/**
 * Checks an upload can be filled, and reads its pages and AcroForm fields. Throws a
 * PdfUploadError saying why it can't.
 */
export async function inspectUpload(bytes: Uint8Array) {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new PdfUploadError("That file isn't a PDF");

  let doc: PdfjsDocument;
  try {
    doc = await openPdfjs(bytes);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PdfUploadError(
        "This PDF needs a password to open. Remove the password (for example, print it to a new PDF) and upload that.",
      );
    }
    throw new PdfUploadError("This PDF couldn't be read; it may be damaged");
  }
  try {
    if (doc.numPages > MAX_OVERLAY_PAGES) throw new PdfUploadError(tooBig);
    const pages: PdfPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [x1 = 0, y1 = 0, x2 = 612, y2 = 792] = page.view;
      const rotate = pageRotationSchema.safeParse(((page.rotate % 360) + 360) % 360);
      pages.push({ view: [x1, y1, x2, y2], rotate: rotate.success ? rotate.data : 0 });
    }
    const fields = await acroFields(doc);

    // The render path opens it with pdf-lib: it has to work there too.
    let filled: PDFDocument;
    try {
      filled = await loadSourcePdf(bytes);
    } catch {
      throw new PdfUploadError("This PDF opens, but its structure can't be edited for filling");
    }
    if (filled.getPageCount() !== pages.length) {
      throw new PdfUploadError("This PDF's page tree is damaged; re-save it and upload again");
    }
    // pdf.js only reports isPureXfa with XFA parsing on, which stays off for untrusted uploads,
    // and pdf-lib's getForm() strips the XFA packet, so read the AcroForm dict itself.
    // Pure XFA = an XFA packet with no AcroForm fields to fill.
    const acroForm = filled.catalog.getAcroForm();
    const xfa = acroForm?.dict.has(PDFName.of("XFA")) ?? false;
    if (xfa && !acroForm?.getAllFields().length) {
      throw new PdfUploadError(
        "This is an XFA form (made with Adobe LiveCycle). Its pages only exist as form data, so it can't be filled here. Save it as a standard PDF and upload that.",
      );
    }
    return {
      pages,
      fields,
      encrypted: filled.context.isDecrypted,
      xfa,
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}
