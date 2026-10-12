import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type BrowserContext, chromium, type Page } from "playwright-core";
import { Session } from "./client.ts";
import { TIME_ZONE } from "./clock.ts";
import { startDemo } from "./instance.ts";
import { DEMO_PASSWORD, people } from "./people.ts";
import { seed } from "./seed.ts";
import { type Ctx, outputDir, type Shot, shots } from "./shots.ts";

// Spec: docs/features/demo-data-and-screenshots.md (Screenshots). `pnpm demo:screens` reseeds the
// demo instance, starts it with the app's dev server, and captures every shot in shots.ts.

const { values: flags } = parseArgs({
  options: {
    only: { type: "string", multiple: true },
    "no-seed": { type: "boolean", default: false },
    serve: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  args: process.argv.slice(2).filter((a) => a !== "--"),
});

if (flags.help) {
  console.log(`pnpm demo:screens [flags]

  --only NAME     retake only this shot (repeatable; "reel/overlay" picks one target)
  --no-seed       keep the demo database as the last seed left it
  --serve         start the instance and wait (Ctrl-C stops it); no screenshots

Shots: ${shots.map((s) => `${s.target}/${s.name}`).join(", ")}`);
  process.exit(0);
}

const log = (message: string) =>
  console.log(`[screens ${new Date().toISOString().slice(11, 19)}] ${message}`);

const wanted = (shot: Shot) =>
  !flags.only?.length ||
  flags.only.some((name) => name === shot.name || name === `${shot.target}/${shot.name}`);

const demo = await startDemo({ app: true, reset: !flags["no-seed"] });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void demo.teardown().finally(() => process.exit(130));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  if (!flags["no-seed"]) await seed(demo);
  if (flags.serve) {
    log(`${demo.appUrl}  ·  ${people.jordan.email} / ${DEMO_PASSWORD}  ·  Ctrl-C stops it`);
    await new Promise(() => {});
  }
  await capture();
  await demo.teardown();
} catch (error) {
  await demo.teardown(true);
  throw error;
}

async function capture() {
  const session = await new Session(demo.apiUrl, demo.appUrl, people.jordan).signIn(DEMO_PASSWORD);
  const [jordan] = await demo.db<{ id: string }[]>`
    select id from "user" where email = ${people.jordan.email}`;
  const ctx: Ctx = {
    sql: demo.db,
    fixtures: join(import.meta.dirname, "../../../fixtures/pdfs/surety-bonds"),
    async template(name) {
      const [row] = await demo.db<{ id: string }[]>`
        select id from template where name = ${name} and archived_at is null`;
      if (!row) throw new Error(`No template named ${name}`);
      return row.id;
    },
  };
  // Full Chromium in new headless mode: it has the PDF viewer the previews use.
  const browser = await chromium.launch({ channel: "chromium", args: ["--hide-scrollbars"] });
  try {
    for (const shot of shots.filter(wanted)) {
      const context = await browser.newContext({
        viewport: shot.viewport,
        deviceScaleFactor: shot.target === "web" ? 2 : 1.5,
        colorScheme: "light",
        reducedMotion: "reduce",
        locale: "en-US",
        timezoneId: TIME_ZONE,
      });
      try {
        await prepareContext(context, session.cookie, jordan?.id ?? "");
        const page = await context.newPage();
        await page.goto(`${demo.appUrl}${await shot.route(ctx)}`);
        await shot.ready(page);
        await settle(page);
        await shot.prepare?.(page, ctx);
        await settle(page);
        const dir = outputDir[shot.target];
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${shot.name}.${shot.target === "web" ? "png" : "jpg"}`);
        await page.screenshot({
          path,
          ...(shot.target === "web" ? { type: "png" } : { type: "jpeg", quality: 88 }),
          animations: "disabled",
          caret: "hide",
        });
        log(`${shot.target}/${shot.name}`);
      } catch (error) {
        throw new Error(
          `${shot.target}/${shot.name}: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

/** Signed in as Jordan, with the app's per-browser preferences at their defaults. */
async function prepareContext(context: BrowserContext, cookie: string, userId: string) {
  await context.addCookies(
    cookie.split("; ").flatMap((pair) => {
      const at = pair.indexOf("=");
      return at > 0
        ? [{ name: pair.slice(0, at), value: pair.slice(at + 1), url: demo.appUrl }]
        : [];
    }),
  );
  await context.addInitScript((id) => {
    const prefs: Record<string, string> = {
      "necodoc-theme": "light",
      "necodoc-density": "comfortable",
      "necodoc-sidebar-collapsed": "0",
      "necodoc-status-bar": "0",
      "necodoc-templates-view": "gallery",
      "necodoc-overlay-preview-hidden": "0",
      [`necodoc-get-started-dismissed:${id}`]: "1",
    };
    for (const [key, value] of Object.entries(prefs)) localStorage.setItem(key, value);
    localStorage.removeItem("necodoc-palette-recent");
  }, userId);
}

/** Network quiet, fonts loaded, PDF viewers painted. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(page.frames().length > 1 ? 2500 : 600);
}
