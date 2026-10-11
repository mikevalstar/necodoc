import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adobeSignAgreement,
  displayedRect,
  docusignEnvelope,
  dropboxSignRequest,
  type SigningPackage,
} from "./signing";

// DocuSign eSignature v2.1 envelope definition, as documented (ADR 0033 sources): every tab
// property is a string; positions are 72 dpi from the page's top-left; Sign Here takes no size.
const str = z.string();
const intString = z.string().regex(/^-?\d+$/);
const boolString = z.enum(["true", "false"]);
const positioned = {
  documentId: intString,
  pageNumber: intString,
  xPosition: intString,
  yPosition: intString,
};
const anchored = {
  anchorString: str.min(1),
  anchorUnits: z.enum(["pixels", "inches", "mms", "cms"]),
  anchorXOffset: intString,
  anchorYOffset: intString,
  anchorMatchWholeWord: boolString,
  anchorIgnoreIfNotPresent: boolString,
};
const placed = <T extends z.ZodRawShape>(extra: T) =>
  z.union([
    z.strictObject({ ...positioned, tabLabel: str, ...extra }),
    z.strictObject({ ...anchored, tabLabel: str, ...extra }),
  ]);
const sized = { width: intString, height: intString };
const docusignSchema = z.strictObject({
  emailSubject: str.max(100),
  status: z.enum(["created", "sent"]),
  documents: z.array(
    z.strictObject({
      documentId: intString,
      name: str,
      fileExtension: str,
      documentBase64: z.base64().optional(),
    }),
  ),
  recipients: z.strictObject({
    signers: z.array(
      z.strictObject({
        recipientId: intString,
        routingOrder: intString,
        name: str,
        email: str,
        roleName: str,
        tabs: z.strictObject({
          signHereTabs: z.array(placed({ optional: boolString })).optional(),
          initialHereTabs: z.array(placed({ optional: boolString })).optional(),
          dateSignedTabs: z.array(placed(sized)).optional(),
          fullNameTabs: z.array(placed(sized)).optional(),
          textTabs: z.array(placed({ ...sized, required: boolString })).optional(),
        }),
      }),
    ),
  }),
});

const rect = { x: 0, y: 0, width: 0, height: 0 };
const pkg: SigningPackage = {
  signers: [
    { id: "surety", role: "Surety", routingOrder: 2, name: "Acme Surety", email: "s@x.test" },
    { id: "principal", role: "Principal", routingOrder: 1, name: "Pat", email: "p@x.test" },
  ],
  boxes: [
    {
      id: "s1",
      signerId: "principal",
      kind: "signature",
      required: true,
      page: 1,
      rect: { x: 72, y: 100, width: 200, height: 36 },
      topLeft: { x: 72, y: 656, width: 200, height: 36 },
      normalized: rect,
      anchorString: "~sig1~",
    },
    {
      id: "s2",
      signerId: "principal",
      kind: "date_signed",
      required: true,
      page: 1,
      rect,
      topLeft: { x: 300, y: 670, width: 100.4, height: 20 },
      normalized: rect,
      anchorString: "~sig2~",
    },
    {
      id: "b3",
      signerId: "surety",
      kind: "text",
      required: false,
      page: 2,
      rect,
      topLeft: { x: 72, y: 100, width: 150, height: 18 },
      normalized: rect,
      anchorString: null,
    },
  ],
  pages: [
    { width: 612, height: 792 },
    { width: 612, height: 792 },
  ],
  anchors: true,
  warnings: [],
};

describe("docusignEnvelope", () => {
  it("matches DocuSign's envelope shape, by position", () => {
    const envelope = docusignEnvelope(pkg, { name: "bond.pdf", base64: "JVBERi0=" }, "position");
    expect(docusignSchema.parse(envelope)).toEqual(envelope);
    const [principal, surety] = envelope.recipients.signers;
    expect([principal?.name, principal?.recipientId, surety?.routingOrder]).toEqual([
      "Pat",
      "1",
      "2",
    ]);
    expect(principal?.tabs.signHereTabs).toEqual([
      {
        documentId: "1",
        pageNumber: "1",
        xPosition: "72",
        yPosition: "656",
        tabLabel: "s1",
        optional: "false",
      },
    ]);
    expect(principal?.tabs.dateSignedTabs?.[0]).toMatchObject({ width: "100", height: "20" });
    expect(surety?.tabs.textTabs?.[0]).toMatchObject({ pageNumber: "2", required: "false" });
  });

  it("places tabs by anchor where the PDF has one, dropping a Sign Here by its height", () => {
    const envelope = docusignEnvelope(pkg, { name: "bond.pdf" }, "anchor");
    expect(docusignSchema.parse(envelope)).toEqual(envelope);
    expect(envelope.documents[0]).not.toHaveProperty("documentBase64");
    const [principal, surety] = envelope.recipients.signers;
    expect(principal?.tabs.signHereTabs?.[0]).toMatchObject({
      anchorString: "~sig1~",
      anchorYOffset: "36",
    });
    expect(principal?.tabs.dateSignedTabs?.[0]).toMatchObject({ anchorYOffset: "0" });
    // No anchor in an overlay box: it keeps its coordinates.
    expect(surety?.tabs.textTabs?.[0]).toHaveProperty("xPosition", "72");
  });
});

describe("other providers", () => {
  it("Dropbox Sign: signer indexes in signing order, sizes in its 80 dpi system", () => {
    const request = dropboxSignRequest(pkg);
    expect(request.signers.map((s) => s.email_address)).toEqual(["p@x.test", "s@x.test"]);
    expect(request.form_fields_per_document[0]).toEqual({
      document_index: 0,
      api_id: "s1",
      name: "Signature",
      type: "signature",
      required: true,
      signer: 0,
      page: 1,
      x: 72,
      y: 656,
      width: 222,
      height: 40,
    });
    expect(request.form_fields_per_document[2]?.signer).toBe(1);
  });

  it("Adobe Sign: consecutive orders, top measured from the bottom of the page", () => {
    const agreement = adobeSignAgreement(pkg);
    expect(agreement.participantSetsInfo.map((p) => p.order)).toEqual([1, 2]);
    expect(agreement.formFields.fields[0]).toMatchObject({
      inputType: "SIGNATURE",
      contentType: "SIGNATURE",
      assignee: "principal",
      locations: [{ pageNumber: 1, top: 136, left: 72, width: 200, height: 36 }],
    });
    expect(agreement.formFields.fields[1]?.contentType).toBe("SIGNATURE_DATE");
  });
});

describe("displayedRect", () => {
  // A Letter page with a crop box offset by (10, 20); a 100 x 20 box 50 pt in from the left
  // and 30 pt up from the bottom of the crop box.
  const view = [10, 20, 622, 812] as const;
  const r = { x: 60, y: 50, width: 100, height: 20 };

  it("measures from the top-left of the crop box", () => {
    expect(displayedRect(r, { view, rotate: 0 }).topLeft).toEqual({
      x: 50,
      y: 792 - 30 - 20,
      width: 100,
      height: 20,
    });
  });

  it("turns with the page", () => {
    // Clockwise: the bottom edge becomes the left, the left edge the top.
    expect(displayedRect(r, { view, rotate: 90 }).topLeft).toEqual({
      x: 30,
      y: 50,
      width: 20,
      height: 100,
    });
    expect(displayedRect(r, { view, rotate: 180 }).topLeft).toEqual({
      x: 612 - 50 - 100,
      y: 30,
      width: 100,
      height: 20,
    });
    expect(displayedRect(r, { view, rotate: 270 }).topLeft).toEqual({
      x: 792 - 30 - 20,
      y: 612 - 50 - 100,
      width: 20,
      height: 100,
    });
    expect(displayedRect(r, { view, rotate: 90 }).normalized.x).toBeCloseTo(30 / 792);
  });
});
