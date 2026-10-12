import type {
  AcroField,
  CreateTemplateInput,
  FieldSection,
  OverlayBoxInput,
  PdfPage,
  v1GenerateSchema,
  v1RenderSchema,
} from "@necodoc/shared";
import type { z } from "zod";

// Spec: docs/features/performance-benchmark.md (what's measured). The documents and data the
// benchmark renders: representative insurance paperwork, not a worst case.

export type RenderBody = z.input<typeof v1RenderSchema>;
export type GenerateBody = z.input<typeof v1GenerateSchema>;

/** The two surety bond fixtures: one with AcroForm fields, one flat scan-style PDF. */
export const FIXTURES = {
  acroform: "fixtures/pdfs/surety-bonds/phoenix-az-permit-bond.pdf",
  flat: "fixtures/pdfs/surety-bonds/rockville-md-row-performance-bond-llc.pdf",
} as const;

// ---------------------------------------------------------------------------------------------
// HTML to PDF

export const simpleRender: RenderBody = {
  html: `<h1>Certificate of insurance</h1>
<p>Issued to <strong>{{ holder }}</strong> on {{ issued | date }}.</p>
<p>This certificate is issued as a matter of information only and confers no rights upon the
certificate holder. It does not amend, extend or alter the coverage afforded by the policies below.</p>
<table><tr><th>Policy</th><th>Limit</th></tr>
{% for p in policies %}<tr><td>{{ p.name }}</td><td>{{ p.limit | currency }}</td></tr>{% endfor %}</table>`,
  css: "body { font-family: 'Noto Sans', sans-serif; font-size: 11pt; } table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid #ccc; padding: 4px; text-align: left; }",
  data: {
    holder: "Harbour Construction Ltd.",
    issued: "2026-10-12",
    policies: [
      { name: "General liability", limit: 2_000_000 },
      { name: "Automobile liability", limit: 1_000_000 },
      { name: "Umbrella", limit: 5_000_000 },
    ],
  },
  filename: "certificate",
};

const invoiceLines = Array.from({ length: 44 }, (_, i) => ({
  item: `Premium instalment ${i + 1}: commercial property, location ${(i % 9) + 1}`,
  qty: (i % 4) + 1,
  rate: 125 + ((i * 37) % 400),
}));

/** About three Letter pages: a table of 44 lines with a header and footer band on each page. */
export const invoiceRender: RenderBody = {
  html: `<h1>Invoice {{ invoice_no }}</h1>
<p>Bill to: <strong>{{ customer }}</strong><br>{{ address }}</p>
<p>Policy {{ policy_no }}, term {{ start | date }} to {{ end | date }}.</p>
<table>
<thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
<tbody>
{% for line in lines %}<tr><td>{{ forloop.index }}</td><td>{{ line.item }}</td><td>{{ line.qty }}</td><td>{{ line.rate | currency }}</td><td>{{ line.qty | times: line.rate | currency }}</td></tr>
{% endfor %}</tbody></table>
<h2>Terms</h2>
{% for t in terms %}<p>{{ t }}</p>{% endfor %}`,
  css: "body { font-family: 'Noto Serif', serif; font-size: 10.5pt; } table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid #ddd; padding: 5px 4px; text-align: left; } thead { display: table-header-group; } tr { break-inside: avoid; }",
  header: {
    html: "<div style=\"font: 9pt 'Noto Sans'; border-bottom: 1px solid #999; padding-bottom: 2mm\">Harbour Surety · Invoice {{ invoice_no }}</div>",
    firstPageHtml:
      "<div style=\"font: bold 14pt 'Noto Sans'\">Harbour Surety</div><div style=\"font: 9pt 'Noto Sans'\">100 Harbour St, Toronto ON</div>",
    height: 14,
  },
  footer: {
    html: "<div style=\"font: 8pt 'Noto Sans'; text-align: right\">{{ customer }} · page {{ page }} of {{ pages }}</div>",
    height: 10,
  },
  page: { size: "Letter", margins: { top: 25, right: 18, bottom: 20, left: 18 } },
  data: {
    invoice_no: "INV-2026-10481",
    customer: "Northshore Logistics Inc.",
    address: "4400 Lakeshore Rd, Burlington ON",
    policy_no: "CP-883120",
    start: "2026-11-01",
    end: "2027-10-31",
    lines: invoiceLines,
    terms: Array.from(
      { length: 6 },
      (_, i) =>
        `${i + 1}. Payment is due within 30 days of the invoice date. Late payments may result in cancellation of coverage under the policy's cancellation provisions, with notice as the governing statute requires.`,
    ),
  },
  filename: "invoice",
};

/** The invoice with PDF/A-2b and PDF/UA finishing. */
export const archivalInvoiceRender: RenderBody = {
  ...invoiceRender,
  output: { pdfa: "2b", pdfua: true, certify: false, lang: "en" },
};

// ---------------------------------------------------------------------------------------------
// Surety bond fields, shared by the designed and overlay templates

const bondTypes = ["license_permit", "performance", "payment"] as const;

const bondSections = (conditional: boolean): FieldSection[] => [
  {
    title: "Principal",
    fields: [
      { type: "text", key: "principal_name", label: "Principal", required: true },
      { type: "long_text", key: "principal_address", label: "Address", required: true },
      { type: "text", key: "obligee_name", label: "Obligee", required: true },
      { type: "text", key: "surety_name", label: "Surety", required: true },
      { type: "text", key: "attorney_in_fact", label: "Attorney-in-fact", required: false },
    ],
  },
  {
    title: "Bond",
    fields: [
      { type: "text", key: "bond_number", label: "Bond number", required: true },
      { type: "number", key: "bond_amount", label: "Penal sum", required: true, decimals: 2 },
      { type: "date", key: "effective_date", label: "Effective date", required: true },
      {
        type: "choice",
        key: "bond_type",
        label: "Bond type",
        required: true,
        multiple: false,
        options: [
          { value: "license_permit", label: "License or permit" },
          { value: "performance", label: "Performance" },
          { value: "payment", label: "Payment" },
        ],
      },
    ],
  },
  ...(conditional
    ? ([
        {
          title: "Contract",
          showIf: { field: "bond_type", op: "one_of", values: ["performance", "payment"] },
          fields: [
            { type: "long_text", key: "project_description", label: "Project", required: true },
            { type: "number", key: "contract_amount", label: "Contract price", required: true },
          ],
        },
        {
          title: "Co-principals",
          fields: [
            { type: "boolean", key: "has_co_principals", label: "Co-principals?", required: false },
            {
              type: "group",
              key: "co_principals",
              label: "Co-principals",
              required: false,
              showIf: { field: "has_co_principals", op: "equals", value: true },
              fields: [
                { type: "text", key: "name", label: "Name", required: true },
                { type: "text", key: "address", label: "Address", required: false },
              ],
            },
          ],
        },
      ] satisfies FieldSection[])
    : []),
];

/** Row `i` of the bond data: every third bond is a license bond (no contract section). */
export function bondRow(i: number) {
  const type = bondTypes[i % bondTypes.length] ?? "performance";
  const contract = type !== "license_permit";
  const coPrincipals = i % 2 === 0;
  return {
    principal_name: `Principal ${i + 1} Contracting LLC`,
    principal_address: `${100 + i} Industrial Pkwy\nSuite ${(i % 40) + 1}\nPhoenix AZ 85001`,
    obligee_name: "City of Phoenix",
    surety_name: "Harbour Surety Company",
    attorney_in_fact: "J. Alvarez",
    bond_number: `HS-${String(100_000 + i)}`,
    bond_amount: 25_000 + (i % 20) * 5_000,
    effective_date: "2026-11-01",
    bond_type: type,
    ...(contract
      ? {
          project_description: `Right-of-way restoration and paving, phase ${(i % 5) + 1}, including curbs, gutters and sidewalks along the corridor.`,
          contract_amount: 400_000 + (i % 30) * 10_000,
        }
      : {}),
    has_co_principals: coPrincipals,
    ...(coPrincipals
      ? {
          co_principals: [
            { name: `Partner A${i}`, address: "1 Main St" },
            { name: `Partner B${i}`, address: "2 Main St" },
          ],
        }
      : {}),
  };
}

const bondBody = `<h1 class="title">{% if bond_type == "license_permit" %}License or Permit Bond{% elsif bond_type == "performance" %}Performance Bond{% else %}Payment Bond{% endif %}</h1>
<p class="no">Bond No. {{ bond_number }}</p>
<p>KNOW ALL PERSONS BY THESE PRESENTS, that <strong>{{ principal_name }}</strong>, of
{{ principal_address | newline_to_br }}, as Principal, and <strong>{{ surety_name }}</strong>, a
corporation authorized to transact surety business, as Surety, are held and firmly bound unto
<strong>{{ obligee_name }}</strong>, as Obligee, in the penal sum of
<strong>{{ bond_amount | currency }}</strong>, for the payment of which the Principal and Surety
bind themselves, their heirs, executors, administrators, successors and assigns, jointly and
severally, firmly by these presents.</p>
{% if has_co_principals %}<h2>Co-principals</h2><ul>{% for p in co_principals %}<li>{{ p.name }}, {{ p.address }}</li>{% endfor %}</ul>{% endif %}
{% if bond_type == "license_permit" %}
<h2>Conditions</h2>
<p>WHEREAS the Principal has applied for a license or permit from the Obligee, and is required to
furnish a bond conditioned that the Principal will comply with all ordinances, rules and
regulations governing the work performed under it.</p>
{% else %}
<h2>The contract</h2>
<p>WHEREAS the Principal has entered into a written contract with the Obligee for
{{ project_description }}, in the amount of {{ contract_amount | currency }}, which contract is
made a part of this bond as if fully set forth herein.</p>
{% if bond_type == "performance" %}
<p>NOW, THEREFORE, the condition of this obligation is such that if the Principal shall promptly
and faithfully perform the contract, then this obligation shall be void; otherwise it shall remain
in full force and effect.</p>
{% else %}
<p>NOW, THEREFORE, the condition of this obligation is such that if the Principal shall promptly
make payment to all claimants supplying labor or material in the prosecution of the work, then this
obligation shall be void; otherwise it shall remain in full force and effect.</p>
{% endif %}
{% endif %}
<h2>General provisions</h2>
{% for n in (1..8) %}<p>{{ n }}. The Surety's liability shall not exceed the penal sum. No suit or
action shall be commenced hereunder after the expiration of one year from the date on which final
payment under the contract falls due. Notice to the Surety shall be given in writing to its office.</p>{% endfor %}
<p>Signed, sealed and dated {{ effective_date | date }}.</p>
<div class="sigs"><div>Principal: {{ principal_name }}<br><br>By: ______________________</div>
<div>Surety: {{ surety_name }}<br><br>By: {{ attorney_in_fact }}, Attorney-in-fact</div></div>`;

export const designedBondTemplate: CreateTemplateInput = {
  kind: "designed",
  name: "Bench surety bond",
  sections: bondSections(true),
  sampleData: bondRow(1),
  page: { size: "Letter", margins: { top: 22, right: 20, bottom: 20, left: 20 } },
  content: {
    mode: "code",
    body: bondBody,
    header: null,
    footer: {
      html: "<div style=\"font: 8pt 'Noto Sans'; display: flex; justify-content: space-between\"><span>Bond No. {{ bond_number }}</span><span>Page {{ page }} of {{ pages }}</span></div>",
      height: 10,
    },
    css: "body { font-family: 'Noto Serif', serif; font-size: 11pt; line-height: 1.4; } .title { text-align: center; } .no { text-align: center; } .sigs { display: flex; gap: 20mm; margin-top: 12mm; } .sigs > div { flex: 1; }",
  },
};

// ---------------------------------------------------------------------------------------------
// Overlay templates

const overlayKeys = [
  "principal_name",
  "principal_address",
  "obligee_name",
  "surety_name",
  "attorney_in_fact",
  "bond_number",
  "bond_amount",
  "effective_date",
] as const;

/** Every AcroForm text field filled, cycling through the bond fields. */
export function acroformOverlay(sourceId: string, fields: AcroField[]): CreateTemplateInput {
  const boxes: OverlayBoxInput[] = fields
    .filter((f) => f.type === "text" && !f.readOnly)
    .map((f, i) => ({
      type: "text",
      id: `a${i}`,
      page: f.page,
      rect: f.rect,
      acroField: f.name,
      value: `{{ ${overlayKeys[i % overlayKeys.length]} }}`,
    }));
  return overlayTemplate("Bench overlay (AcroForm)", sourceId, boxes);
}

/** Eight text boxes and a QR code drawn on every page of a flat PDF. */
export function flatOverlay(sourceId: string, pages: PdfPage[]): CreateTemplateInput {
  const boxes: OverlayBoxInput[] = pages.flatMap((p, pageIndex) => {
    const [x1, , , y2] = p.view;
    const page = pageIndex + 1;
    const text: OverlayBoxInput[] = overlayKeys.map((key, i) => ({
      type: "text",
      id: `p${page}t${i}`,
      page,
      rect: { x: x1 + 72, y: y2 - 120 - i * 22, width: 260, height: 14 },
      value: `{{ ${key} }}`,
    }));
    const qr: OverlayBoxInput = {
      type: "qrcode",
      id: `p${page}qr`,
      page,
      rect: { x: x1 + 470, y: y2 - 140, width: 64, height: 64 },
      value: "{{ bond_number }}",
    };
    return [...text, qr];
  });
  return overlayTemplate("Bench overlay (flat)", sourceId, boxes);
}

const overlayTemplate = (
  name: string,
  sourceId: string,
  boxes: OverlayBoxInput[],
): CreateTemplateInput => ({
  kind: "overlay",
  name,
  sections: bondSections(false),
  sampleData: bondRow(1),
  content: { sourceId, boxes, flatten: false },
});

/** Overlay data: the bond row without the designed template's conditional parts. */
export function overlayRow(i: number) {
  const row = bondRow(i);
  return { ...Object.fromEntries(overlayKeys.map((k) => [k, row[k]])), bond_type: row.bond_type };
}
