import {
  type CreateTemplateInput,
  contentTexts,
  type FieldSection,
  translatableStrings,
} from "@necodoc/shared";
import {
  bold,
  br,
  date,
  doc,
  each,
  field,
  h,
  lines,
  money,
  p,
  pa,
  snippet,
  table,
  td,
  th,
  tr,
  ul,
  when,
} from "./doc.ts";

// The designed templates the demo seed writes from scratch (docs/features/demo-data-and-screenshots.md).
// The surety bonds come from templates/*.json; these are the insurer's everyday documents.

export type Ids = { logo: string; theme: string; snippets: Record<"privacy" | "claims", string> };

type Designed = Extract<CreateTemplateInput, { kind: "designed" }>;

const letter = { size: "Letter" as const, orientation: "portrait" as const };
const margins = { top: 18, right: 18, bottom: 18, left: 18 };

const header = (ids: Ids, line: string) => ({
  height: 22,
  doc: doc(p(bold("Harbour Surety Company"), `  ·  ${line}`)),
  firstPage: doc(
    { type: "image", attrs: { assetId: ids.logo, alt: "Harbour Surety", width: 22 } },
    p(
      bold("Harbour Surety Company"),
      br,
      "181 Bay Street, Suite 2800, Toronto, ON M5J 2T3  ·  1-800-555-0137",
    ),
  ),
});

const footer = {
  height: 12,
  doc: doc(pa("right", "Page ", field("page"), " of ", field("pages"))),
  firstPage: null,
};

const css = [
  ".necodoc-band { display: flex; align-items: center; gap: 4mm; font-size: 8pt; color: #3f4668; }",
  ".necodoc-band img { height: 13mm; width: auto; }",
  ".necodoc-band p { margin: 0; flex: 1; }",
  "td p, th p { margin: 0; }",
].join("\n");

const output = { pdfa: null, pdfua: false, certify: false, lang: "en" };

// ---------------------------------------------------------------------------------------------
// Certificate of insurance

const coiSections: FieldSection[] = [
  {
    title: "Certificate",
    fields: [
      { type: "text", key: "certificate_number", label: "Certificate number", required: true },
      { type: "date", key: "issued_on", label: "Issued on", required: true },
      { type: "text", key: "broker_name", label: "Broker", required: false },
    ],
  },
  {
    title: "Insured",
    fields: [
      { type: "text", key: "insured_name", label: "Named insured", required: true },
      { type: "long_text", key: "insured_address", label: "Insured address", required: true },
      {
        type: "long_text",
        key: "operations",
        label: "Description of operations",
        help: "Location, project or vehicles this certificate is for.",
        required: false,
      },
    ],
  },
  {
    title: "Certificate holder",
    fields: [
      { type: "text", key: "holder_name", label: "Certificate holder", required: true },
      { type: "long_text", key: "holder_address", label: "Holder address", required: true },
      {
        type: "boolean",
        key: "additional_insured",
        label: "Holder is an additional insured",
        required: false,
        default: false,
      },
    ],
  },
  {
    title: "Coverage",
    fields: [
      {
        type: "group",
        key: "policies",
        label: "Policies",
        required: true,
        minItems: 1,
        fields: [
          {
            type: "choice",
            key: "coverage",
            label: "Coverage",
            required: true,
            multiple: false,
            options: [
              { value: "Commercial general liability", label: "Commercial general liability" },
              { value: "Automobile liability", label: "Automobile liability" },
              { value: "Umbrella liability", label: "Umbrella liability" },
              { value: "Property", label: "Property" },
              { value: "Contractor's equipment", label: "Contractor's equipment" },
            ],
          },
          { type: "text", key: "policy_number", label: "Policy number", required: true },
          { type: "date", key: "effective", label: "Effective", required: true },
          { type: "date", key: "expiry", label: "Expiry", required: true },
          { type: "number", key: "limit", label: "Limit (CAD)", required: true, min: 0 },
        ],
      },
      {
        type: "number",
        key: "cancellation_days",
        label: "Cancellation notice (days)",
        required: true,
        min: 0,
        default: 30,
      },
    ],
  },
];

export function certificateOfInsurance(ids: Ids): Designed {
  return {
    kind: "designed",
    name: "Certificate of Insurance",
    description:
      "Proof of coverage for a certificate holder: the insured's policies, limits and dates, with an optional additional-insured clause.",
    sections: coiSections,
    sampleData: {
      certificate_number: "COI-2026-018342",
      issued_on: "2026-10-06",
      broker_name: "Lakeshore Commercial Insurance Brokers",
      insured_name: "Northwind Construction Ltd.",
      insured_address: "1200 Harbour Street, Suite 400\nToronto, ON M5J 2T5",
      operations: "Watermain replacement, Main Street East between Ottawa St and Kenilworth Ave.",
      holder_name: "City of Hamilton, Public Works Department",
      holder_address: "71 Main Street West\nHamilton, ON L8P 4Y5",
      additional_insured: true,
      policies: [
        {
          coverage: "Commercial general liability",
          policy_number: "HS-CGL-104233",
          effective: "2026-04-01",
          expiry: "2027-04-01",
          limit: 5000000,
        },
        {
          coverage: "Automobile liability",
          policy_number: "HS-AUT-220871",
          effective: "2026-04-01",
          expiry: "2027-04-01",
          limit: 2000000,
        },
        {
          coverage: "Umbrella liability",
          policy_number: "HS-UMB-031156",
          effective: "2026-04-01",
          expiry: "2027-04-01",
          limit: 10000000,
        },
      ],
      cancellation_days: 30,
    },
    themeId: ids.theme,
    page: { ...letter, margins },
    content: {
      mode: "visual",
      header: header(ids, "Certificate of insurance"),
      footer,
      css,
      signers: [],
      output,
      translations: {},
      body: doc(
        h(1, "Certificate of Insurance", "center"),
        pa(
          "center",
          "Certificate ",
          field("certificate_number"),
          "  ·  Issued ",
          date("issued_on", "MMM D, YYYY"),
        ),
        table(
          tr([th("Named insured"), th("Certificate holder")]),
          tr([
            td(field("insured_name"), br, lines("insured_address")),
            td(field("holder_name"), br, lines("holder_address")),
          ]),
        ),
        when(
          { field: "operations", op: "is_set" },
          p(bold("Description of operations: "), field("operations")),
        ),
        h(2, "Policies in force"),
        table(
          tr([th("Coverage"), th("Policy number"), th("Effective"), th("Expiry"), th("Limit")]),
          tr(
            [
              td(field("policies.coverage")),
              td(field("policies.policy_number")),
              td(date("policies.effective", "YYYY-MM-DD")),
              td(date("policies.expiry", "YYYY-MM-DD")),
              td(money("policies.limit")),
            ],
            "policies",
          ),
        ),
        when(
          { field: "additional_insured", op: "equals", value: true },
          p(
            bold("Additional insured. "),
            field("holder_name"),
            " is included as an additional insured on the commercial general liability policy, but only with respect to liability arising out of the operations of the named insured described above.",
          ),
        ),
        pa(
          "justify",
          "This certificate is issued as a matter of information only and confers no rights upon the certificate holder. It does not amend, extend or alter the coverage afforded by the policies listed. Should any of these policies be cancelled before the expiry date, Harbour Surety Company will endeavour to mail ",
          field("cancellation_days"),
          " days' written notice to the certificate holder.",
        ),
        snippet(ids.snippets.privacy),
        p(br, "Authorized representative", br, field("broker_name")),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Commercial policy declarations, English with a fr-CA translation

const declarationsSections: FieldSection[] = [
  {
    title: "Policy",
    fields: [
      { type: "text", key: "policy_number", label: "Policy number", required: true },
      { type: "date", key: "period_start", label: "Policy period starts", required: true },
      { type: "date", key: "period_end", label: "Policy period ends", required: true },
      { type: "text", key: "broker_name", label: "Broker", required: false },
    ],
  },
  {
    title: "Named insured",
    fields: [
      { type: "text", key: "insured_name", label: "Named insured", required: true },
      { type: "long_text", key: "mailing_address", label: "Mailing address", required: true },
      { type: "text", key: "business", label: "Business description", required: true },
    ],
  },
  {
    title: "Coverages",
    fields: [
      {
        type: "group",
        key: "coverages",
        label: "Coverages",
        required: true,
        minItems: 1,
        fields: [
          { type: "text", key: "name", label: "Coverage", required: true },
          { type: "number", key: "limit", label: "Limit", required: true, min: 0 },
          { type: "number", key: "deductible", label: "Deductible", required: false, min: 0 },
          { type: "number", key: "premium", label: "Premium", required: true, min: 0 },
        ],
      },
      {
        type: "number",
        key: "total_premium",
        label: "Total annual premium",
        required: true,
        min: 0,
      },
      { type: "long_text", key: "endorsements", label: "Endorsements", required: false },
    ],
  },
];

const declarationsBody = doc(
  h(1, "Commercial Liability Declarations"),
  p("Policy number ", field("policy_number")),
  table(
    tr([th("Named insured"), th("Policy period")]),
    tr([
      td(field("insured_name"), br, lines("mailing_address")),
      td(
        "From ",
        date("period_start", "LL"),
        br,
        "to ",
        date("period_end", "LL"),
        br,
        "12:01 a.m. standard time at the mailing address",
      ),
    ]),
  ),
  p(bold("Business: "), field("business")),
  h(2, "Coverages and limits"),
  table(
    tr([th("Coverage"), th("Limit"), th("Deductible"), th("Premium")]),
    tr(
      [
        td(field("coverages.name")),
        td(money("coverages.limit")),
        td(money("coverages.deductible")),
        td(money("coverages.premium")),
      ],
      "coverages",
    ),
  ),
  pa("right", bold("Total annual premium: "), money("total_premium")),
  when({ field: "endorsements", op: "is_set" }, h(2, "Endorsements"), p(lines("endorsements"))),
  h(2, "Conditions"),
  ul(
    ["The insurance applies only to the locations and operations described in this policy."],
    ["Premium is payable in full at inception unless an instalment plan is shown."],
    ["Report every claim to Harbour Surety Company as soon as practicable."],
  ),
  pa(
    "justify",
    "These declarations, together with the policy wording, endorsements and the application, form the contract of insurance. Please read them carefully and tell your broker about anything that is incorrect.",
  ),
  p("Broker: ", field("broker_name")),
);

/** fr-CA for every string the declarations can translate; the seed checks none is missing. */
const declarationsFr: Record<string, string> = {
  Policy: "Police",
  "Policy number": "Numéro de police",
  "Policy period starts": "Début de la période d'assurance",
  "Policy period ends": "Fin de la période d'assurance",
  Broker: "Courtier",
  "Broker:": "Courtier :",
  "Named insured": "Assuré désigné",
  "Mailing address": "Adresse postale",
  "Business description": "Description de l'entreprise",
  Coverages: "Garanties",
  Coverage: "Garantie",
  Limit: "Montant de garantie",
  Deductible: "Franchise",
  Premium: "Prime",
  "Total annual premium": "Prime annuelle totale",
  "Total annual premium:": "Prime annuelle totale :",
  Endorsements: "Avenants",
  "Commercial Liability Declarations":
    "Conditions particulières, responsabilité civile commerciale",
  "Policy period": "Période d'assurance",
  From: "Du",
  to: "au",
  "12:01 a.m. standard time at the mailing address": "0 h 01, heure normale à l'adresse postale",
  "Business:": "Entreprise :",
  "Coverages and limits": "Garanties et montants",
  Conditions: "Conditions",
  "The insurance applies only to the locations and operations described in this policy.":
    "L'assurance ne s'applique qu'aux lieux et aux activités décrits dans la présente police.",
  "Premium is payable in full at inception unless an instalment plan is shown.":
    "La prime est payable en entier à la prise d'effet, sauf si un plan de versements est indiqué.",
  "Report every claim to Harbour Surety Company as soon as practicable.":
    "Déclarez tout sinistre à Harbour Surety Company dès que possible.",
  "These declarations, together with the policy wording, endorsements and the application, form the contract of insurance. Please read them carefully and tell your broker about anything that is incorrect.":
    "Les présentes conditions particulières, avec le libellé de la police, les avenants et la proposition, constituent le contrat d'assurance. Lisez-les attentivement et signalez toute erreur à votre courtier.",
  "Harbour Surety Company": "Harbour Surety Company",
  "Commercial liability declarations": "Conditions particulières",
  "181 Bay Street, Suite 2800, Toronto, ON M5J 2T3  ·  1-800-555-0137":
    "181, rue Bay, bureau 2800, Toronto (Ontario) M5J 2T3  ·  1-800-555-0137",
  "·  Commercial liability declarations": "·  Conditions particulières",
  Page: "Page",
  of: "de",
};

/** `french: false` is the first release, before the fr-CA translation. */
export function policyDeclarations(ids: Ids, { french }: { french: boolean }): Designed {
  const content = {
    mode: "visual" as const,
    header: header(ids, "Commercial liability declarations"),
    footer,
    css,
    signers: [],
    output,
    translations: {} as Record<string, Record<string, string>>,
    body: declarationsBody,
  };
  const strings = translatableStrings(declarationsSections, contentTexts(content));
  const missing = strings.filter((s) => !(s in declarationsFr));
  if (missing.length) throw new Error(`Declarations: no fr-CA for ${JSON.stringify(missing)}`);
  if (french) {
    content.translations = {
      "fr-CA": Object.fromEntries(strings.map((s) => [s, declarationsFr[s] ?? s])),
    };
  }
  return {
    kind: "designed",
    name: "Commercial Policy Declarations",
    description:
      "Declarations page for a commercial liability policy: insured, period, coverages and premium. English, with a Canadian French translation for Québec insureds.",
    sections: declarationsSections,
    sampleData: {
      policy_number: "HS-CGL-104233",
      period_start: "2026-04-01",
      period_end: "2027-04-01",
      broker_name: "Lakeshore Commercial Insurance Brokers",
      insured_name: "Northwind Construction Ltd.",
      mailing_address: "1200 Harbour Street, Suite 400\nToronto, ON M5J 2T5",
      business: "Civil and municipal infrastructure contractor",
      coverages: [
        {
          name: "Bodily injury and property damage",
          limit: 5000000,
          deductible: 5000,
          premium: 18450,
        },
        {
          name: "Products and completed operations",
          limit: 5000000,
          deductible: 5000,
          premium: 4210,
        },
        { name: "Tenants' legal liability", limit: 500000, deductible: 2500, premium: 640 },
        { name: "Non-owned automobile", limit: 2000000, deductible: 0, premium: 380 },
      ],
      total_premium: 23680,
      endorsements:
        "Additional insured: City of Hamilton (blanket, where required by written contract)\nWaiver of subrogation: Province of Ontario",
    },
    themeId: ids.theme,
    page: { ...letter, margins },
    content,
  };
}

// ---------------------------------------------------------------------------------------------
// Claims acknowledgement letter

const claimsSections: FieldSection[] = [
  {
    title: "Claim",
    fields: [
      { type: "text", key: "claim_number", label: "Claim number", required: true },
      { type: "text", key: "policy_number", label: "Policy number", required: true },
      { type: "date", key: "loss_date", label: "Date of loss", required: true },
      { type: "long_text", key: "loss_description", label: "What happened", required: true },
      { type: "date", key: "letter_date", label: "Letter date", required: true },
    ],
  },
  {
    title: "Claimant",
    fields: [
      { type: "text", key: "claimant_name", label: "Claimant", required: true },
      { type: "long_text", key: "claimant_address", label: "Claimant address", required: true },
      { type: "email", key: "claimant_email", label: "Claimant email", required: false },
    ],
  },
  {
    title: "Adjuster",
    fields: [
      { type: "text", key: "adjuster_name", label: "Adjuster", required: true },
      { type: "text", key: "adjuster_phone", label: "Adjuster phone", required: true },
      { type: "email", key: "adjuster_email", label: "Adjuster email", required: true },
      {
        type: "group",
        key: "documents",
        label: "Documents we need",
        required: false,
        fields: [{ type: "text", key: "name", label: "Document", required: true }],
      },
    ],
  },
];

export function claimsAcknowledgement(ids: Ids): Designed {
  return {
    kind: "designed",
    name: "Claims Acknowledgement Letter",
    description:
      "Tells a claimant we have their claim, who their adjuster is, and which documents to send.",
    sections: claimsSections,
    sampleData: {
      claim_number: "CL-26-0048211",
      policy_number: "HS-CGL-104233",
      loss_date: "2026-09-28",
      loss_description:
        "Water damage to the ground floor of 48 Dundurn Street South after a watermain break during excavation.",
      letter_date: "2026-10-02",
      claimant_name: "Ruth Abernathy",
      claimant_address: "48 Dundurn Street South\nHamilton, ON L8P 4J9",
      claimant_email: "r.abernathy@mailbox.example",
      adjuster_name: "Daniel Osei",
      adjuster_phone: "1-800-555-0137 ext. 4412",
      adjuster_email: "dosei@harbour-surety.example",
      documents: [
        { name: "Photos of the damage, before any cleanup if you have them" },
        { name: "Receipts or estimates for repairs and emergency work" },
        { name: "Your home insurer's name and policy number" },
      ],
    },
    themeId: ids.theme,
    page: { ...letter, margins },
    content: {
      mode: "visual",
      header: header(ids, "Claims"),
      footer,
      css,
      signers: [],
      output,
      translations: {},
      body: doc(
        p(date("letter_date", "LL")),
        p(field("claimant_name"), br, lines("claimant_address")),
        p(bold("Re: claim "), field("claim_number"), bold(", policy "), field("policy_number")),
        p("Dear ", field("claimant_name"), ","),
        pa(
          "justify",
          "Thank you for reporting the loss of ",
          date("loss_date"),
          ". We have opened claim ",
          field("claim_number"),
          " and assigned it to ",
          field("adjuster_name"),
          ", who will contact you within two business days.",
        ),
        p(bold("What you told us: "), field("loss_description")),
        when(
          { field: "documents", op: "is_set" },
          p("To move your claim forward, please send us:"),
          each("documents", p("•  ", field("documents.name"))),
        ),
        snippet(ids.snippets.claims),
        p("Sincerely,"),
        p(field("adjuster_name"), br, "Claims adjuster, Harbour Surety Company"),
        snippet(ids.snippets.privacy),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Renewal notice (the month-end batch)

const renewalSections: FieldSection[] = [
  {
    title: "Policy",
    fields: [
      { type: "text", key: "policy_number", label: "Policy number", required: true },
      { type: "text", key: "insured_name", label: "Insured", required: true },
      { type: "long_text", key: "insured_address", label: "Insured address", required: true },
      { type: "date", key: "expiry_date", label: "Current policy expires", required: true },
    ],
  },
  {
    title: "Renewal terms",
    fields: [
      { type: "number", key: "current_premium", label: "Current premium", required: true, min: 0 },
      { type: "number", key: "renewal_premium", label: "Renewal premium", required: true, min: 0 },
      { type: "long_text", key: "changes", label: "What's changing", required: false },
      {
        type: "boolean",
        key: "pre_authorized",
        label: "Pays by pre-authorized debit",
        required: false,
        default: false,
      },
      { type: "date", key: "payment_due", label: "Payment due", required: true },
      { type: "text", key: "broker_name", label: "Broker", required: false },
    ],
  },
];

export function renewalNotice(ids: Ids): Designed {
  return {
    kind: "designed",
    name: "Renewal Notice",
    description:
      "Sent 60 days before expiry: the renewal premium, what changed, and how to pay. Generated in a batch at month end.",
    sections: renewalSections,
    sampleData: {
      policy_number: "HS-CGL-097781",
      insured_name: "Bayview Mechanical Inc.",
      insured_address: "55 Industrial Parkway North\nAurora, ON L4G 4C4",
      expiry_date: "2026-12-31",
      current_premium: 8420,
      renewal_premium: 8975,
      changes:
        "Products and completed operations limit raised to $5,000,000.\nCyber incident response endorsement added.",
      pre_authorized: false,
      payment_due: "2026-12-15",
      broker_name: "Lakeshore Commercial Insurance Brokers",
    },
    themeId: ids.theme,
    page: { ...letter, margins },
    content: {
      mode: "visual",
      header: header(ids, "Renewal notice"),
      footer,
      css,
      signers: [],
      output,
      translations: {},
      body: doc(
        h(1, "Your policy is up for renewal"),
        p(field("insured_name"), br, lines("insured_address")),
        p(
          "Policy ",
          field("policy_number"),
          " expires on ",
          date("expiry_date"),
          ". We are pleased to offer renewal on the terms below.",
        ),
        table(
          tr([th("Current premium"), th("Renewal premium")]),
          tr([td(money("current_premium")), td(money("renewal_premium"))]),
        ),
        when({ field: "changes", op: "is_set" }, h(2, "What's changing"), p(lines("changes"))),
        when(
          { field: "pre_authorized", op: "equals", value: true },
          p(
            "You pay by pre-authorized debit, so there is nothing to do: we will withdraw the renewal premium on ",
            date("payment_due"),
            ".",
          ),
        ),
        when(
          { field: "pre_authorized", op: "not_equals", value: true },
          p(
            "Please pay the renewal premium by ",
            date("payment_due"),
            " through your broker or at harbour-surety.example/pay, quoting your policy number.",
          ),
        ),
        p("Questions about your renewal? Contact ", field("broker_name"), "."),
        snippet(ids.snippets.privacy),
      ),
    },
  };
}
