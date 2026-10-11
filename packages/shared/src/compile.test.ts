import { describe, expect, it } from "vitest";
import {
  compileDesignedContent,
  compileDoc,
  escapeHtml,
  liquidString,
  TemplateCompileError,
  templateFieldProblems,
  toCodeMode,
} from "./compile";
import { type FieldSection, fieldSectionsSchema } from "./fields";
import { type DesignedContent, designedContentSchema } from "./template";
import { type Doc, docSchema } from "./template-doc";

const doc = (...content: unknown[]): Doc => docSchema.parse({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const merge = (field: string, filter?: unknown) => ({
  type: "mergeField",
  attrs: { field, filter },
});
const html = (...content: unknown[]) => compileDoc(doc(...content));

const sections: FieldSection[] = fieldSectionsSchema.parse([
  {
    title: "S",
    fields: [
      { type: "text", key: "name", label: "Name" },
      {
        type: "choice",
        key: "tags",
        label: "Tags",
        multiple: true,
        options: [{ value: "vip", label: "VIP" }],
      },
      { type: "image", key: "logo", label: "Logo" },
      {
        type: "group",
        key: "items",
        label: "Items",
        fields: [
          { type: "text", key: "desc", label: "Desc" },
          { type: "number", key: "qty", label: "Qty" },
          {
            type: "choice",
            key: "flags",
            label: "Flags",
            multiple: true,
            options: [{ value: "x", label: "X" }],
          },
        ],
      },
    ],
  },
]);

describe("escaping", () => {
  it("escapes HTML and Liquid delimiters", () => {
    expect(escapeHtml(`<a href="x">&'{{ y }}{% z %}`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&#123;&#123; y &#125;&#125;&#123;% z %&#125;",
    );
  });

  it("writes Liquid string literals that can't close a tag", () => {
    expect(liquidString("plain text, 1.5: a/b-c")).toBe('"plain text, 1.5: a/b-c"');
    expect(liquidString(`"%}'\\`)).toBe('"\\u0022\\u0025\\u007d\\u0027\\u005c"');
    expect(liquidString("é")).toBe('"\\u00e9"');
  });

  it("never lets typed text become Liquid or HTML", () => {
    const out = html(p(text("{{ secret }} {% if x %}<script>alert(1)</script>")));
    expect(out).not.toMatch(/[{}<>]script|\{\{|\{%/);
    expect(out).toBe(
      "<p>&#123;&#123; secret &#125;&#125; &#123;% if x %&#125;&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("keeps runs of spaces", () => {
    expect(html(p(text("a   b c")))).toBe("<p>a&nbsp;&nbsp; b c</p>");
  });
});

describe("compileDoc: text blocks", () => {
  it("compiles paragraphs, empty paragraphs and alignment", () => {
    expect(html(p(text("Hi")))).toBe("<p>Hi</p>");
    expect(html({ type: "paragraph" })).toBe("<p><br></p>");
    expect(html({ type: "paragraph", attrs: { textAlign: "center" }, content: [text("C")] })).toBe(
      '<p style="text-align:center">C</p>',
    );
    expect(html({ type: "paragraph", attrs: { textAlign: "left" }, content: [text("L")] })).toBe(
      "<p>L</p>",
    );
  });

  it("compiles headings, lists, quotes, rules, breaks and page breaks", () => {
    expect(
      html({ type: "heading", attrs: { level: 2, textAlign: "right" }, content: [text("T")] }),
    ).toBe('<h2 style="text-align:right">T</h2>');
    const item = (t: string) => ({ type: "listItem", content: [p(text(t))] });
    expect(html({ type: "bulletList", content: [item("a"), item("b")] })).toBe(
      "<ul><li><p>a</p></li><li><p>b</p></li></ul>",
    );
    expect(html({ type: "orderedList", attrs: { start: 3 }, content: [item("c")] })).toBe(
      '<ol start="3"><li><p>c</p></li></ol>',
    );
    expect(html({ type: "orderedList", attrs: { start: 1 }, content: [item("c")] })).toBe(
      "<ol><li><p>c</p></li></ol>",
    );
    expect(html({ type: "blockquote", content: [p(text("q"))] })).toBe(
      "<blockquote><p>q</p></blockquote>",
    );
    expect(html({ type: "horizontalRule" }, { type: "pageBreak" })).toBe(
      '<hr><div style="break-before:page"></div>',
    );
    expect(html(p(text("a"), { type: "hardBreak" }, text("b")))).toBe("<p>a<br>b</p>");
  });

  it("applies marks in order, outermost first", () => {
    const marks = [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }];
    expect(html(p(text("x", marks)))).toBe("<p><strong><em><u><s>x</s></u></em></strong></p>");
    const link = {
      type: "link",
      attrs: { href: "https://example.com/?a=1&b='2'", target: "_blank" },
    };
    expect(html(p(text("l", [link])))).toBe(
      '<p><a href="https://example.com/?a=1&amp;b=&#39;2&#39;">l</a></p>',
    );
    const colour = { type: "textStyle", attrs: { color: "#ff0000" } };
    expect(html(p(text("c", [colour])))).toBe('<p><span style="color:#ff0000">c</span></p>');
    expect(html(p(text("n", [{ type: "textStyle", attrs: { color: null } }])))).toBe("<p>n</p>");
  });
});

describe("compileDoc: merge fields", () => {
  it("emits Liquid output, with marks", () => {
    expect(html(p(text("Dear "), merge("name"), text(",")))).toBe("<p>Dear {{ name }},</p>");
    expect(html(p({ ...merge("name"), marks: [{ type: "bold" }] }))).toBe(
      "<p><strong>{{ name }}</strong></p>",
    );
    expect(html(p(merge("page"), text(" of "), merge("pages")))).toBe(
      "<p>{{ page }} of {{ pages }}</p>",
    );
  });

  it("emits each filter with escaped arguments", () => {
    const cases: [unknown, string][] = [
      [{ name: "date", format: "MMM D, YYYY" }, '{{ d | date: "MMM D, YYYY" }}'],
      [
        { name: "date", format: `[at] "%}` },
        '{{ d | date: "\\u005bat\\u005d \\u0022\\u0025\\u007d" }}',
      ],
      [{ name: "number", decimals: 2 }, "{{ d | number: 2 }}"],
      [{ name: "currency", currency: "EUR" }, '{{ d | currency: "EUR" }}'],
      [{ name: "upcase" }, "{{ d | upcase }}"],
      [{ name: "downcase" }, "{{ d | downcase }}"],
      [{ name: "capitalize" }, "{{ d | capitalize }}"],
      [{ name: "lines" }, "{{ d | escape | newline_to_br | raw }}"],
      [null, "{{ d }}"],
    ];
    for (const [filter, expected] of cases)
      expect(html(p(merge("d", filter)))).toBe(`<p>${expected}</p>`);
  });

  it("rejects filters with bad arguments and unknown filters", () => {
    const bad = (filter: unknown) =>
      docSchema.safeParse({ type: "doc", content: [p(merge("d", filter))] }).success;
    expect(bad({ name: "currency", currency: 'USD" | raw' })).toBe(false);
    expect(bad({ name: "raw" })).toBe(false);
    expect(bad({ name: "number", decimals: "2 | raw" })).toBe(false);
  });

  it("rejects field paths that aren't identifiers", () => {
    for (const field of ["name | raw", "a.b.c", "Name", "x }}{{ y", ""]) {
      expect(docSchema.safeParse({ type: "doc", content: [p(merge(field))] }).success).toBe(false);
    }
  });
});

describe("compileDoc: structure", () => {
  const repeat = (field: string, ...content: unknown[]) => ({
    type: "repeatingSection",
    attrs: { field },
    content,
  });
  const when = (condition: unknown, ...content: unknown[]) => ({
    type: "conditionalSection",
    attrs: { condition },
    content,
  });
  const compile = (...content: unknown[]) => compileDoc(doc(...content), sections);

  it("compiles repeating sections, resolving group fields to the item", () => {
    expect(compile(repeat("items", p(merge("items.desc"), text(" by "), merge("name"))))).toBe(
      "{% for item in items %}<p>{{ item.desc }} by {{ name }}</p>{% endfor %}",
    );
  });

  it("refuses group fields outside their repeat, and nested repeats", () => {
    expect(() => compile(p(merge("items.desc")))).toThrow(TemplateCompileError);
    expect(() => compile(repeat("other", p(merge("items.desc"))))).toThrow(
      /repeating section over "items"/,
    );
    expect(() => compile(repeat("items", repeat("items", p(text("x")))))).toThrow(/can't nest/);
  });

  it("compiles every condition operator", () => {
    const cases: [unknown, string, string][] = [
      [{ field: "name", op: "is_set" }, "{% if name != blank %}", "{% endif %}"],
      [
        { field: "name", op: "equals", value: "Bob's" },
        '{% if name == "Bob\\u0027s" %}',
        "{% endif %}",
      ],
      [{ field: "name", op: "equals", value: 3 }, "{% if name == 3 %}", "{% endif %}"],
      [{ field: "name", op: "equals", value: true }, "{% if name == true %}", "{% endif %}"],
      [
        { field: "name", op: "not_equals", value: "x" },
        '{% unless name == "x" %}',
        "{% endunless %}",
      ],
      [
        { field: "name", op: "one_of", values: ["a", 2] },
        '{% if name == "a" or name == 2 %}',
        "{% endif %}",
      ],
      [{ field: "name", op: "gt", value: 5 }, "{% if name > 5 %}", "{% endif %}"],
      [
        { field: "name", op: "lt", value: "2026-01-01" },
        '{% if name < "2026-01-01" %}',
        "{% endif %}",
      ],
      [
        { field: "tags", op: "equals", value: "vip" },
        '{% if tags contains "vip" %}',
        "{% endif %}",
      ],
      [
        { field: "tags", op: "not_equals", value: "vip" },
        '{% unless tags contains "vip" %}',
        "{% endunless %}",
      ],
      [
        { field: "tags", op: "one_of", values: ["a", "b"] },
        '{% if tags contains "a" or tags contains "b" %}',
        "{% endif %}",
      ],
    ];
    for (const [condition, open, close] of cases) {
      expect(compile(when(condition, p(text("x"))))).toBe(`${open}<p>x</p>${close}`);
    }
  });

  it("resolves conditions on group fields inside the repeat", () => {
    const inner = when({ field: "items.flags", op: "equals", value: "x" }, p(text("flagged")));
    expect(compile(repeat("items", inner))).toBe(
      '{% for item in items %}{% if item.flags contains "x" %}<p>flagged</p>{% endif %}{% endfor %}',
    );
    expect(() => compile(when({ field: "items.qty", op: "gt", value: 1 }))).toThrow(
      TemplateCompileError,
    );
  });

  it("compiles asset and field images", () => {
    const assetId = "0d4c8f5e-3b1a-4c2d-9e8f-7a6b5c4d3e2f";
    expect(compile({ type: "image", attrs: { assetId, alt: 'Logo "x"', width: 50 } })).toBe(
      `<img src="{{ "${assetId}" | asset_url }}" alt="Logo &quot;x&quot;" style="width:50%">`,
    );
    expect(compile({ type: "image", attrs: { field: "logo", assetId: null } })).toBe(
      '{% if logo != blank %}<img src="{{ logo }}" alt="">{% endif %}',
    );
  });

  it("requires an image to have exactly one source", () => {
    const valid = (attrs: unknown) =>
      docSchema.safeParse({ type: "doc", content: [{ type: "image", attrs }] }).success;
    expect(valid({})).toBe(false);
    expect(valid({ assetId: "0d4c8f5e-3b1a-4c2d-9e8f-7a6b5c4d3e2f", field: "logo" })).toBe(false);
    expect(valid({ assetId: "not-a-uuid" })).toBe(false);
  });

  it("compiles tables with header rows, spans and repeating rows", () => {
    const cell = (type: string, t: unknown, attrs?: unknown) => ({ type, attrs, content: [p(t)] });
    const table = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [cell("tableHeader", text("Item")), cell("tableHeader", text("Qty"))],
        },
        {
          type: "tableRow",
          attrs: { repeat: "items" },
          content: [cell("tableCell", merge("items.desc")), cell("tableCell", merge("items.qty"))],
        },
        {
          type: "tableRow",
          attrs: { repeat: null },
          content: [cell("tableCell", text("Total"), { colspan: 2, rowspan: 1 })],
        },
      ],
    };
    expect(compile(table)).toBe(
      "<table><thead><tr><th><p>Item</p></th><th><p>Qty</p></th></tr></thead><tbody>" +
        "{% for item in items %}<tr><td><p>{{ item.desc }}</p></td><td><p>{{ item.qty }}</p></td></tr>{% endfor %}" +
        '<tr><td colspan="2"><p>Total</p></td></tr></tbody></table>',
    );
  });

  it("puts a header-only table in thead, and a header column in tbody", () => {
    const row = (...types: string[]) => ({
      type: "tableRow",
      content: types.map((type) => ({ type, content: [] })),
    });
    expect(compile({ type: "table", content: [row("tableHeader")] })).toBe(
      "<table><thead><tr><th></th></tr></thead></table>",
    );
    expect(compile({ type: "table", content: [row("tableHeader", "tableCell")] })).toBe(
      "<table><tbody><tr><th></th><td></td></tr></tbody></table>",
    );
  });

  it("drops unknown attrs but rejects unknown nodes and marks", () => {
    const parsed = docSchema.parse({
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: null, id: "x" } }],
    });
    expect(parsed.content[0]).toEqual({ type: "paragraph", attrs: { textAlign: null } });
    expect(docSchema.safeParse({ type: "doc", content: [{ type: "codeBlock" }] }).success).toBe(
      false,
    );
    expect(
      docSchema.safeParse({ type: "doc", content: [p(text("x", [{ type: "code" }]))] }).success,
    ).toBe(false);
    const js = { type: "link", attrs: { href: "javascript:alert(1)" } };
    expect(docSchema.safeParse({ type: "doc", content: [p(text("x", [js]))] }).success).toBe(false);
    const css = { type: "textStyle", attrs: { color: "red;background:url(x)" } };
    expect(docSchema.safeParse({ type: "doc", content: [p(text("x", [css]))] }).success).toBe(
      false,
    );
  });
});

describe("compileDesignedContent", () => {
  const visual: DesignedContent = designedContentSchema.parse({
    mode: "visual",
    body: doc(p(text("Body"))),
    header: { height: 20, doc: doc(p(text("Head"))), firstPage: doc(p(text("Letterhead"))) },
    footer: { height: 10, doc: doc(p(text("Page "), merge("page"))) },
  });

  it("compiles body and bands", () => {
    expect(compileDesignedContent(visual, sections)).toEqual({
      html: "<p>Body</p>",
      header: { height: 20, html: "<p>Head</p>", firstPageHtml: "<p>Letterhead</p>" },
      footer: { height: 10, html: "<p>Page {{ page }}</p>" },
    });
  });

  it("omits missing bands", () => {
    const bare = designedContentSchema.parse({ mode: "visual", body: doc() });
    expect(compileDesignedContent(bare, sections)).toEqual({ html: "" });
  });

  it("passes code mode through, and converting to code mode keeps the output", () => {
    const code = toCodeMode(visual, sections);
    expect(code.mode).toBe("code");
    expect(compileDesignedContent(code, sections)).toEqual(
      compileDesignedContent(visual, sections),
    );
  });

  it("puts each top-level block on its own line in code mode", () => {
    const two = designedContentSchema.parse({
      mode: "visual",
      body: doc(p(text("One")), p(text("Two"))),
    });
    const code = toCodeMode(two, sections);
    expect(code.mode === "code" && code.body).toBe("<p>One</p>\n<p>Two</p>");
  });

  it("carries template CSS in both modes", () => {
    const styled = designedContentSchema.parse({
      mode: "visual",
      body: doc(p(text("Body"))),
      css: "h1 { color: navy; }",
    });
    expect(compileDesignedContent(styled, sections).css).toBe("h1 { color: navy; }");
    expect(compileDesignedContent(toCodeMode(styled, sections), sections).css).toBe(
      "h1 { color: navy; }",
    );
  });
});

describe("raw HTML blocks", () => {
  const raw = (value: string) => ({ type: "rawHtml", attrs: { html: value } });

  it("outputs the markup verbatim, Liquid included", () => {
    expect(html(raw('<div class="x">{{ name | upcase }}</div>'), p(text("<b>")))).toBe(
      '<div class="x">{{ name | upcase }}</div><p>&lt;b&gt;</p>',
    );
  });

  it("isn't checked against the fields", () => {
    const content = designedContentSchema.parse({
      mode: "visual",
      body: doc(raw("{{ not_a_field }}")),
    });
    expect(templateFieldProblems(content, sections)).toEqual([]);
  });
});

describe("templateFieldProblems", () => {
  const problems = (body: unknown[], footer?: unknown[]) =>
    templateFieldProblems(
      designedContentSchema.parse({
        mode: "visual",
        body: doc(...body),
        footer: footer ? { height: 10, doc: doc(...footer) } : null,
      }),
      sections,
    ).map((problem) => problem.message);

  it("passes a template that fits its fields", () => {
    const body = [
      p(merge("name")),
      { type: "image", attrs: { field: "logo" } },
      { type: "repeatingSection", attrs: { field: "items" }, content: [p(merge("items.qty"))] },
      {
        type: "conditionalSection",
        attrs: { condition: { field: "tags", op: "is_set" } },
        content: [],
      },
    ];
    expect(problems(body, [p(merge("page"), merge("pages"))])).toEqual([]);
  });

  it("flags undeclared and misplaced references", () => {
    const body: unknown[] = [
      p(merge("old_name")),
      p(merge("items")),
      p(merge("items.qty")),
      p(merge("page")),
      { type: "image", attrs: { field: "name" } },
      { type: "repeatingSection", attrs: { field: "name" }, content: [] },
      {
        type: "conditionalSection",
        attrs: { condition: { field: "gone", op: "is_set" } },
        content: [],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            attrs: { repeat: "items" },
            content: [{ type: "tableCell", content: [p(merge("items.nope"))] }],
          },
        ],
      },
    ];
    expect(problems(body)).toEqual([
      '"old_name" isn\'t a declared field',
      '"items" is a repeating group; use a repeating section or table row',
      '"items.qty" can only be used inside a repeating section over "items"',
      "{{ page }} only works in a header or footer",
      '"name" isn\'t an image or signature field',
      '"name" isn\'t a repeating group',
      '"gone" isn\'t a declared field',
      '"items.nope" isn\'t a declared field',
    ]);
  });

  it("ignores code mode", () => {
    const code = designedContentSchema.parse({ mode: "code", body: "{{ whatever }}" });
    expect(templateFieldProblems(code, sections)).toEqual([]);
  });
});
