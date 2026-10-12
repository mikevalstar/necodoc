// Smoke test for the necodoc .NET SDK against a running deployment. Renders HTML to a PDF, then
// (with NECODOC_TEMPLATE_ID) generates from a published template as JSON and as a signing package.
//
//   NECODOC_URL=http://localhost:3000 NECODOC_API_KEY=nd_... \
//   NECODOC_TEMPLATE_ID=<uuid> NECODOC_TEMPLATE_DATA='{"client_name": "Acme"}' dotnet run

using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Necodoc.Sdk.Api;
using Necodoc.Sdk.Client;
using Necodoc.Sdk.Extensions;
using Necodoc.Sdk.Model;

var baseUrl = (Environment.GetEnvironmentVariable("NECODOC_URL") ?? "http://localhost:3000").TrimEnd('/');
var apiKey = Environment.GetEnvironmentVariable("NECODOC_API_KEY")
    ?? throw new InvalidOperationException("Set NECODOC_API_KEY");

var services = new ServiceCollection();
services.AddLogging();
services.AddApi(options =>
{
    // An empty prefix: the key goes in x-api-key as is.
    options.AddTokens(new ApiKeyToken(apiKey, ClientUtils.ApiKeyHeader.X_api_key, ""));
    options.AddApiHttpClients(client => client.BaseAddress = new Uri($"{baseUrl}/api/v1"));
});
await using var provider = services.BuildServiceProvider();
var json = provider.GetRequiredService<JsonSerializerOptionsProvider>().Options;

// Render HTML to a PDF: the 200 body is the PDF's bytes.
var render = await provider.GetRequiredService<IRenderApi>().PostRenderAsync(new RenderRequest(
    html: "<h1>Invoice {{ number }}</h1>",
    data: new Dictionary<string, object> { ["number"] = "A-1001" },
    footer: new RenderRequestHeader("<p>{{ page }} / {{ pages }}</p>", 12)));
if (!render.TryOk(out var pdf)) Fail(render);
await using (var file = File.Create("smoke-render.pdf")) await pdf.CopyToAsync(file);
Console.WriteLine($"render: {new FileInfo("smoke-render.pdf").Length} bytes -> smoke-render.pdf");

var templateIdText = Environment.GetEnvironmentVariable("NECODOC_TEMPLATE_ID");
if (string.IsNullOrEmpty(templateIdText))
{
    Console.WriteLine("NECODOC_TEMPLATE_ID not set; skipping the template steps.");
    return;
}
var templateId = Guid.Parse(templateIdText);
var data = JsonSerializer.Deserialize<Dictionary<string, object>>(
    Environment.GetEnvironmentVariable("NECODOC_TEMPLATE_DATA") ?? "{}")!;
var templates = provider.GetRequiredService<ITemplatesApi>();

// Generate as JSON: still a byte stream, parsed with the SDK's model (ADR 0041).
var generated = await templates.PostTemplatesByIdVersionsByVersionGenerateAsync(templateId, "latest",
    new GenerateRequest(data: data, response: RenderRequestResponse.Json));
if (!generated.TryOk(out var resultBody)) Fail(generated);
var result = JsonSerializer.Deserialize<GenerationResult>(resultBody, json)!;
Console.WriteLine($"generate: {result.GenerationId}, {result.PageCount} page(s), {result.DownloadUrl}");

// A signing package instead of the PDF.
var signing = await templates.PostTemplatesByIdVersionsByVersionGenerateAsync(templateId, "latest",
    new GenerateRequest(data: data, signing: new SigningOptions(true, default)));
if (!signing.TryOk(out var packageBody)) Fail(signing);
var package = JsonSerializer.Deserialize<SigningPackage>(packageBody, json)!;
Console.WriteLine($"signing: {package.Signers.Count} signer(s), {package.Boxes.Count} box(es)");

// The same package later, typed directly: this endpoint only answers JSON.
var again = await provider.GetRequiredService<IGenerationsApi>()
    .GetGenerationsByIdSigningPackageAsync(package.GenerationId, new List<GetGenerationsByIdSigningPackageFormatsParameterInner> { GetGenerationsByIdSigningPackageFormatsParameterInner.Docusign });
if (!again.TryOk(out var typed)) Fail(again);
Console.WriteLine($"signing-package: {typed.Filename}, docusign: {typed.Formats.Docusign is not null}");

// Non-2xx answers carry the API's error JSON (`fieldErrors` on 422) as RawContent.
[DoesNotReturn]
static void Fail(IApiResponse response)
{
    Console.Error.WriteLine($"API error {(int)response.StatusCode}: {response.RawContent}");
    Environment.Exit(1);
}
