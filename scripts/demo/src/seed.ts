import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CreateTemplateInput,
  createTemplateSchema,
  type UpdateTemplate,
} from "@necodoc/shared";
import { z } from "zod";
import { HttpError, ok, Session } from "./client.ts";
import { Clock } from "./clock.ts";
import {
  certificateOfInsurance,
  claimsAcknowledgement,
  type Ids,
  policyDeclarations,
  renewalNotice,
} from "./designed.ts";
import { field, p } from "./doc.ts";
import { type DocumentKind, documents, Rand } from "./fake.ts";
import {
  historyRow,
  insertGenerations,
  type Job,
  type KeyName,
  type Prototype,
  plan,
  RENDERED_DAYS,
  type Row,
  SHARE_LINK_DAYS,
  sampleBatchTimes,
  type Version,
  versionAt,
} from "./history.ts";
import { type Demo, demoDir, startDemo } from "./instance.ts";
import {
  DEMO_PASSWORD,
  type PersonKey,
  pendingPerson,
  people,
  serviceAccounts,
  systemAgent,
  systemIp,
} from "./people.ts";

// Spec: docs/features/demo-data-and-screenshots.md. `pnpm demo:seed` resets the demo database
// and tells Harbour Surety's story through the API, then fills in the generation history.

const fixtures = join(import.meta.dirname, "../../../fixtures/pdfs/surety-bonds");
const log = (message: string) =>
  console.log(`[demo ${new Date().toISOString().slice(11, 19)}] ${message}`);

/** The exported surety bond templates, by the document kind they make. */
const exported = {
  oregonBond: "oregon-contractor-license-bond",
  ontarioCertificate: "surety-bond-certificate-ontario",
  orCcb: "or-ccb-commercial-surety-bond",
  castlePines: "castle-pines-row-permit-bond",
  newHaven: "new-haven-row-bond",
  nyDmv: "ny-dmv-vs3-dealer-bond",
} as const;

function loadTemplate(
  slug: string,
  refs: { asset?: string; snippet?: string; source?: string },
): CreateTemplateInput {
  const raw = readFileSync(join(import.meta.dirname, "templates", `${slug}.json`), "utf8")
    .replaceAll("$asset:harbour-logo", refs.asset ?? "")
    .replaceAll("$snippet:surety-indemnity-clause", refs.snippet ?? "")
    .replace(/\$source:[\w.-]+/g, refs.source ?? "");
  return createTemplateSchema.parse(JSON.parse(raw));
}

type Template = { id: string; name: string; kind: DocumentKind | "newHaven" | "nyDmv" };

export async function seed(demo: Demo) {
  const sql = demo.db;
  const clock = new Clock(sql, new Date());
  const r = new Rand(20261012);
  const day = (n: number, hhmm: string) => clock.day(n, hhmm);
  const at = <T>(when: Date, act: () => Promise<T>) => clock.at(when, act);

  // People ------------------------------------------------------------------------------------
  const sessions = new Map<PersonKey, Session>();
  /** Signed in the first time they act, so the sign-in lands on that day. */
  const as = async (key: PersonKey) => {
    const found = sessions.get(key);
    if (found) return found;
    const session = await new Session(demo.apiUrl, demo.appUrl, people[key]).signIn(DEMO_PASSWORD);
    sessions.set(key, session);
    return session;
  };

  const jordan = await at(day(120, "09:05"), async () => {
    const session = new Session(demo.apiUrl, demo.appUrl, people.jordan);
    await session.auth("/sign-up/email", {
      name: people.jordan.name,
      email: people.jordan.email,
      password: DEMO_PASSWORD,
    });
    sessions.set("jordan", session);
    return session;
  });
  log("admin signed up");

  await at(day(120, "09:20"), async () => {
    await ok(jordan.api.system.retention.$put({ json: { outputDays: 14, inputDays: 30 } }));
  });

  const userIds = {} as Record<PersonKey, string>;
  userIds.jordan =
    (await sql<{ id: string }[]>`select id from "user" where email = ${people.jordan.email}`)[0]
      ?.id ?? "";
  await at(day(120, "09:40"), async () => {
    for (const [key, person] of Object.entries(people) as [
      PersonKey,
      (typeof people)[PersonKey],
    ][]) {
      if (key === "jordan") continue;
      const created = await jordan.auth<{ user: { id: string } }>("/admin/create-user", {
        email: person.email,
        password: DEMO_PASSWORD,
        name: person.name,
        role: person.roles,
      });
      userIds[key] = created.user.id;
    }
  });
  log("people created");

  const accounts = await at(day(119, "10:15"), async () => {
    const out = {} as Record<KeyName, string>;
    for (const [name, account] of Object.entries(serviceAccounts) as [
      KeyName,
      (typeof serviceAccounts)[KeyName],
    ][]) {
      const res = await ok(
        jordan.api["service-accounts"].$post({
          json: { ...account, roles: ["viewer"] },
        }),
      );
      out[name] = (await res.json()).id;
    }
    return out;
  });

  for (const [i, key] of (
    ["hannah", "tom", "aisha", "luc", "samuel", "marc", "elena"] as const
  ).entries()) {
    await at(
      day(119, `${13 + Math.floor(i / 3)}:${String(5 + (i % 3) * 17).padStart(2, "0")}`),
      () => as(key),
    );
  }

  // Look: logo, theme, snippets ---------------------------------------------------------------
  const priya = () => as("priya");
  const ids = await at(day(118, "14:00"), async () => {
    const pri = await priya();
    const logo = await (
      await ok(
        pri.api.assets.$post({
          form: {
            file: new File(
              [readFileSync(join(import.meta.dirname, "assets/harbour-logo.svg"))],
              "harbour-logo.svg",
              {
                type: "image/svg+xml",
              },
            ),
            name: "Harbour Surety logo",
          },
        }),
      )
    ).json();
    const theme = await (
      await ok(
        pri.api.themes.$post({
          json: {
            name: "Harbour Surety",
            settings: {
              font: "inter",
              fontSize: 10.5,
              lineHeight: 1.5,
              textColor: "#1c2338",
              accentColor: "#0d3b66",
              linkColor: "#0d3b66",
              headingFont: "inter",
              headingColor: "#0d3b66",
              h1Size: 20,
              h2Size: 13.5,
              h3Size: 11.5,
              tableBorderColor: "#c9d3e3",
              tableHeaderBackground: "#eef3fa",
              tableCellPadding: 2,
            },
            css: "h1 { letter-spacing: -0.01em; } th { text-align: left; }",
          },
        }),
      )
    ).json();
    return { logo: logo?.id ?? "", theme: theme?.id ?? "" };
  });

  const snippetIds = await at(day(118, "14:40"), async () => {
    const pri = await priya();
    const create = async (json: Parameters<typeof pri.api.snippets.$post>[0]["json"]) =>
      (await (await ok(pri.api.snippets.$post({ json }))).json()).id;
    return {
      privacy: await create({
        key: "privacy-notice",
        name: "Privacy notice",
        description: "Short privacy notice for customer-facing letters and certificates.",
        tags: ["legal", "customer"],
        fields: [],
        content: {
          mode: "visual",
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Harbour Surety Company collects, uses and discloses personal information to provide and administer insurance and surety products and to handle claims. Questions: privacy@harbour-surety.example.",
                    marks: [{ type: "italic" }],
                  },
                ],
              },
            ],
          },
        },
      }),
      claims: await create({
        key: "claims-contact",
        name: "Claims contact block",
        description: "How a claimant reaches their adjuster.",
        tags: ["claims"],
        fields: ["adjuster_name", "adjuster_phone", "adjuster_email"],
        content: {
          mode: "visual",
          doc: {
            type: "doc",
            content: [
              p(
                "You can reach ",
                field("adjuster_name"),
                " at ",
                field("adjuster_phone"),
                " or ",
                field("adjuster_email"),
                ", Monday to Friday, 8:30 a.m. to 5 p.m. Eastern.",
              ),
            ],
          },
        },
      }),
      indemnity: await create({
        key: "surety-indemnity-clause",
        name: "Surety indemnity clause",
        description: "Indemnity wording shared by the surety bond templates.",
        tags: ["surety", "legal"],
        fields: ["principal", "obligee", "surety_company", "bond_amount"],
        content: {
          mode: "visual",
          doc: {
            type: "doc",
            content: [
              p(
                "Indemnity. The Principal, ",
                field("principal"),
                ", agrees to indemnify and hold harmless ",
                field("obligee"),
                " and the Surety, ",
                field("surety_company"),
                ", against all loss up to the penal sum of ",
                field("bond_amount"),
                ".",
              ),
            ],
          },
        },
      }),
    };
  });
  const designedIds: Ids = {
    logo: ids.logo,
    theme: ids.theme,
    snippets: { privacy: snippetIds.privacy, claims: snippetIds.claims },
  };
  log("theme, logo and snippets");

  // Templates ---------------------------------------------------------------------------------
  const templates = new Map<string, Template>();
  const versions = new Map<string, Version[]>();

  const createTemplate = async (
    by: PersonKey,
    kind: Template["kind"],
    draft: CreateTemplateInput,
  ) => {
    const session = await as(by);
    const created = await (
      await ok(session.api.templates.$post({ json: draft }), draft.name)
    ).json();
    const template = { id: created.id, name: created.name, kind };
    templates.set(kind, template);
    versions.set(created.id, []);
    return template;
  };
  const upload = async (by: PersonKey, file: string) => {
    const session = await as(by);
    const res = await ok(
      session.api["pdf-sources"].$post({
        form: {
          file: new File([readFileSync(join(fixtures, file))], file, { type: "application/pdf" }),
        },
      }),
      file,
    );
    return (await res.json()).id;
  };
  const overlay = async (by: PersonKey, kind: Template["kind"], slug: string, file: string) =>
    createTemplate(by, kind, loadTemplate(slug, { source: await upload(by, file) }));
  const edit = async (by: PersonKey, template: Template, changes: UpdateTemplate) => {
    const session = await as(by);
    await ok(
      session.api.templates[":id"].$patch({ param: { id: template.id }, json: changes }),
      `edit ${template.name}`,
    );
  };
  const draftOf = async (template: Template) => {
    const res = await ok(jordan.api.templates[":id"].$get({ param: { id: template.id } }));
    return res.json();
  };
  const publish = async (by: PersonKey, template: Template, note: string) => {
    const session = await as(by);
    await ok(
      session.api.templates[":id"].publish.$post({ param: { id: template.id }, json: { note } }),
      `publish ${template.name}`,
    );
  };
  const submit = async (by: PersonKey, template: Template, note: string) => {
    const session = await as(by);
    const res = await ok(
      session.api.reviews.$post({ json: { templateId: template.id, note } }),
      `review ${template.name}`,
    );
    return must((await res.json())?.id, "review id");
  };
  const decide = async (
    by: PersonKey,
    reviewId: string,
    decision: "approve" | "request_changes",
    comment: string,
  ) => {
    const session = await as(by);
    await ok(
      session.api.reviews[":id"].decision.$post({
        param: { id: reviewId },
        json: decision === "approve" ? { decision, comment } : { decision, comment },
      }),
      "decision",
    );
  };
  const comment = async (by: PersonKey, reviewId: string, body: string) => {
    const session = await as(by);
    await ok(
      session.api.reviews[":id"].comments.$post({ param: { id: reviewId }, json: { body } }),
      "comment",
    );
  };
  /** After review became required: submit, approve, publish, each on its own time. */
  const release = async (
    template: Template,
    steps: {
      editor: PersonKey;
      publisher: PersonKey;
      note: string;
      submitted: Date;
      approved: Date;
      published: Date;
      approval?: string;
      change?: UpdateTemplate;
    },
  ) => {
    if (steps.change) {
      const change = steps.change;
      await at(new Date(steps.submitted.getTime() - 12 * 60_000), () =>
        edit(steps.editor, template, change),
      );
    }
    const reviewId = await at(steps.submitted, () => submit(steps.editor, template, steps.note));
    await at(steps.approved, () =>
      decide("marc", reviewId, "approve", steps.approval ?? "Looks right. Approved."),
    );
    await at(steps.published, () => publish(steps.publisher, template, steps.note));
  };

  const orCcb = await at(day(117, "10:05"), () =>
    overlay("elena", "orCcb", exported.orCcb, "or-ccb-commercial-contractor-bond.pdf"),
  );
  await at(day(115, "15:30"), () =>
    publish("priya", orCcb, "First release for the Portland branch"),
  );

  const ontario = await at(day(112, "10:20"), () =>
    createTemplate(
      "priya",
      "ontarioCertificate",
      loadTemplate(exported.ontarioCertificate, { asset: ids.logo, snippet: snippetIds.indemnity }),
    ),
  );
  await at(day(111, "16:00"), () =>
    publish("samuel", ontario, "Ontario municipal performance bonds"),
  );

  const oregon = await at(day(110, "13:00"), () =>
    createTemplate("priya", "oregonBond", loadTemplate(exported.oregonBond, {})),
  );
  await at(day(108, "11:10"), () => publish("priya", oregon, "First release"));

  const coi = certificateOfInsurance(designedIds);
  const claims = claimsAcknowledgement(designedIds);
  const renewal = renewalNotice(designedIds);
  const declarations = createTemplateSchema.parse(
    policyDeclarations(designedIds, { french: true }),
  );
  const declarationsTemplate = await at(day(105, "10:00"), () =>
    createTemplate("priya", "declarations", policyDeclarations(designedIds, { french: false })),
  );
  await at(day(103, "15:00"), () =>
    publish("samuel", declarationsTemplate, "Commercial liability declarations"),
  );

  const coiTemplate = await at(day(100, "14:00"), () =>
    createTemplate("elena", "certificate", {
      ...coi,
      // The first release had no umbrella row in its sample.
      sampleData: {
        ...coi.sampleData,
        policies: Array.isArray(coi.sampleData?.policies)
          ? coi.sampleData.policies.slice(0, 2)
          : [],
      },
    }),
  );
  await at(day(98, "10:30"), () =>
    publish("samuel", coiTemplate, "Certificates of insurance for the broker portal"),
  );

  await at(day(95, "11:00"), async () => {
    await edit("priya", ontario, {
      description: "Performance bond certificate with a schedule of covered contracts.",
    });
    await publish("priya", ontario, "Schedule of covered contracts");
  });

  const claimsTemplate = await at(day(90, "10:00"), () =>
    createTemplate("elena", "claims", claims),
  );
  await at(day(88, "14:00"), () =>
    publish("samuel", claimsTemplate, "Acknowledgement letters from claims intake"),
  );

  const renewalTemplate = await at(day(85, "09:30"), () =>
    createTemplate("priya", "renewal", {
      ...renewal,
      description: "Sent 60 days before expiry with the renewal premium.",
    }),
  );
  await at(day(84, "15:00"), () => publish("samuel", renewalTemplate, "Month-end renewal run"));

  const castle = await at(day(80, "10:00"), () =>
    overlay("elena", "castlePines", exported.castlePines, "castle-pines-co-row-permit-bond.pdf"),
  );
  await at(day(79, "11:45"), () => publish("priya", castle, "Castle Pines right-of-way permits"));

  await at(day(75, "14:10"), async () => {
    await edit("priya", orCcb, {
      description: `${(await draftOf(orCcb)).description} Signers go to e-signature.`,
    });
    await publish("priya", orCcb, "Signers for the e-signature handoff");
  });
  await at(day(70, "10:30"), async () => {
    await edit("priya", ontario, {
      description:
        "Performance bond certificate with a schedule of covered contracts and an optional rider.",
    });
    await publish("priya", ontario, "Rider clause");
  });
  await at(day(65, "09:50"), () =>
    overlay("elena", "newHaven", exported.newHaven, "new-haven-in-row-bond.pdf"),
  );
  await at(day(62, "13:30"), async () => {
    await edit("priya", declarationsTemplate, { content: declarations.content });
    await publish("samuel", declarationsTemplate, "Canadian French for Québec insureds");
  });
  log("first releases");

  // Governance from here on: review before publish.
  await at(day(60, "11:00"), async () => {
    await ok(
      jordan.api.system.publishing.$put({
        json: { requireReview: true, allowSelfApproval: false, blockOnFailingTests: false },
      }),
    );
  });
  await at(day(52, "15:20"), () =>
    overlay("elena", "nyDmv", exported.nyDmv, "ny-dmv-vs3-dealer-bond.pdf"),
  );

  await release(ontario, {
    editor: "priya",
    publisher: "samuel",
    note: "Bid bonds added to the bond types",
    change: {
      description:
        "Performance, payment and bid bond certificate with a schedule of covered contracts and an optional rider.",
    },
    submitted: day(50, "10:00"),
    approved: day(50, "14:20"),
    published: day(50, "15:05"),
  });

  await at(day(45, "09:40"), () =>
    edit("elena", coiTemplate, { sampleData: coi.sampleData, description: coi.description }),
  );
  await release(coiTemplate, {
    editor: "elena",
    publisher: "samuel",
    note: "Umbrella row and additional insured wording",
    submitted: day(45, "09:45"),
    approved: day(45, "11:30"),
    published: day(45, "13:10"),
    approval: "Additional insured wording matches the broker agreement.",
  });
  await at(day(44, "10:15"), async () => {
    const e = await as("elena");
    const copy = await (
      await ok(e.api.templates[":id"].duplicate.$post({ param: { id: coiTemplate.id } }))
    ).json();
    await edit(
      "elena",
      { ...coiTemplate, id: copy?.id ?? "" },
      { name: "Certificate of Insurance (2025 wording)" },
    );
    const s = await as("samuel");
    await ok(s.api.templates[":id"].archive.$post({ param: { id: copy?.id ?? "" } }));
  });

  // Test cases on the bond templates, then publishing blocks on failures.
  await at(day(42, "14:00"), async () => {
    const pri = await priya();
    const add = async (
      template: Template,
      name: string,
      data: Record<string, unknown>,
      assertions: Record<string, unknown>,
    ) =>
      ok(
        pri.api.templates[":id"].tests.$post({
          param: { id: template.id },
          json: { name, from: { kind: "data", data }, assertions },
        }),
        `test ${name}`,
      );
    const oregonSample = (await draftOf(oregon)).sampleData;
    await add(
      oregon,
      "Single principal",
      { ...oregonSample, has_co_principal: false },
      {
        pageCount: { op: "equals", value: 2 },
        contains: ["Oregon Contractor License Bond"],
        notContains: ["Co-principal"],
      },
    );
    await add(
      oregon,
      "With co-principal",
      { ...oregonSample, has_co_principal: true },
      {
        pageCount: { op: "at_most", value: 3 },
        contains: ["Whitfield Holdings Inc."],
      },
    );
    await add(orCcb, "Fills the board's form", (await draftOf(orCcb)).sampleData, {
      noTextCut: true,
      pageCount: { op: "equals", value: 2 },
    });
    const ontarioSample = (await draftOf(ontario)).sampleData;
    await add(ontario, "Four contracts with rider", ontarioSample, {
      contains: ["Schedule of covered contracts", "Rider"],
    });
    await add(
      ontario,
      "Without rider",
      { ...ontarioSample, include_rider: false },
      {
        notContains: ["Rider"],
      },
    );
    // Publishing blocks on these from tomorrow: they have to pass today.
    for (const template of [oregon, orCcb, ontario]) {
      const res = await ok(
        pri.api.templates[":id"].tests.run.$post({ param: { id: template.id }, json: {} }),
      );
      const failed = (await res.json()).results.filter((result) => !result.passed);
      if (failed.length) {
        throw new Error(`${template.name} tests fail: ${JSON.stringify(failed, null, 1)}`);
      }
    }
  });
  await at(day(41, "09:15"), async () => {
    await ok(
      jordan.api.system.publishing.$put({
        json: { requireReview: true, allowSelfApproval: false, blockOnFailingTests: true },
      }),
    );
  });

  // The Oregon bond's second version, with a round of changes requested.
  await at(day(40, "10:30"), async () =>
    edit("priya", oregon, {
      description: (await draftOf(oregon)).description.replace("A surety bond", "A license bond"),
    }),
  );
  const oregonReview = await at(day(40, "10:40"), () =>
    submit("priya", oregon, "Co-principal option for joint ventures"),
  );
  await at(day(40, "13:10"), () =>
    decide(
      "marc",
      oregonReview,
      "request_changes",
      "The co-principal needs its own signature block and title line, and the conditions should name both principals.",
    ),
  );
  await at(day(39, "09:35"), async () => {
    const draft = await draftOf(oregon);
    await edit("priya", oregon, {
      description: draft.description.replace("A license bond", "A surety bond"),
    });
  });
  await at(day(39, "09:40"), () =>
    submit(
      "priya",
      oregon,
      "Added the co-principal signature block and named both principals in the conditions.",
    ),
  );
  await at(day(39, "11:05"), () =>
    comment(
      "marc",
      oregonReview,
      "Checked both test cases; the three-page version reads correctly.",
    ),
  );
  await at(day(39, "11:15"), () =>
    decide("marc", oregonReview, "approve", "Approved for the Portland agents."),
  );
  await at(day(39, "13:00"), () =>
    publish("samuel", oregon, "Co-principal option for joint ventures"),
  );

  await at(day(33, "10:20"), () =>
    edit("priya", renewalTemplate, { description: renewal.description }),
  );
  await release(renewalTemplate, {
    editor: "priya",
    publisher: "samuel",
    note: "Pre-authorized debit wording",
    submitted: day(33, "10:25"),
    approved: day(33, "15:40"),
    published: day(32, "09:10"),
  });
  await at(day(30, "14:00"), async () => {
    const draft = await draftOf(orCcb);
    await edit("elena", orCcb, {
      sampleData: { ...draft.sampleData, agency_city_state_zip: "Portland, OR 97204-1214" },
    });
  });
  await release(orCcb, {
    editor: "elena",
    publisher: "priya",
    note: "Agency address lines split for the Portland office",
    submitted: day(30, "14:05"),
    approved: day(30, "16:20"),
    published: day(29, "10:00"),
  });
  await at(day(21, "11:00"), async () => {
    const draft = await draftOf(ontario);
    await edit("priya", ontario, {
      sampleData: { ...draft.sampleData, attorney_in_fact: "Margaret L. Chen" },
    });
  });
  await release(ontario, {
    editor: "priya",
    publisher: "samuel",
    note: "Indemnity clause from the snippet library",
    submitted: day(21, "11:05"),
    approved: day(21, "14:30"),
    published: day(21, "15:00"),
  });
  log("versions and reviews");

  // Keys and webhooks -------------------------------------------------------------------------
  const keys = {} as Record<KeyName, { id: string; key: string }>;
  const createKey = async (
    name: string,
    ownerId: string,
    scopes: (
      | "render:html"
      | "templates:read"
      | "templates:generate"
      | "batches:write"
      | "batches:read"
      | "generations:read"
    )[],
    extra: { expiresInDays?: number; ipAllowlist?: string[] } = {},
    by: Session = jordan,
  ) => {
    const res = await ok(
      by.api["api-keys"].$post({
        json: {
          name,
          ownerId,
          scopes,
          expiresInDays: extra.expiresInDays ?? null,
          ipAllowlist: extra.ipAllowlist ?? [],
          rateLimitPerMinute: 600,
        },
      }),
      `key ${name}`,
    );
    const created = await res.json();
    return { id: created.id, key: created.key };
  };
  /**
   * Inserted, not posted: the API resolves a webhook's host when it's created, and the demo's
   * hosts are .example ones that resolve nowhere. The audit entry is the one the API would write.
   */
  const webhook = async (hook: {
    url: string;
    events: string[];
    apiKeyId: string;
    ownerId: string;
    description: string;
  }) => {
    const [row] = await sql<{ id: string }[]>`
      insert into webhook (owner_id, url, description, secret, events, api_key_id, enabled, created_by)
      values (${hook.ownerId}, ${hook.url}, ${hook.description}, ${randomUUID().replaceAll("-", "")},
              ${sql.json(hook.events)}, ${hook.apiKeyId}, true, ${userIds.jordan})
      returning id`;
    await insertAudit(sql, {
      action: "webhook.created",
      actorKind: "user",
      actorId: userIds.jordan,
      actorName: people.jordan.name,
      targetType: "webhook",
      targetId: row?.id ?? null,
      targetName: hook.url,
      after: { ...hook, enabled: true },
      at: new Date(),
      ip: people.jordan.ip,
      userAgent: people.jordan.userAgent,
    });
  };
  await at(day(110, "09:30"), async () => {
    keys.policyAdmin = await createKey(
      "policy-admin-prod",
      accounts.policyAdmin,
      ["templates:read", "templates:generate", "render:html", "generations:read"],
      {
        ipAllowlist: ["10.60.0.0/24"],
      },
    );
  });
  const priyaKey = await at(day(100, "16:10"), async () =>
    createKey(
      "priya-local-testing",
      userIds.priya,
      ["templates:generate"],
      { expiresInDays: 30 },
      await priya(),
    ),
  );
  await at(day(95, "10:00"), async () => {
    await webhook({
      url: "https://hooks.harbour-surety.example/necodoc/generations",
      events: ["generation.succeeded", "generation.failed"],
      apiKeyId: keys.policyAdmin.id,
      ownerId: accounts.policyAdmin,
      description: "Policy admin: file the PDF against the policy",
    });
  });
  await at(day(90, "11:20"), async () => {
    keys.claims = await createKey(
      "claims-intake",
      accounts.claims,
      ["templates:generate", "generations:read"],
      { ipAllowlist: ["10.60.0.0/24"] },
    );
  });
  await at(day(84, "15:30"), async () => {
    keys.renewals = await createKey(
      "renewals-batch",
      accounts.renewals,
      ["batches:write", "batches:read", "templates:generate"],
      { ipAllowlist: ["10.60.0.0/24"] },
    );
    await webhook({
      url: "https://hooks.harbour-surety.example/necodoc/batches",
      events: ["batch.completed"],
      apiKeyId: keys.renewals.id,
      ownerId: accounts.renewals,
      description: "Renewals: release the mail run when a batch completes",
    });
  });
  await at(day(80, "10:40"), async () => {
    keys.brokerPortal = await createKey(
      "broker-portal",
      accounts.brokerPortal,
      ["templates:read", "templates:generate"],
      { expiresInDays: 90 },
    );
  });
  await at(day(70, "09:05"), async () => {
    const pri = await priya();
    await ok(pri.api["api-keys"][":id"].revoke.$post({ param: { id: priyaKey.id } }));
  });
  await at(day(30, "16:45"), async () => {
    const res = await ok(
      jordan.api["api-keys"][":id"].rotate.$post({
        param: { id: keys.policyAdmin.id },
        json: { overlapHours: 24 },
      }),
      "rotate",
    );
    const rotated = await res.json();
    keys.policyAdmin = { id: rotated.id, key: rotated.key };
  });
  await at(day(21, "16:00"), async () => {
    // Moved to the event bus; the hooks stay for the record, off.
    for (const ownerId of [accounts.policyAdmin, accounts.renewals]) {
      const hooks = await (await ok(jordan.api.webhooks.$get({ query: { ownerId } }))).json();
      for (const hook of hooks) {
        await ok(
          jordan.api.webhooks[":id"].$patch({ param: { id: hook.id }, json: { enabled: false } }),
        );
      }
    }
  });
  log("keys and webhooks");

  // Saved views -------------------------------------------------------------------------------
  await at(day(35, "10:10"), async () => {
    const views: {
      table: "generations" | "audit";
      name: string;
      search: Record<string, string | number | string[]>;
      shared: boolean;
    }[] = [
      {
        table: "generations",
        name: "Failures, last 7 days",
        search: { status: ["error"], since: "7d" },
        shared: true,
      },
      { table: "generations", name: "Batch runs", search: { source: ["batch"] }, shared: true },
      { table: "generations", name: "Slower than 1 s", search: { slowerThan: 1 }, shared: true },
      {
        table: "audit",
        name: "Template changes",
        search: { targetType: "template" },
        shared: true,
      },
      { table: "audit", name: "Sign-ins", search: { action: "auth.signed_in" }, shared: false },
    ];
    for (const view of views) {
      await ok(jordan.api["saved-views"].$post({ json: view }), view.name);
    }
  });
  await at(day(34, "15:30"), async () => {
    const s = await as("samuel");
    await ok(
      s.api["saved-views"].$post({
        json: {
          table: "generations",
          name: "Bonds this month",
          search: { templateId: oregon.id, since: "30d" },
        },
      }),
    );
  });

  // Share links -------------------------------------------------------------------------------
  const shareLinks = await at(day(SHARE_LINK_DAYS, "10:00"), async () => {
    const s = await as("samuel");
    const make = async (json: Parameters<(typeof s.api)["share-links"]["$post"]>[0]["json"]) =>
      (await (await ok(s.api["share-links"].$post({ json }), json.label)).json())?.id ?? "";
    return {
      oregon: await make({
        templateId: oregon.id,
        label: "Bond requests from Portland agents",
        requireEmail: true,
      }),
      orCcb: await make({
        templateId: orCcb.id,
        label: "Commercial bond intake",
        requireEmail: true,
      }),
    };
  });
  log("saved views and share links");

  // Generations -------------------------------------------------------------------------------
  const published = await sql<
    { templateId: string; id: string; version: number; publishedAt: Date }[]
  >`
    select template_id as "templateId", id, version, published_at as "publishedAt"
    from template_version order by published_at`;
  for (const v of published) versions.get(v.templateId)?.push(v);
  const templateOf = (kind: DocumentKind) =>
    kind === "statement" ? null : (templates.get(kind) ?? null);
  const firstAvailable = (kind: DocumentKind) => {
    if (kind === "statement") return day(110, "09:30");
    const template = templateOf(kind);
    return template ? (versions.get(template.id)?.[0]?.publishedAt ?? null) : null;
  };
  const jobs = plan(clock, r, firstAvailable);
  const cutoff = clock.ago(RENDERED_DAYS * 24 * 60);
  const recent = jobs.filter((job) => job.at >= cutoff && !job.fail);
  log(`${jobs.length} generations planned, ${recent.length} to render`);

  const signature = (await draftOf(ontario)).sampleData.signature as string;
  const docFor = (job: Pick<Job, "kind" | "at">) =>
    job.kind === "ontarioCertificate"
      ? documents.ontarioCertificate(r, job.at, signature)
      : documents[job.kind as Exclude<DocumentKind, "ontarioCertificate">](r, job.at);
  const filenameOf = (job: Job, made: ReturnType<typeof docFor>): string => {
    const data = ("data" in made ? made.data : {}) as Record<string, unknown>;
    switch (job.kind) {
      case "declarations":
        return `${data.policy_number}-declarations.pdf`;
      case "certificate":
        return job.source === "api"
          ? `${data.certificate_number}.pdf`
          : (templateOf(job.kind)?.name ?? "certificate");
      case "claims":
        return `${data.claim_number}-acknowledgement.pdf`;
      case "statement":
        return "premium-statement.pdf";
      case "renewal":
        return `${data.policy_number}-renewal.pdf`;
      default:
        return templateOf(job.kind)?.name ?? job.kind;
    }
  };

  const callers = { ip: systemIp, userAgent: systemAgent };
  /** Renders one planned job through the product, tagged with its request id. */
  const render = async (job: Job) => {
    const made = docFor(job);
    const filename = filenameOf(job, made);
    const headers = { "x-request-id": job.requestId };
    if (job.source === "api" && job.key) {
      const key = keys[job.key];
      const client = new Session(demo.apiUrl, demo.apiUrl, { name: job.key, email: "", ...callers })
        .api.v1;
      const keyHeaders = { ...headers, "x-api-key": key.key };
      if (job.kind === "statement" && "html" in made) {
        // The PDF itself, as the policy system reads it.
        await drain(
          client.render.$post(
            { json: { html: made.html, filename, subject: made.subject, response: "pdf" } },
            { headers: keyHeaders },
          ),
        );
        return;
      }
      const template = templateOf(job.kind);
      const version = template && versionAt(versions.get(template.id) ?? [], job.at);
      if (!template || !version || !("data" in made)) return;
      await drain(
        client.templates[":id"].versions[":version"].generate.$post(
          {
            param: { id: template.id, version: String(version.version) },
            json: {
              data: made.data,
              filename,
              subject: made.subject,
              response: "pdf",
              ...("lang" in made && made.lang !== "en" ? { output: { lang: made.lang } } : {}),
            },
          },
          { headers: keyHeaders },
        ),
      );
      return;
    }
    const template = templateOf(job.kind);
    const version = template && versionAt(versions.get(template.id) ?? [], job.at);
    if (!template || !version || !("data" in made)) return;
    if (job.source === "share_link") {
      const linkId = job.kind === "orCcb" ? shareLinks.orCcb : shareLinks.oregon;
      const [link] = await sql<
        { token: string }[]
      >`select token from share_link where id = ${linkId}`;
      const respondent = new Session(demo.apiUrl, demo.appUrl, {
        name: "",
        email: "",
        ip: `198.51.100.${r.int(2, 250)}`,
        userAgent: r.pick([people.tom.userAgent, people.hannah.userAgent]),
      });
      await ok(
        respondent.api.share[":token"].$post(
          {
            param: { token: link?.token ?? "" },
            json: {
              data: made.data,
              email: `${made.subject
                .toLowerCase()
                .replace(/[^a-z]+/g, ".")
                .replace(/\.$/, "")}@contractor.example`,
            },
          },
          { headers },
        ),
        "share",
      );
      return;
    }
    // A document filled in the app by its owner.
    const session = await as(job.person ?? "hannah");
    const created = await (
      await ok(
        session.api.submissions.$post({
          json: { templateId: template.id, version: version.version },
        }),
      )
    ).json();
    await ok(
      session.api.submissions[":id"].$patch({
        param: { id: created?.id ?? "" },
        json: { data: made.data, step: 5 },
      }),
    );
    await ok(
      session.api.submissions[":id"].finish.$post(
        { param: { id: created?.id ?? "" }, json: {} },
        { headers },
      ),
      `finish ${job.kind}`,
    );
  };

  // Real renders, a few at a time so queue waits stay what a quiet hour looks like.
  const realStart = new Date();
  let done = 0;
  const queue = [...recent];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await render(job);
        if (++done % 100 === 0) log(`${done} rendered`);
      }
    }),
  );
  await waitForQueue(sql);

  // Two real batches: the renewal run, and a certificate run from the app.
  const renewalVersion = versionAt(versions.get(renewalTemplate.id) ?? [], clock.now);
  const batchAt = { renewals: day(10, "23:30"), certificates: day(5, "14:10") };
  const renewalRows = Array.from(
    { length: 240 },
    () => documents.renewal(r, batchAt.renewals).data as Record<string, unknown>,
  );
  // Two rows from the policy system arrive without an address; they fail alone.
  for (const i of [57, 188]) delete renewalRows[i]?.insured_address;
  const renewalsBatch = await (async () => {
    const client = new Session(demo.apiUrl, demo.apiUrl, {
      name: "renewals",
      email: "",
      ...callers,
    }).api.v1;
    const res = await ok(
      client.templates[":id"].versions[":version"].batch.$post(
        {
          param: { id: renewalTemplate.id, version: String(renewalVersion?.version ?? 1) },
          json: { rows: renewalRows, filename: "renewal-notice" },
        },
        { headers: { "x-api-key": keys.renewals.key } },
      ),
      "renewal batch",
    );
    return idOf(await res.json());
  })();
  const coiVersion = versionAt(versions.get(coiTemplate.id) ?? [], clock.now);
  const certificatesBatch = await (async () => {
    const h = await as("hannah");
    const rows = Array.from(
      { length: 60 },
      () => documents.certificate(r, batchAt.certificates).data,
    );
    const res = await ok(
      h.api.templates[":id"].versions[":version"].batch.$post({
        param: { id: coiTemplate.id, version: String(coiVersion?.version ?? 1) },
        json: { rows, filename: "metrolinx-certificates" },
      }),
      "certificate batch",
    );
    return (await res.json()).id;
  })();
  await waitForQueue(sql);
  log(`${done} rendered and 2 batches`);

  // Move each real render to its planned time, keeping its own queue wait and run time.
  await sql`
    update generation g set
      queued_at = j.at,
      started_at = j.at + (g.started_at - g.queued_at),
      finished_at = j.at + (g.finished_at - g.queued_at)
    from (select unnest(${sql.array(recent.map((j) => j.requestId))}::text[]) as request_id,
                 unnest(${sql.array(recent.map((j) => j.at.toISOString()))}::timestamptz[]) as at) j
    where g.request_id = j.request_id`;
  for (const [batchId, when] of [
    [renewalsBatch, batchAt.renewals],
    [certificatesBatch, batchAt.certificates],
  ] as const) {
    await sql`
      with b as (select created_at from batch where id = ${batchId})
      update generation set
        queued_at = queued_at - ((select created_at from b) - ${when}::timestamptz),
        started_at = started_at - ((select created_at from b) - ${when}::timestamptz),
        finished_at = finished_at - ((select created_at from b) - ${when}::timestamptz)
      where batch_id = ${batchId}`;
    await sql`update batch set completed_at = completed_at - (created_at - ${when}::timestamptz), created_at = ${when} where id = ${batchId}`;
  }
  // Documents, outputs and audit entries the renders wrote follow their generation.
  await sql`
    update submission s set created_at = g.queued_at - interval '4 minutes', updated_at = g.finished_at, finished_at = g.finished_at
    from generation g where s.generation_id = g.id and g.queued_at < ${realStart}`;
  await sql`
    update file f set created_at = g.finished_at from generation g
    where g.output_file_id = f.id and g.finished_at < ${realStart}`;
  await sql`update download_link d set created_at = g.finished_at from generation g where d.generation_id = g.id and g.finished_at < ${realStart}`;
  await clock.unlockedAudit(async (tx) => {
    await tx`
      update audit_event a set created_at = b.created_at + interval '200 milliseconds' from batch b
      where a.target_type = 'batch' and a.target_id = b.id::text and a.created_at >= ${realStart}`;
    // Share-link responses mint a download link for the respondent.
    await tx`
      update audit_event a set created_at = g.finished_at + interval '150 milliseconds' from generation g
      where a.action = 'generation.link_created' and a.target_id = g.id::text and a.created_at >= ${realStart}`;
  });
  const stray = await sql<
    { action: string }[]
  >`select action from audit_event where created_at >= ${realStart}`;
  if (stray.length)
    log(`audit entries left at seed time: ${stray.map((e) => e.action).join(", ")}`);
  log("renders moved to their days");

  // Older history, as retention left it ---------------------------------------------------------
  const prototypes = new Map<DocumentKind, Prototype>();
  for (const kind of Object.keys(documents) as DocumentKind[]) {
    const template = templateOf(kind);
    const [row] = await sql<
      { input: Record<string, unknown> | null; signing: never; size: number; pageCount: number }[]
    >`
      select input, signing, size, page_count as "pageCount" from generation
      where status = 'success' and batch_id is null
        and ${template ? sql`template_id = ${template.id}` : sql`template_id is null`}
      order by queued_at desc limit 1`;
    prototypes.set(kind, {
      templateId: template?.id ?? null,
      input: row?.input ?? null,
      signing: row?.signing ?? null,
      size: row?.size ?? 40_000,
      pageCount: row?.pageCount ?? 1,
    });
  }
  const workers = (
    await sql<
      { id: string }[]
    >`select distinct worker_id as id from generation where worker_id is not null`
  ).map((w) => w.id);
  const keyIds = Object.fromEntries(
    Object.entries(keys).map(([name, key]) => [name, key.id]),
  ) as Record<KeyName, string>;
  // The policy admin key was rotated 30 days ago: older calls used the key it replaced.
  const [oldPolicyKey] = await sql<{ id: string }[]>`
    select rotated_from_id as id from api_key_policy where api_key_id = ${keys.policyAdmin.id}`;
  const rotatedAt = day(30, "16:45");

  const rows: Row[] = [];
  const submissions: Record<string, unknown>[] = [];
  for (const job of jobs.filter((j) => j.at < cutoff || j.fail)) {
    const template = templateOf(job.kind);
    const version = template ? versionAt(versions.get(template.id) ?? [], job.at) : null;
    const made = docFor(job);
    const apiKeyId = job.key
      ? job.key === "policyAdmin" && job.at < rotatedAt
        ? (oldPolicyKey?.id ?? keyIds.policyAdmin)
        : keyIds[job.key]
      : null;
    const userId = job.key
      ? accounts[job.key]
      : job.source === "share_link"
        ? userIds.samuel
        : userIds[job.person ?? "hannah"];
    const proto = prototypes.get(job.kind);
    if (!proto) continue;
    const row = historyRow(r, job, {
      now: clock.now,
      proto: version && proto.input && "data" in made ? proto : { ...proto, input: null },
      version,
      userId,
      apiKeyId,
      workers,
      data: {
        data: "data" in made ? (made.data as Record<string, unknown>) : undefined,
        subject: made.subject,
      },
      filename: filenameOf(job, made),
    });
    rows.push(row);
    if (job.source !== "api" && template && version) {
      submissions.push({
        owner_id: userId,
        template_id: template.id,
        template_version_id: version.id,
        name: job.source === "share_link" ? `${template.name} (share link)` : template.name,
        status: row.status === "success" ? "finished" : "draft",
        source: job.source,
        share_link_id:
          job.source === "share_link"
            ? job.kind === "orCcb"
              ? shareLinks.orCcb
              : shareLinks.oregon
            : null,
        data: sql.json("data" in made ? (made.data as never) : {}),
        step: 4,
        generation_id: row.id,
        finished_at: row.status === "success" ? row.finishedAt : null,
        created_at: new Date(job.at.getTime() - r.int(3, 25) * 60_000),
        updated_at: row.finishedAt,
      });
    }
  }

  // Last month's renewal run, rendered then and since cleaned up by retention.
  const oldRun = day(41, "23:30");
  const oldRenewalVersion = versionAt(versions.get(renewalTemplate.id) ?? [], oldRun);
  const [oldBatch] = await sql<{ id: string }[]>`
    insert into batch (user_id, template_id, template_version_id, template_name, version, total, request_id, api_key_id, created_at, completed_at)
    values (${accounts.renewals}, ${renewalTemplate.id}, ${oldRenewalVersion?.id ?? null}, ${renewalTemplate.name},
            ${oldRenewalVersion?.version ?? 1}, 395, ${randomUUID()}, ${keyIds.renewals}, ${oldRun}, ${oldRun})
    returning id`;
  const batchTimes = sampleBatchTimes(r, 395, oldRun);
  const renewalProto = prototypes.get("renewal");
  batchTimes.forEach((t, i) => {
    const made = documents.renewal(r, oldRun);
    const invalid = i === 211;
    rows.push({
      id: randomUUID(),
      source: "batch",
      status: invalid ? "error" : "success",
      userId: accounts.renewals,
      apiKeyId: keyIds.renewals,
      templateId: renewalTemplate.id,
      templateVersionId: oldRenewalVersion?.id ?? null,
      batchId: oldBatch?.id ?? null,
      batchRow: i + 1,
      requestId: randomUUID(),
      filename: `renewal-notice-${i + 1}.pdf`,
      error: invalid ? "renewal_premium: Expected a number" : null,
      input: null,
      subject: made.subject,
      queuedAt: oldRun,
      startedAt: invalid ? null : t.startedAt,
      finishedAt: invalid ? oldRun : new Date(t.startedAt.getTime() + t.durationMs),
      durationMs: invalid ? null : t.durationMs,
      queueWaitMs: invalid ? null : t.queueWaitMs,
      totalMs: invalid ? 0 : t.queueWaitMs + t.durationMs,
      timings: invalid
        ? null
        : {
            liquidMs: 1,
            chromiumMs: Math.round(t.durationMs * 0.45),
            bandsMs: Math.round(t.durationMs * 0.45),
            stampMs: 3,
            finishMs: 0,
          },
      signing: null,
      attempts: invalid ? 0 : 1,
      workerId: r.pick(workers),
      pageCount: invalid ? null : (renewalProto?.pageCount ?? 1),
      size: invalid ? null : Math.round((renewalProto?.size ?? 30_000) * (0.95 + r.next() * 0.1)),
    });
  });
  const lastRow = rows
    .filter((row) => row.batchId === oldBatch?.id)
    .reduce((a, b) => (a.finishedAt > b.finishedAt ? a : b));
  await sql`update batch set completed_at = ${lastRow.finishedAt} where id = ${oldBatch?.id ?? null}`;
  await insertGenerations(sql, rows);
  for (let i = 0; i < submissions.length; i += 500) {
    await sql`insert into submission ${sql(submissions.slice(i, i + 500) as never)}`;
  }
  await insertAudit(sql, {
    action: "batch.started",
    actorKind: "api_key",
    actorId: accounts.renewals,
    actorName: serviceAccounts.renewals.name,
    apiKeyId: keyIds.renewals,
    targetType: "batch",
    targetId: oldBatch?.id ?? null,
    targetName: renewalTemplate.name,
    details: { rows: 395, version: oldRenewalVersion?.version ?? 1 },
    at: oldRun,
    ip: systemIp,
    userAgent: systemAgent,
  });
  log(`${rows.length} history rows inserted`);

  // The last few days ---------------------------------------------------------------------------
  // The renewal notice's next change is approved and waiting for a publisher.
  await at(day(2, "15:10"), () =>
    edit("elena", renewalTemplate, {
      sampleData: { ...renewal.sampleData, changes: "Cyber incident response endorsement added." },
    }),
  );
  const renewalReview = await at(day(2, "15:20"), () =>
    submit("elena", renewalTemplate, "Shorter what's-changing example"),
  );
  await at(day(1, "10:05"), () =>
    decide("marc", renewalReview, "approve", "Fine to go out with the November run."),
  );
  await at(day(1, "16:30"), async () => {
    await new Session(demo.apiUrl, demo.appUrl, pendingPerson).auth("/sign-up/email", {
      name: pendingPerson.name,
      email: pendingPerson.email,
      password: DEMO_PASSWORD,
    });
  });
  await at(day(1, "08:47"), async () => {
    // A mistyped password before the right one.
    await new Session(demo.apiUrl, demo.appUrl, people.luc)
      .signIn("harbour-demo-2025")
      .catch((error) => {
        if (!(error instanceof HttpError)) throw error;
      });
  });

  // This morning: the Ontario certificate's next change, under review.
  await at(clock.ago(150), async () => {
    const draft = await draftOf(ontario);
    if (draft.kind !== "designed") throw new Error("Ontario certificate isn't designed");
    await edit("priya", ontario, {
      description:
        "Performance bond certificate for Ontario municipalities, with a schedule of covered contracts and an optional rider.",
      sections: draft.sections.map((section) => ({
        ...section,
        fields: section.fields.map((f) =>
          f.key === "attorney_in_fact" ? { ...f, required: true } : f,
        ),
      })),
    });
  });
  const ontarioReview = await at(clock.ago(142), () =>
    submit(
      "priya",
      ontario,
      "Attorney-in-fact is now required; Ontario obligees reject certificates without one.",
    ),
  );
  await at(clock.ago(95), () =>
    comment(
      "marc",
      ontarioReview,
      "Does this also apply to the bid bond certificates? Those go to the same obligees.",
    ),
  );
  await at(clock.ago(81), () =>
    comment("priya", ontarioReview, "Yes, all three bond types. The test cases still pass."),
  );

  // Jordan's own documents: an Oregon bond finished earlier, two in progress (the screenshots
  // tick the co-principal on one and show the other's co-principal step).
  await at(clock.ago(48), async () => {
    const sample = (await draftOf(oregon)).sampleData;
    const start = async (data: Record<string, unknown>, step: number) => {
      const created = await (
        await ok(jordan.api.submissions.$post({ json: { templateId: oregon.id } }))
      ).json();
      const id = must(created?.id, "document id");
      await ok(jordan.api.submissions[":id"].$patch({ param: { id }, json: { data, step } }));
      return id;
    };
    const finished = await start({ ...sample, has_co_principal: false, ...emptyCoPrincipal }, 4);
    await ok(jordan.api.submissions[":id"].finish.$post({ param: { id: finished }, json: {} }));
    await waitForQueue(sql);
    await start({ ...sample, has_co_principal: false, ...emptyCoPrincipal }, 1);
    await start({ ...sample, has_co_principal: true, ...emptyCoPrincipal }, 1);
  });

  await finishTouches(sql, clock, { keys: keyIds, shareLinks, people: userIds, r });
  await signInHistory(sql, clock, r, userIds);
  log("done");
  return { anchor: clock.now };
}

/** A PDF response: checked, then read to the end so the connection is reused. */
async function drain(
  request: Promise<
    | Response
    | { ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }
  >,
) {
  await (await ok(request, "pdf")).arrayBuffer();
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`No ${what} in the response`);
  return value;
}

const idOf = (body: unknown) => must(z.object({ id: z.string() }).parse(body).id, "id");

/** Jordan's drafts start with the co-principal empty, as a person would see it. */
const emptyCoPrincipal = {
  co_principal_name: "",
  co_principal_address: "",
  co_principal_signatory: "",
  co_principal_signatory_title: "",
};

async function waitForQueue(sql: Demo["db"]) {
  for (;;) {
    const [{ open }] =
      (await sql`select count(*)::int as open from generation where status in ('queued', 'running')`) as [
        { open: number },
      ];
    if (open === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

type AuditInsert = {
  action: string;
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  apiKeyId?: string | null;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  details?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: Date;
  ip: string;
  userAgent: string;
};

async function insertAudit(sql: Demo["db"], e: AuditInsert) {
  await sql`
    insert into audit_event (created_at, actor_kind, actor_id, actor_name, api_key_id, action, target_type, target_id, target_name, details, after, ip, user_agent, request_id)
    values (${e.at}, ${e.actorKind}, ${e.actorId}, ${e.actorName}, ${e.apiKeyId ?? null}, ${e.action}, ${e.targetType},
            ${e.targetId}, ${e.targetName}, ${e.details ? sql.json(e.details as never) : null}, ${e.after ? sql.json(e.after as never) : null}, ${e.ip}, ${e.userAgent}, ${randomUUID()})`;
}

/** Counters the API keeps as it's used: key usage, share-link views, read notifications. */
async function finishTouches(
  sql: Demo["db"],
  clock: Clock,
  ctx: {
    keys: Record<KeyName, string>;
    shareLinks: Record<string, string>;
    people: Record<PersonKey, string>;
    r: Rand;
  },
) {
  await sql`
    update api_key_policy p set requests = u.n + (u.n / 20), last_used_at = u.last, last_used_ip = ${systemIp}
    from (select api_key_id, count(*)::int as n, max(queued_at) as last from generation where api_key_id is not null group by api_key_id) u
    where p.api_key_id = u.api_key_id`;
  for (const id of Object.values(ctx.shareLinks)) {
    await sql`
      update share_link set views = (select count(*) from submission where share_link_id = ${id}) * ${ctx.r.int(3, 5)} + ${ctx.r.int(4, 20)},
        seen_at = ${clock.ago(60 * 26)}
      where id = ${id}`;
  }
  // People read what came before today.
  await sql`update notification set read_at = created_at + interval '2 hours' where created_at < ${clock.ago(60 * 20)}`;
}

/** Morning sign-ins on working days, copied from a real one so they read the same. */
async function signInHistory(
  sql: Demo["db"],
  clock: Clock,
  r: Rand,
  ids: Record<PersonKey, string>,
) {
  const [real] = await sql<{ details: Record<string, unknown> | null }[]>`
    select details from audit_event where action = 'auth.signed_in' limit 1`;
  const rows: Record<string, unknown>[] = [];
  for (let daysAgo = 89; daysAgo >= 1; daysAgo--) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      weekday: "short",
    }).format(clock.day(daysAgo, "12:00"));
    if (weekday === "Sat" || weekday === "Sun") continue;
    for (const [key, person] of Object.entries(people) as [
      PersonKey,
      (typeof people)[PersonKey],
    ][]) {
      if (!r.chance(key === "jordan" ? 0.5 : 0.8)) continue;
      const when = clock.day(daysAgo, `${r.int(7, 9)}:${String(r.int(0, 59)).padStart(2, "0")}`);
      when.setUTCSeconds(r.int(0, 59));
      rows.push({
        created_at: when,
        actor_kind: "user",
        actor_id: ids[key],
        actor_name: person.name,
        action: "auth.signed_in",
        target_type: "user",
        target_id: ids[key],
        target_name: person.email,
        details: real?.details ? sql.json(real.details as never) : null,
        ip: person.ip,
        user_agent: person.userAgent,
        request_id: randomUUID(),
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await sql`insert into audit_event ${sql(rows.slice(i, i + 500) as never)}`;
  }
}

/** `pnpm demo:seed`: reset and seed, then stop everything. */
async function main() {
  const begun = Date.now();
  const demo = await startDemo({ app: false });
  const stop = () => void demo.teardown().finally(() => process.exit(130));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await seed(demo);
    await demo.teardown();
  } catch (error) {
    await demo.teardown(true);
    throw error;
  }
  log(`seeded in ${Math.round((Date.now() - begun) / 1000)} s; data in ${demoDir}`);
  log(`sign in as ${people.jordan.email} / ${DEMO_PASSWORD} (pnpm demo:screens --serve)`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
