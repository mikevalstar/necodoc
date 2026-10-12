import type { RenderRequestInput } from "@necodoc/shared";

// Spec: docs/features/html-to-pdf-api.md (Render page). The render page's request as a
// POST /api/v1/render call, for curl and each generated SDK (packages/sdk-*). The key always
// comes from $NECODOC_API_KEY: a real key never goes into a snippet.

/** The fields /api/v1/render shares with the app's render (previews and theme drafts are the app's). */
export type V1RenderBody = Omit<RenderRequestInput, "preview" | "themeDraft" | "signing">;

export const snippetLanguages = ["curl", "typescript", "python", "dotnet", "java"] as const;
export type SnippetLanguage = (typeof snippetLanguages)[number];

export const snippetLabels: Record<SnippetLanguage, string> = {
  curl: "curl",
  typescript: "TypeScript",
  python: "Python",
  dotnet: ".NET",
  java: "Java",
};

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line) => (line ? by + line : line))
    .join("\n");

/** A filename safe to put unquoted on a shell or in a string literal. */
const pdfName = (filename: string | undefined) =>
  `${filename?.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "document"}.pdf`;

export function renderSnippets(
  body: V1RenderBody,
  origin: string,
): Record<SnippetLanguage, string> {
  const json = JSON.stringify(body, null, 2);
  const file = pdfName(body.filename);
  const base = origin.replace(/\/+$/, "");
  const v1 = `${base}/api/v1`;
  return {
    // A quoted heredoc: nothing in the body is expanded by the shell.
    curl: `curl -X POST "${v1}/render" \\
  -H "x-api-key: $NECODOC_API_KEY" \\
  -H "content-type: application/json" \\
  -o ${file} \\
  --data-binary @- <<'JSON'
${json}
JSON`,
    // The body is typed on its own: inline, enum fields like page.size widen and openapi-fetch
    // stops reading parseAs, so `pdf` loses its ArrayBuffer type.
    typescript: `import { writeFile } from "node:fs/promises";
import { createNecodocClient, type Schema } from "@necodoc/sdk";

const necodoc = createNecodocClient({
  baseUrl: ${JSON.stringify(base)},
  apiKey: process.env.NECODOC_API_KEY!,
});

const body: Schema<"RenderRequest"> = ${json};
const { data: pdf, error } = await necodoc.POST("/render", { body, parseAs: "arrayBuffer" });
if (error) throw new Error(\`\${error.code}: \${error.error}\`);
await writeFile(${JSON.stringify(file)}, new Uint8Array(pdf));`,
    // Raw triple-quoted: JSON's escapes stay as they are. A literal ''' inside a JSON string is
    // written as its \\u0027 escape so it can't end the Python string.
    python: `import os
import necodoc
from necodoc.models import RenderRequest

config = necodoc.Configuration(host=${JSON.stringify(v1)})
config.api_key["apiKey"] = os.environ["NECODOC_API_KEY"]
client = necodoc.ApiClient(config)

request = RenderRequest.from_json(r'''
${json.replaceAll("'''", "\\u0027\\u0027\\u0027")}
''')
pdf: bytes = necodoc.RenderApi(client).post_render(request)
open(${JSON.stringify(file)}, "wb").write(pdf)`,
    // A C# 11 raw string: no escapes. JSON escapes quotes inside strings, so """ never occurs.
    dotnet: `using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Necodoc.Sdk.Api;
using Necodoc.Sdk.Client;
using Necodoc.Sdk.Extensions;
using Necodoc.Sdk.Model;

var services = new ServiceCollection();
services.AddLogging();
services.AddApi(options =>
{
    options.AddTokens(new ApiKeyToken(
        Environment.GetEnvironmentVariable("NECODOC_API_KEY")!, ClientUtils.ApiKeyHeader.X_api_key, ""));
    options.AddApiHttpClients(client => client.BaseAddress = new Uri(${JSON.stringify(v1)}));
});
var provider = services.BuildServiceProvider();
var json = provider.GetRequiredService<JsonSerializerOptionsProvider>().Options;

var request = JsonSerializer.Deserialize<RenderRequest>("""
${indent(json, "    ")}
    """, json)!;
var response = await provider.GetRequiredService<IRenderApi>().PostRenderAsync(request);
if (response.TryOk(out var pdf))
{
    await using var file = File.Create(${JSON.stringify(file)});
    await pdf.CopyToAsync(file);
}`,
    // A text block (Java 15+) processes escapes, so JSON's backslashes are doubled.
    java: `import dev.necodoc.sdk.ApiClient;
import dev.necodoc.sdk.JSON;
import dev.necodoc.sdk.api.RenderApi;
import dev.necodoc.sdk.model.RenderRequest;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

ApiClient client = new ApiClient();
client.updateBaseUri(${JSON.stringify(v1)});
client.setRequestInterceptor(request -> request.header("x-api-key", System.getenv("NECODOC_API_KEY")));

RenderRequest request = JSON.getDefault().getMapper().readValue("""
${indent(json.replaceAll("\\", "\\\\"), "    ")}
    """, RenderRequest.class);
File pdf = new RenderApi(client).postRender(request);
Files.copy(pdf.toPath(), Path.of(${JSON.stringify(file)}), StandardCopyOption.REPLACE_EXISTING);`,
  };
}
