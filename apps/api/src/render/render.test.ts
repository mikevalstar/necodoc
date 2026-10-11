import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pageOptionsSchema } from "@necodoc/shared";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, renderLimits } from "./browser";
import { renderPdf } from "./render";

// Real Chromium (from Playwright's browser cache).

// Text runs split where the font subset changes (Ł is latin-ext), so compare without whitespace.
const squash = (text: string) => text.replace(/\s+/g, "");

async function pageTexts(pdf: Uint8Array) {
  const doc = await getDocument({ data: pdf.slice() }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(squash(content.items.map((item) => ("str" in item ? item.str : "")).join("")));
  }
  return texts;
}

const noAssets = async () => null;

afterAll(closeBrowser);

describe("renderPdf", () => {
  it("stamps header and footer bands with page tokens and a first-page variant", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => `<p>Line item {{ prefix }} ${i + 1}</p>`);
    const { pdf, pageCount } = await renderPdf(
      {
        html: rows.join(""),
        page: pageOptionsSchema.parse({ size: "A4" }),
        data: { prefix: "#", client: "Zoë Łukasz" },
        header: {
          html: "<div>Continued for {{ client }}</div>",
          firstPageHtml: "<div>Letterhead for {{ client }}</div>",
          height: 15,
        },
        footer: { html: "<div>Page {{ page }} of {{ pages }}</div>", height: 10 },
      },
      noAssets,
    );

    expect(pageCount).toBeGreaterThanOrEqual(2);
    const texts = await pageTexts(pdf);
    expect(texts).toHaveLength(pageCount);
    texts.forEach((text, i) => {
      expect(text).toContain(squash(`Page ${i + 1} of ${pageCount}`));
      expect(text).toContain(
        squash(i === 0 ? "Letterhead for Zoë Łukasz" : "Continued for Zoë Łukasz"),
      );
    });
    expect(texts[0]).toContain(squash("Line item # 1"));
  });

  it("fetches nothing from the network or disk, runs no scripts, and still renders", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end("leaked");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const remote = `http://127.0.0.1:${port}`;
    try {
      const { pdf, pageCount } = await renderPdf(
        {
          html: `<img src="${remote}/img.png"><iframe src="${remote}/frame"></iframe>
            <iframe src="file:///etc/hosts"></iframe><p id="out">static</p>
            <script>document.getElementById("out").textContent = "scripted"</script>`,
          css: `@import url("${remote}/style.css"); body { background: url("${remote}/bg.png"); }`,
          page: pageOptionsSchema.parse({}),
          data: {},
        },
        noAssets,
      );
      expect(pageCount).toBe(1);
      const [text] = await pageTexts(pdf);
      expect(text).toContain("static");
      expect(text).not.toContain("scripted");
      expect(text).not.toContain("localhost");
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("times out a stuck render, then renders again", async () => {
    const stuck = () => new Promise<null>(() => {});
    const original = renderLimits.timeoutMs;
    renderLimits.timeoutMs = 500;
    try {
      await expect(
        renderPdf(
          {
            html: `<img src="{{ 'x' | asset_url }}">`,
            page: pageOptionsSchema.parse({}),
            data: {},
          },
          stuck,
        ),
      ).rejects.toThrow(/timed out/i);
    } finally {
      renderLimits.timeoutMs = original;
    }
    const { pageCount } = await renderPdf(
      { html: "<p>after</p>", page: pageOptionsSchema.parse({}), data: {} },
      noAssets,
    );
    expect(pageCount).toBe(1);
  });

  it("relaunches the browser after it goes away", async () => {
    await closeBrowser();
    const { pageCount } = await renderPdf(
      { html: "<p>again</p>", page: pageOptionsSchema.parse({}), data: {} },
      noAssets,
    );
    expect(pageCount).toBe(1);
  });
});
