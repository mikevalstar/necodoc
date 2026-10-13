// Signs in through Better Auth and screenshots one app page with the pinned Chromium.
// node .claude/skills/run-necodoc/screenshot.mjs [path] [out.png]
// Env: APP_URL (http://localhost:5173), NECODOC_EMAIL, NECODOC_PASSWORD, WIDTH, HEIGHT.
import { createRequire } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
const { chromium } = createRequire(join(root, "apps/api/package.json"))("playwright-core");

const [, , path = "/templates", out = "screenshot.png"] = process.argv;
const base = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: {
      width: Number(process.env.WIDTH ?? 1440),
      height: Number(process.env.HEIGHT ?? 900),
    },
  });
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  const signIn = await page.request.post(`${base}/api/auth/sign-in/email`, {
    data: {
      email: process.env.NECODOC_EMAIL ?? "admin@admin.com",
      password: process.env.NECODOC_PASSWORD ?? "admin1234",
    },
    headers: { origin: base },
  });
  if (!signIn.ok()) throw new Error(`Sign-in failed: ${signIn.status()} ${await signIn.text()}`);
  await page.goto(new URL(path, base).href, { waitUntil: "networkidle" });
  // The SPA renders after its first queries; wait for real content, not the blank shell.
  await page.waitForFunction(() => document.body.innerText.trim().length > 50, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`${page.url()} -> ${out}`);
} finally {
  await browser.close();
}
