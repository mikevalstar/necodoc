---
title: SDKs
description: Client libraries for the public API, generated from its OpenAPI document.
sidebar:
  order: 0
---

SDKs are generated from the `/api/v1` OpenAPI document, so they match the [API reference](/reference/api/).

| Language | Package | Built on |
| --- | --- | --- |
| [TypeScript](/reference/sdks/typescript/) | `@necodoc/sdk` (`packages/sdk-ts`) | openapi-typescript + openapi-fetch |
| [Python](/reference/sdks/python/) | `necodoc` (`packages/sdk-python`) | openapi-generator: pydantic, urllib3 |
| [.NET](/reference/sdks/dotnet/) | `Necodoc.Sdk` (`packages/sdk-dotnet`) | openapi-generator: System.Text.Json, `HttpClient` |
| [Java](/reference/sdks/java/) | `dev.necodoc:necodoc-sdk` (`packages/sdk-java`) | openapi-generator: `java.net.http`, Jackson |

## Limitations

- **Not published yet.** None of the SDKs is on npm, PyPI, NuGet or Maven Central. Install them
  from a checkout of the repository, as each page shows.
- **PDF-or-JSON answers come back as bytes** in Python, .NET and Java. Render and generate answer
  200 with the PDF, or with JSON when you ask for `response: json` or a signing package. Those
  three SDKs always return the raw body; parse JSON with the SDK's own `GenerationResult` or
  `SigningPackage` model. In TypeScript, `parseAs: "arrayBuffer"` asks for the PDF.
- **Match your deployment.** An SDK built from a newer necodoc may know fields your deployment
  doesn't. Every deployment serves its document at `/api/v1/openapi.json`; generate your own
  client from it (for example with [openapi-generator](https://openapi-generator.tech)) if you
  need an exact match or another language.

The Python, .NET and Java SDKs have a smoke example (`examples/` in each package) that renders
HTML, generates from a template as JSON and as a signing package against a running deployment.
The TypeScript SDK has none; its page shows the same calls.
