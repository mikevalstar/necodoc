import { join } from "node:path";
import { root } from "@necodoc/bench/stack";
import type { Page } from "playwright-core";
import type postgres from "postgres";

// Spec: docs/features/demo-data-and-screenshots.md (Screenshots). Every image the marketing site
// and the reel use: where it goes, the page it's taken on and what happens first. Sizes and crops
// match what the pages (apps/web/src/pages) and scenes (apps/reel/src/scenes) already expect, so
// keep them when changing a shot. `pnpm demo:screens --only <name>` retakes some.

export type Ctx = {
  sql: postgres.Sql;
  /** A template's id by its name. */
  template(name: string): Promise<string>;
  fixtures: string;
};

export type Shot = {
  name: string;
  /** web: apps/web/src/assets/screens, PNG at 2x. reel: apps/reel/public/screens, 2400 px JPEG. */
  target: "web" | "reel";
  /** CSS pixels. Reel shots are 1600x900 (the scenes' 2000x1125 space, saved at 2400 wide). */
  viewport: { width: number; height: number };
  /** Path in the app. */
  route: (ctx: Ctx) => Promise<string> | string;
  /** What has to be on the page before anything else happens. */
  ready: (page: Page) => Promise<unknown>;
  /** Clicks, typing and scrolling before the capture. */
  prepare?: (page: Page, ctx: Ctx) => Promise<unknown>;
};

const web = { width: 1440, height: 900 };
const webShort = { width: 1440, height: 820 };
const reel = { width: 1600, height: 900 };

const text = (page: Page, value: string) =>
  page.getByText(value, { exact: true }).first().waitFor();
const tab = (page: Page, name: string) => page.getByRole("tab", { name }).first().click();

/** Jordan's Oregon bond documents, as the seed leaves them: one finished, then two drafts. */
async function jordanDocument(ctx: Ctx, which: "finished" | "draft" | "co-principal draft") {
  const rows = await ctx.sql<{ id: string }[]>`
    select s.id from submission s join "user" u on u.id = s.owner_id
    join template t on t.id = s.template_id
    where u.email = 'jordan.ellis@harbour-surety.example' and t.name = 'Oregon Contractor License Bond'
      and s.status = ${which === "finished" ? "finished" : "draft"}
    order by s.created_at`;
  const id = rows[which === "co-principal draft" ? 1 : 0]?.id;
  if (!id) throw new Error(`No ${which} Oregon bond for Jordan; reseed`);
  return `/documents/${id}`;
}

/** The newest OR CCB generation with a signing package. */
async function signedGeneration(ctx: Ctx) {
  const id = await ctx.template("OR CCB Commercial Surety Bond");
  const [row] = await ctx.sql<{ id: string }[]>`
    select id from generation where template_id = ${id} and signing is not null and output_file_id is not null
    order by queued_at desc limit 1`;
  if (!row) throw new Error("No signed OR CCB generation; reseed");
  return `/generations/${row.id}`;
}

/** Ticks the co-principal and types it in, leaving the cursor in the last field. */
async function fillCoPrincipal(page: Page) {
  await page.getByLabel("Add a co-principal").check();
  await page.getByLabel("Co-principal legal name").fill("Whitfield Holdings Inc.");
  await page
    .getByLabel("Co-principal address")
    .fill("1550 NW Overton Street, Suite 300\nPortland, OR 97209");
  await page.getByLabel("Co-principal signatory name").fill("Morgan Whitfield");
  await page.getByLabel("Co-principal signatory title").fill("President");
}

export const shots: Shot[] = [
  // Website ------------------------------------------------------------------------------------
  {
    name: "templates-gallery",
    target: "web",
    viewport: web,
    route: () => "/templates",
    ready: (page) => text(page, "Oregon Contractor License Bond"),
  },
  {
    name: "command-palette",
    target: "web",
    viewport: web,
    route: () => "/templates",
    ready: (page) => text(page, "Oregon Contractor License Bond"),
    prepare: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type("bond", { delay: 40 });
      await page.getByRole("option").nth(4).waitFor();
    },
  },
  {
    name: "overlay-editor",
    target: "web",
    viewport: web,
    route: async (ctx) => `/templates/${await ctx.template("OR CCB Commercial Surety Bond")}`,
    ready: (page) => text(page, "No box selected"),
  },
  {
    name: "signing-package",
    target: "web",
    viewport: web,
    route: async (ctx) => `/templates/${await ctx.template("OR CCB Commercial Surety Bond")}`,
    ready: (page) => text(page, "No box selected"),
    prepare: async (page) => {
      await tab(page, "Signing");
      await page.getByText("Add signer").first().waitFor();
    },
  },
  {
    name: "template-editor",
    target: "web",
    viewport: web,
    route: async (ctx) => `/templates/${await ctx.template("Surety Bond Certificate")}`,
    ready: (page) => text(page, "Schedule of covered contracts"),
  },
  {
    name: "template-fields",
    target: "web",
    viewport: web,
    route: async (ctx) => `/templates/${await ctx.template("Oregon Contractor License Bond")}`,
    ready: (page) => text(page, "Principal"),
    prepare: async (page) => {
      await tab(page, "Fields");
      await page.getByText("Add field").first().waitFor();
    },
  },
  {
    name: "guided-form",
    target: "web",
    viewport: web,
    route: (ctx) => jordanDocument(ctx, "co-principal draft"),
    ready: (page) => page.getByLabel("Co-principal legal name").waitFor(),
  },
  {
    name: "generations-log",
    target: "web",
    viewport: web,
    route: () => "/generations?status=success&source=api",
    ready: (page) => text(page, "p95"),
  },
  {
    name: "api-reference",
    target: "web",
    viewport: { width: 1440, height: 565 },
    route: () => "/developers",
    ready: (page) => page.getByText("necodoc API").first().waitFor({ timeout: 30_000 }),
  },
  {
    name: "audit-log",
    target: "web",
    viewport: webShort,
    route: () => "/admin/audit?targetType=template",
    ready: (page) => text(page, "Template updated"),
  },
  {
    name: "audit-detail",
    target: "web",
    viewport: webShort,
    route: () => "/admin/audit?targetType=template&action=template.updated",
    ready: (page) => text(page, "Template updated"),
    prepare: async (page) => {
      await page.getByRole("row").nth(1).click();
      await text(page, "Changes");
    },
  },
  {
    name: "admin-queue",
    target: "web",
    viewport: webShort,
    route: () => "/admin/queue",
    ready: (page) => page.getByText("necodoc-worker-").first().waitFor(),
  },
  {
    name: "admin-system",
    target: "web",
    viewport: webShort,
    route: () => "/admin/system",
    ready: (page) => page.getByText("necodoc-worker-").first().waitFor(),
  },

  // Reel ---------------------------------------------------------------------------------------
  {
    name: "upload-dialog",
    target: "reel",
    viewport: reel,
    route: () => "/templates",
    ready: (page) => text(page, "Oregon Contractor License Bond"),
    prepare: async (page, ctx) => {
      await page.getByRole("button", { name: "New template" }).first().click();
      await page.getByText("Fill an existing PDF").click();
      await page
        .getByLabel("PDF to fill (up to 20 MB)")
        .setInputFiles(join(ctx.fixtures, "or-ccb-commercial-contractor-bond.pdf"));
      await page.getByLabel("Name", { exact: true }).fill("Oregon CCB commercial surety bond");
    },
  },
  {
    name: "overlay",
    target: "reel",
    viewport: reel,
    route: async (ctx) => `/templates/${await ctx.template("OR CCB Commercial Surety Bond")}`,
    ready: (page) => text(page, "No box selected"),
  },
  {
    name: "template-editor",
    target: "reel",
    viewport: reel,
    route: async (ctx) => `/templates/${await ctx.template("Oregon Contractor License Bond")}`,
    ready: (page) => text(page, "Show only if"),
  },
  {
    name: "finished-no-coprincipal",
    target: "reel",
    viewport: reel,
    route: (ctx) => jordanDocument(ctx, "finished"),
    ready: (page) => page.getByRole("button", { name: "Download PDF" }).waitFor(),
  },
  {
    name: "fill-coprincipal-off",
    target: "reel",
    viewport: reel,
    route: (ctx) => jordanDocument(ctx, "draft"),
    ready: (page) => page.getByLabel("Add a co-principal").waitFor(),
  },
  {
    name: "fill-coprincipal-on",
    target: "reel",
    viewport: reel,
    route: (ctx) => jordanDocument(ctx, "draft"),
    ready: (page) => page.getByLabel("Add a co-principal").waitFor(),
    prepare: fillCoPrincipal,
  },
  {
    // The same draft, finished: the steps after the co-principal keep the sample answers.
    name: "finished-coprincipal",
    target: "reel",
    viewport: reel,
    route: (ctx) => jordanDocument(ctx, "draft"),
    ready: (page) => page.getByLabel("Add a co-principal").waitFor(),
    prepare: async (page) => {
      if (!(await page.getByLabel("Add a co-principal").isChecked())) await fillCoPrincipal(page);
      for (let step = 0; step < 6; step++) {
        const finish = page.getByRole("button", { name: "Finish and make PDF" });
        if (await finish.isVisible()) {
          await finish.click();
          break;
        }
        await page.getByRole("button", { name: "Next" }).click();
      }
      await page.getByRole("button", { name: "Download PDF" }).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "signing-package",
    target: "reel",
    viewport: reel,
    route: signedGeneration,
    ready: (page) => text(page, "Signing package"),
    prepare: async (page) => {
      // The scene highlights the signer rows, so the card sits where it did.
      await page
        .getByText("Signing package", { exact: true })
        .first()
        .evaluate((el) => {
          const top = el.getBoundingClientRect().top + window.scrollY;
          const scroller = document.scrollingElement ?? document.documentElement;
          scroller.scrollTo(0, top - 440);
        });
    },
  },
  {
    name: "audit-log",
    target: "reel",
    viewport: reel,
    route: () => "/admin/audit?q=Oregon",
    ready: (page) => text(page, "Oregon Contractor License Bond"),
  },
  {
    name: "generation-log",
    target: "reel",
    viewport: reel,
    route: async (ctx) =>
      `/generations?templateId=${await ctx.template("Oregon Contractor License Bond")}`,
    ready: (page) => text(page, "p95"),
  },
];

export const outputDir = {
  web: join(root, "apps/web/src/assets/screens"),
  reel: join(root, "apps/reel/public/screens"),
};
