import { z } from "zod";
import { fieldKeySchema } from "./fields";

// Spec: docs/features/signing-packages.md. ADR 0033: who signs a document and where, and the
// package a generation hands to an e-sign provider. necodoc never runs the signing itself.

export const signingKinds = [
  "signature",
  "initials",
  "date_signed",
  "full_name",
  /** Free text the signer fills in. */
  "text",
] as const;
export const signingKindSchema = z.enum(signingKinds);
export type SigningKind = z.infer<typeof signingKindSchema>;

export const signingKindLabels: Record<SigningKind, string> = {
  signature: "Signature",
  initials: "Initials",
  date_signed: "Date signed",
  full_name: "Full name",
  text: "Signer text",
};

/** A signer as a template or an HTML request declares it. Name and email are Liquid. */
export const signerSchema = z.object({
  id: fieldKeySchema,
  role: z.string().trim().min(1, "Enter a role").max(100),
  /** Providers send to lower orders first; equal orders sign in parallel. */
  routingOrder: z.int().min(1).max(100).default(1),
  name: z.string().max(1000).default(""),
  email: z.string().max(1000).default(""),
});
export type Signer = z.infer<typeof signerSchema>;
export type SignerInput = z.input<typeof signerSchema>;

export const signersSchema = z
  .array(signerSchema)
  .max(50)
  .superRefine((signers, ctx) => {
    const seen = new Set<string>();
    signers.forEach((signer, i) => {
      if (seen.has(signer.id))
        ctx.addIssue({ code: "custom", message: "Duplicate signer id", path: [i, "id"] });
      seen.add(signer.id);
    });
  });

// ---------------------------------------------------------------------------------------------
// The package a generation stores

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type SigningRect = z.infer<typeof rectSchema>;

export const signingBoxSchema = z
  .object({
    /** Unique within the package. */
    id: z.string(),
    signerId: z.string(),
    kind: signingKindSchema,
    required: z.boolean(),
    /** 1-based. */
    page: z.int().min(1),
    rect: rectSchema.meta({
      description: "PDF points in the page's user space, origin bottom-left (what pdf-lib uses).",
    }),
    topLeft: rectSchema.meta({
      description:
        "Points (pixels at 72 dpi) from the top-left of the page as displayed (DocuSign, Dropbox Sign, Adobe Sign).",
    }),
    normalized: rectSchema.meta({
      description: "Fractions (0..1) of the displayed page, origin top-left.",
    }),
    anchorString: z.string().nullable().meta({
      description:
        "Invisible text at the box's top-left corner, for anchor-based tab placement. Null when the PDF has none.",
    }),
  })
  .meta({ id: "SigningBox" });
export type SigningBox = z.infer<typeof signingBoxSchema>;

export const resolvedSignerSchema = signerSchema
  .extend({ routingOrder: z.int(), name: z.string(), email: z.string() })
  .meta({ id: "Signer", description: "A signer, with name and email rendered from the data." });
export type ResolvedSigner = z.infer<typeof resolvedSignerSchema>;

export const signingPackageSchema = z.object({
  signers: z.array(resolvedSignerSchema),
  boxes: z.array(signingBoxSchema),
  /** Each page as displayed, in points. */
  pages: z.array(z.object({ width: z.number(), height: z.number() })),
  /** The PDF still contains the anchor strings. */
  anchors: z.boolean(),
  warnings: z.array(z.string()),
});
export type SigningPackage = z.infer<typeof signingPackageSchema>;

/** How a request asks for a package: keep the anchor text in the PDF (default) or not. */
export const signingRenderOptionsSchema = z.object({ anchors: z.boolean().default(true) });

// ---------------------------------------------------------------------------------------------
// Geometry

type PageView = {
  /** The visible area (crop box) in user space: [x1, y1, x2, y2]. */
  view: readonly [number, number, number, number];
  rotate: 0 | 90 | 180 | 270;
};

/** The page as displayed: crop box size, swapped on quarter turns. */
export function displayedSize({ view, rotate }: PageView) {
  const width = view[2] - view[0];
  const height = view[3] - view[1];
  return rotate % 180 ? { width: height, height: width } : { width, height };
}

/**
 * A user-space rect (origin bottom-left, unrotated) as the reader sees it: top-left origin on
 * the displayed page, plus fractions of it. /Rotate turns the page clockwise for display.
 */
export function displayedRect(rect: SigningRect, page: PageView) {
  const [x1, y1, x2, y2] = page.view;
  const left = rect.x - x1;
  const right = x2 - (rect.x + rect.width);
  const bottom = rect.y - y1;
  const top = y2 - (rect.y + rect.height);
  const { width, height } = page.rotate % 180 ? { width: rect.height, height: rect.width } : rect;
  const [x, y] =
    page.rotate === 90
      ? [bottom, left]
      : page.rotate === 180
        ? [right, bottom]
        : page.rotate === 270
          ? [top, right]
          : [left, top];
  const size = displayedSize(page);
  return {
    topLeft: { x, y, width, height },
    normalized: {
      x: x / size.width,
      y: y / size.height,
      width: width / size.width,
      height: height / size.height,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Provider formats (sources in ADR 0033). Each is built from the package alone, so a stored
// package always gives the same JSON. necodoc calls none of these providers.

export const signingFormats = ["docusign", "dropbox_sign", "adobe_sign"] as const;
export const signingFormatSchema = z.enum(signingFormats);
export type SigningFormat = z.infer<typeof signingFormatSchema>;

/** How DocuSign tabs are placed: page coordinates, or the anchor strings in the PDF. */
export const tabPlacementSchema = z.enum(["position", "anchor"]);
export type TabPlacement = z.infer<typeof tabPlacementSchema>;

/** DocuSign takes every tab property as a string. */
type DocusignTab = Record<string, string>;
export type DocusignTabs = Partial<
  Record<
    "signHereTabs" | "initialHereTabs" | "dateSignedTabs" | "fullNameTabs" | "textTabs",
    DocusignTab[]
  >
>;
export type DocusignEnvelope = {
  emailSubject: string;
  status: "created";
  documents: {
    documentId: string;
    name: string;
    fileExtension: "pdf";
    documentBase64?: string;
  }[];
  recipients: {
    signers: {
      recipientId: string;
      routingOrder: string;
      name: string;
      email: string;
      roleName: string;
      tabs: DocusignTabs;
    }[];
  };
};

const docusignTabKey = {
  signature: "signHereTabs",
  initials: "initialHereTabs",
  date_signed: "dateSignedTabs",
  full_name: "fullNameTabs",
  text: "textTabs",
} as const satisfies Record<SigningKind, keyof DocusignTabs>;

const int = (n: number) => String(Math.round(n));

function docusignTab(box: SigningBox, placement: TabPlacement): DocusignTab {
  // Sign Here and Initial Here size themselves (scaleValue only) and hang from an anchor by their
  // bottom-left corner; the other tabs take a size and hang by their top-left.
  const sized = box.kind !== "signature" && box.kind !== "initials";
  const where: DocusignTab =
    placement === "anchor" && box.anchorString
      ? {
          anchorString: box.anchorString,
          anchorUnits: "pixels",
          anchorXOffset: "0",
          anchorYOffset: sized ? "0" : int(box.topLeft.height),
          anchorMatchWholeWord: "true",
          anchorIgnoreIfNotPresent: "false",
        }
      : {
          documentId: "1",
          pageNumber: String(box.page),
          xPosition: int(box.topLeft.x),
          yPosition: int(box.topLeft.y),
        };
  return {
    ...where,
    tabLabel: box.id,
    ...(sized ? { width: int(box.topLeft.width), height: int(box.topLeft.height) } : {}),
    ...(box.kind === "text"
      ? { required: String(box.required) }
      : sized
        ? {}
        : { optional: String(!box.required) }),
  };
}

/** Signers in signing order; equal orders keep the template's order. */
const bySigningOrder = (signers: readonly ResolvedSigner[]) =>
  [...signers].sort((a, b) => a.routingOrder - b.routingOrder);

/** A DocuSign eSignature v2.1 envelope definition, created as a draft (`status: "created"`). */
export function docusignEnvelope(
  pkg: SigningPackage,
  document: { name: string; base64?: string },
  placement: TabPlacement,
): DocusignEnvelope {
  const signers = bySigningOrder(pkg.signers).map((signer, i) => {
    const tabs: DocusignTabs = {};
    for (const box of pkg.boxes.filter((b) => b.signerId === signer.id)) {
      const key = docusignTabKey[box.kind];
      tabs[key] = [...(tabs[key] ?? []), docusignTab(box, placement)];
    }
    return {
      recipientId: String(i + 1),
      routingOrder: String(signer.routingOrder),
      name: signer.name,
      email: signer.email,
      roleName: signer.role,
      tabs,
    };
  });
  return {
    emailSubject: `Please sign: ${document.name}`.slice(0, 100),
    status: "created",
    documents: [
      {
        documentId: "1",
        name: document.name,
        fileExtension: "pdf",
        ...(document.base64 ? { documentBase64: document.base64 } : {}),
      },
    ],
    recipients: { signers },
  };
}

export type DropboxSignRequest = {
  signers: { name: string; email_address: string; order: number }[];
  form_fields_per_document: {
    document_index: 0;
    api_id: string;
    name: string;
    type: "signature" | "initials" | "date_signed" | "text";
    required: boolean;
    signer: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
};

/**
 * Dropbox Sign `signers` and `form_fields_per_document` for /signature_request/send. With `page`
 * set, x/y are 72 dpi from the top-left; width and height stay in its 80 dpi system. It has no
 * full-name field, so those are text fields the signer fills.
 */
export function dropboxSignRequest(pkg: SigningPackage): DropboxSignRequest {
  const signers = bySigningOrder(pkg.signers);
  const toDpi80 = (points: number) => Math.round((points * 80) / 72);
  return {
    signers: signers.map((s, order) => ({ name: s.name, email_address: s.email, order })),
    form_fields_per_document: pkg.boxes.map((box) => ({
      document_index: 0,
      api_id: box.id,
      name: signingKindLabels[box.kind],
      type: box.kind === "full_name" ? "text" : box.kind,
      required: box.required,
      signer: signers.findIndex((s) => s.id === box.signerId),
      page: box.page,
      x: Math.round(box.topLeft.x),
      y: Math.round(box.topLeft.y),
      width: toDpi80(box.topLeft.width),
      height: toDpi80(box.topLeft.height),
    })),
  };
}

export type AdobeSignAgreement = {
  participantSetsInfo: {
    role: "SIGNER";
    order: number;
    memberInfos: { email: string; name: string }[];
  }[];
  formFields: {
    fields: {
      name: string;
      inputType: "SIGNATURE" | "TEXT_FIELD";
      contentType: "SIGNATURE" | "SIGNER_INITIALS" | "SIGNATURE_DATE" | "SIGNER_NAME" | "DATA";
      required: boolean;
      /** The signer id: swap in the participant set id Adobe assigns it. */
      assignee: string;
      locations: { pageNumber: number; top: number; left: number; width: number; height: number }[];
    }[];
  };
};

const adobeTypes = {
  signature: ["SIGNATURE", "SIGNATURE"],
  initials: ["SIGNATURE", "SIGNER_INITIALS"],
  date_signed: ["TEXT_FIELD", "SIGNATURE_DATE"],
  full_name: ["TEXT_FIELD", "SIGNER_NAME"],
  text: ["TEXT_FIELD", "DATA"],
} as const satisfies Record<
  SigningKind,
  readonly [
    AdobeSignAgreement["formFields"]["fields"][number]["inputType"],
    AdobeSignAgreement["formFields"]["fields"][number]["contentType"],
  ]
>;

/**
 * Adobe Acrobat Sign v6: `participantSetsInfo` for POST /agreements (orders made consecutive from
 * 1) and the body of PUT /agreements/{id}/formFields. Locations are points with `top` measured
 * from the bottom of the page.
 */
export function adobeSignAgreement(pkg: SigningPackage): AdobeSignAgreement {
  const orders = [...new Set(pkg.signers.map((s) => s.routingOrder))].sort((a, b) => a - b);
  return {
    participantSetsInfo: bySigningOrder(pkg.signers).map((s) => ({
      role: "SIGNER",
      order: orders.indexOf(s.routingOrder) + 1,
      memberInfos: [{ email: s.email, name: s.name }],
    })),
    formFields: {
      fields: pkg.boxes.map((box) => {
        const [inputType, contentType] = adobeTypes[box.kind];
        const pageHeight = pkg.pages[box.page - 1]?.height ?? 0;
        return {
          name: box.id,
          inputType,
          contentType,
          required: box.required,
          assignee: box.signerId,
          locations: [
            {
              pageNumber: box.page,
              top: Math.round((pageHeight - box.topLeft.y) * 100) / 100,
              left: box.topLeft.x,
              width: box.topLeft.width,
              height: box.topLeft.height,
            },
          ],
        };
      }),
    },
  };
}

/** What `signing` asks of a public render or generate call, and of GET signing-package. */
export const signingOptionsSchema = z.object({
  formats: z
    .array(signingFormatSchema)
    .default(["docusign"])
    .meta({ description: "Provider JSON to include." }),
  anchors: z.boolean().default(true).meta({
    description: "Keep the invisible anchor text in the PDF. `false` costs one more Chromium pass.",
  }),
  embedPdf: z.boolean().default(true).meta({
    description: "Put the PDF in provider JSON as base64 (DocuSign `documentBase64`).",
  }),
  placement: tabPlacementSchema
    .default("position")
    .meta({ description: "DocuSign tabs by page coordinates, or by anchor string." }),
});
export type SigningOptions = z.infer<typeof signingOptionsSchema>;

export const signingRequestSchema = z.union([z.literal(true), signingOptionsSchema]).meta({
  id: "SigningOptions",
  description:
    "Answer with a signing package (JSON) instead of the PDF. `true`: DocuSign JSON, anchors kept, PDF embedded.",
});

/** `signing: true` means every option at its default. */
export const signingOptionsOf = (request: z.infer<typeof signingRequestSchema>): SigningOptions =>
  request === true ? signingOptionsSchema.parse({}) : request;
