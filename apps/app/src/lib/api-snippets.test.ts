import { describe, expect, it } from "vitest";
import { renderSnippets, type V1RenderBody } from "./api-snippets";

const body: V1RenderBody = {
  html: `<p class="x">It's '''quoted''' and """triple""" \\ back\\slash</p>`,
  data: { note: 'say "hi"\n' },
  page: {
    size: "A4",
    orientation: "portrait",
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  },
  filename: "My quote / 2026",
  output: { pdfa: "2b", pdfua: true, certify: false, lang: "fr-CA" },
};
const snippets = renderSnippets(body, "https://docs.example.com/");

/** The text between two markers, the first line after `start` up to the line `end` begins. */
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start) + start.length;
  return text.slice(from, text.indexOf(end, from));
};

describe("renderSnippets", () => {
  it("targets /api/v1/render and reads the key from the environment", () => {
    expect(snippets.curl).toContain('"https://docs.example.com/api/v1/render"');
    expect(snippets.curl).toContain("x-api-key: $NECODOC_API_KEY");
    expect(snippets.typescript).toContain('baseUrl: "https://docs.example.com"');
    expect(snippets.typescript).toContain("process.env.NECODOC_API_KEY");
    expect(snippets.python).toContain('os.environ["NECODOC_API_KEY"]');
    expect(snippets.dotnet).toContain('GetEnvironmentVariable("NECODOC_API_KEY")');
    expect(snippets.java).toContain('System.getenv("NECODOC_API_KEY")');
    for (const code of Object.values(snippets)) expect(code).not.toMatch(/nd_\w/);
  });

  it("names the output file safely", () => {
    expect(snippets.curl).toContain("-o My-quote-2026.pdf");
    expect(snippets.java).toContain('Path.of("My-quote-2026.pdf")');
  });

  it("embeds the body so each language reads back the same JSON", () => {
    expect(JSON.parse(between(snippets.curl, "<<'JSON'\n", "\nJSON"))).toEqual(body);
    // Python: a raw string, with ''' written as JSON escapes.
    const python = between(snippets.python, "r'''", "''')");
    expect(python).not.toContain("'''");
    expect(JSON.parse(python)).toEqual(body);
    // C#: a raw string, no escapes; JSON never holds """.
    const csharp = between(snippets.dotnet, 'Deserialize<RenderRequest>("""\n', '\n    """');
    expect(csharp).not.toContain('"""');
    expect(JSON.parse(csharp.replace(/^ {4}/gm, ""))).toEqual(body);
    // Java: a text block, which processes escapes.
    const java = between(snippets.java, 'readValue("""\n', '\n    """')
      .replace(/^ {4}/gm, "")
      .replace(/\\(["\\])/g, "$1");
    expect(JSON.parse(java)).toEqual(body);
  });

  it("passes the body to the TypeScript SDK as a typed object literal", () => {
    const literal = between(snippets.typescript, 'Schema<"RenderRequest"> = ', ";\nconst {");
    expect(JSON.parse(literal)).toEqual(body);
  });
});
