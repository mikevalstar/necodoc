import { ASSET_ORIGIN } from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { createLiquid, dayjsLocale, liquid, partialsFs } from "./liquid";

const render = (template: string, data: Record<string, unknown> = {}) =>
  liquid.parseAndRender(template, data);

describe("liquid", () => {
  it("escapes output by default; raw opts out", async () => {
    const data = { name: "<b>Tom & Jerry</b>" };
    expect(await render("{{ name }}", data)).toBe("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
    expect(await render("{{ name | raw }}", data)).toBe("<b>Tom & Jerry</b>");
  });

  it("errors on unknown filters", async () => {
    await expect(render("{{ x | nope }}", { x: 1 })).rejects.toThrow(/nope/);
  });

  it("reads only own properties", async () => {
    expect(await render("{{ x.constructor }}{{ x.toString }}", { x: {} })).toBe("");
  });

  it("loads no partials", async () => {
    await expect(render("{% include '/etc/hosts' %}")).rejects.toThrow(/Failed to lookup/);
    await expect(render("{% render 'package.json' %}")).rejects.toThrow(/Failed to lookup/);
  });

  it("renders in-memory partials that see the data through globals", async () => {
    const withPartials = createLiquid(partialsFs({ clause: "<p>{{ name }} {{ who }}</p>" }));
    const data = { name: "<Ann>" };
    expect(
      await withPartials.parseAndRender("{% render 'clause', who: 'Bob' %}", data, {
        globals: data,
      }),
    ).toBe("<p>&lt;Ann&gt; Bob</p>");
    await expect(withPartials.parseAndRender("{% render 'other' %}")).rejects.toThrow(
      /Failed to lookup/,
    );
  });

  it("formats dates with dayjs tokens", async () => {
    expect(await render("{{ d | date }}", { d: "2026-03-05" })).toBe("March 5, 2026");
    expect(await render("{{ d | date: 'YYYY/MM/DD' }}", { d: "2026-03-05" })).toBe("2026/03/05");
    expect(await render("{{ missing | date }}")).toBe("");
    await expect(render("{{ d | date }}", { d: "soon" })).rejects.toThrow(/not a date/);
  });

  it("formats numbers and currency", async () => {
    expect(await render("{{ n | number: 2 }}", { n: 1234.5 })).toBe("1,234.50");
    expect(await render("{{ n | currency }}", { n: 1234.5 })).toBe("$1,234.50");
    expect(await render("{{ n | currency: 'EUR', 'de-DE' }}", { n: 1234.5 })).toMatch(
      /^1\.234,50\s€$/,
    );
    await expect(render("{{ n | number }}", { n: "abc" })).rejects.toThrow(/not a number/);
  });

  it("renders QR codes and barcodes as SVG data URLs", async () => {
    const qr = await render("{{ url | qrcode }}", { url: "https://necodoc.example" });
    expect(qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(qr.split(",")[1] ?? "", "base64").toString();
    expect(svg).toContain("<svg");
    expect(await render("{{ sku | barcode: 'code128' }}", { sku: "ABC-123" })).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
  });

  it("points asset_url at the in-process asset origin", async () => {
    expect(await render("{{ 'abc' | asset_url }}")).toBe(`${ASSET_ORIGIN}/abc`);
  });

  describe("document language (ADR 0040)", () => {
    const inLang = (lang: string, template: string, data: Record<string, unknown> = {}) =>
      createLiquid(partialsFs(), { lang }).parseAndRender(template, data);
    const d = { d: "2026-10-12", n: 1234.5 };

    it("formats dates in the language, LL by default", async () => {
      expect(await inLang("fr", "{{ d | date }}", d)).toBe("12 octobre 2026");
      expect(await inLang("de-DE", "{{ d | date }}", d)).toBe("12. Oktober 2026");
      expect(await inLang("ja", "{{ d | date }}", d)).toBe("2026年10月12日");
      expect(await inLang("fr-CA", "{{ d | date: 'L' }}", d)).toBe("2026-10-12");
      expect(await inLang("es", "{{ d | date: 'dddd D MMMM' }}", d)).toBe("lunes 12 octubre");
    });

    it("lets an explicit locale win", async () => {
      expect(await inLang("fr", "{{ d | date: 'LL', 'de' }}", d)).toBe("12. Oktober 2026");
      expect(await inLang("fr", "{{ n | currency: 'USD', 'en-US' }}", d)).toBe("$1,234.50");
    });

    it("formats numbers and currency in the language", async () => {
      expect(await inLang("de", "{{ n | number: 2 }}", d)).toBe("1.234,50");
      expect(await inLang("fr", "{{ n | currency: 'EUR' }}", d)).toMatch(/^1\s234,50\s€$/);
      expect(await inLang("ja", "{{ n | currency: 'JPY' }}", d)).toMatch(/1,235$/);
    });

    it("resolves dayjs locales: exact, language-region, language, else en", () => {
      expect(dayjsLocale("fr-CA")).toBe("fr-ca");
      expect(dayjsLocale("fr-BE")).toBe("fr");
      expect(dayjsLocale("zh-Hant-TW")).toBe("zh-tw");
      expect(dayjsLocale("xx")).toBe("en");
    });

    it("translates with t, falling back to the source", async () => {
      const fr = createLiquid(partialsFs(), { lang: "fr", strings: { Invoice: "Facture & co" } });
      expect(await fr.parseAndRender('{{ "Invoice" | t }} {{ "Total" | t }}')).toBe(
        "Facture &amp; co Total",
      );
      expect(await fr.parseAndRender("{{ s | t }}{{ missing | t }}", { s: "Invoice" })).toBe(
        "Facture &amp; co",
      );
    });
  });
});
