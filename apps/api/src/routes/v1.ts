import {
  fieldErrors,
  jsonSchemaDocumentSchema,
  type SigningOptions,
  signingOptionsOf,
  signingPackageQuerySchema,
  templateDataSchema,
  templateJsonSchema,
  v1BatchSchema,
  v1BatchSummarySchema,
  v1CombineSchema,
  v1ErrorSchema,
  v1GenerateSchema,
  v1GenerationResultSchema,
  v1GenerationSchema,
  v1PendingSchema,
  v1RenderSchema,
  v1SigningPackageSchema,
  v1TemplateDetailSchema,
  v1TemplateSchema,
  versionParamSchema,
} from "@necodoc/shared";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { type Context, Hono } from "hono";
import {
  type DescribeRouteOptions,
  describeRoute,
  type GenerateSpecOptions,
  generateSpecs,
  resolver,
  validator,
} from "hono-openapi";
import { z } from "zod";
import { type ApiKeyEnv, requireScope, templateAllowed, v1Error } from "../api-keys";
import { db } from "../db";
import { batch, generation, template, templateVersion, theme, user } from "../db/schema";
import { mintLink, serveFile } from "../download";
import { storeFile } from "../files";
import { type GenerationResult, generate } from "../generate";
import type { AppEnv } from "../middleware";
import { signingQueryOptions, signingResponse } from "../signing-package";
import { batchPacket, batchSummaries, batchZip, createBatch } from "./batches";
import { selectSummaries } from "./generations";
import { findVersion, latest, versionRequest } from "./templates";

// Spec: docs/features/html-to-pdf-api.md. The public API: API keys only (ADR 0019, ADR 0029),
// described for OpenAPI by hono-openapi (ADR 0030). Every route has a describeRoute; the
// document is served at /api/v1/openapi.json and drives the developer docs and SDKs.

// ---------------------------------------------------------------------------------------------
// Validation in the public error format

type Issue = StandardSchemaV1.Issue;

function issueErrors(issues: readonly Issue[]) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const path = (issue.path ?? [])
      .map((part) => String(typeof part === "object" ? part.key : part))
      .join(".");
    errors[path] = [...(errors[path] ?? []), issue.message];
  }
  return errors;
}

const invalid = (
  result: { success: true } | { success: false; error: readonly Issue[] },
  c: Context,
) => {
  if (result.success) return;
  const errors = issueErrors(result.error);
  const summary = Object.entries(errors)
    .map(([path, messages]) => `${path || "(body)"}: ${messages.join(", ")}`)
    .join("; ");
  return v1Error(c, 422, "invalid_request", summary, { fieldErrors: errors });
};

const json = <S extends StandardSchemaV1>(schema: S) => validator("json", schema, invalid);
const params = <S extends StandardSchemaV1>(schema: S) => validator("param", schema, invalid);

const idParams = z.object({ id: z.uuid() });
const versionParams = z.object({
  id: z.uuid(),
  version: versionParamSchema.meta({ description: "A version number, or `latest`." }),
});

// ---------------------------------------------------------------------------------------------
// OpenAPI fragments

const errorBody = (description: string) => ({
  description,
  content: { "application/json": { schema: resolver(v1ErrorSchema) } },
});
const jsonBody = (description: string, schema: StandardSchemaV1) => ({
  description,
  content: { "application/json": { schema: resolver(schema) } },
});
const pdfContent = { "application/pdf": { schema: { type: "string", format: "binary" } } } as const;

/** Every keyed route can answer these. */
const keyErrors = {
  401: errorBody("Missing, unknown, revoked or expired key, or the key's account is disabled."),
  403: errorBody("The key lacks the scope, role, template or source address this call needs."),
  429: {
    ...errorBody("Rate limit exceeded."),
    headers: {
      "Retry-After": {
        description: "Seconds until the key may call again.",
        schema: { type: "integer" as const },
      },
    },
  },
};
const invalidRequest = { 422: errorBody("Invalid request or data; `fieldErrors` lists each.") };
const notFound = { 404: errorBody("Not found, or not yours.") };

/** Render, generate and combine: the PDF, JSON with a link, or 202 while it's still running. */
const renderResponses = {
  200: {
    description:
      "Rendered. `response: pdf` (default) returns the bytes; `response: json` returns the generation.",
    headers: {
      "X-Generation-Id": {
        description: "The generation log entry.",
        schema: { type: "string" as const },
      },
      "X-Page-Count": { description: "Pages in the PDF.", schema: { type: "integer" as const } },
    },
    content: {
      ...pdfContent,
      "application/json": { schema: resolver(v1GenerationResultSchema) },
    },
  },
  202: jsonBody(
    "Still queued or running (async, or the wait ran out). Poll the generation.",
    v1PendingSchema,
  ),
  ...invalidRequest,
  ...keyErrors,
} satisfies DescribeRouteOptions["responses"];

/** Render and generate: as above, or the signing package with `signing`. */
const signingRenderResponses = {
  ...renderResponses,
  200: {
    ...renderResponses[200],
    description: `${renderResponses[200].description} With \`signing\`, the signing package.`,
    content: {
      ...pdfContent,
      "application/json": {
        schema: resolver(z.union([v1GenerationResultSchema, v1SigningPackageSchema])),
      },
    },
  },
} satisfies DescribeRouteOptions["responses"];

// ---------------------------------------------------------------------------------------------
// Answers

/**
 * How render, generate and combine answer for `response` (spec: Responses). `signing` answers the
 * signing package instead (docs/features/signing-packages.md).
 */
async function answer(
  c: Context<ApiKeyEnv>,
  result: GenerationResult,
  response: "pdf" | "json",
  signing?: SigningOptions,
) {
  switch (result.status) {
    case "error":
      return v1Error(c, 422, "render_failed", result.error, { generationId: result.generationId });
    case "success": {
      if (signing) {
        const [row] = await db
          .select({ signing: generation.signing })
          .from(generation)
          .where(eq(generation.id, result.generationId));
        const pkg = await signingResponse(
          { ...result, id: result.generationId, signing: row?.signing ?? null },
          signing,
          c.get("apiKey").owner.id,
        );
        return c.json(pkg, 200);
      }
      if (response === "pdf") {
        return serveFile(c, {
          fileId: result.fileId,
          filename: result.filename,
          redirect: false,
          headers: {
            "X-Page-Count": String(result.pageCount),
            "X-Generation-Id": result.generationId,
          },
        });
      }
      const link = await mintLink({
        fileId: result.fileId,
        generationId: result.generationId,
        userId: c.get("apiKey").owner.id,
        expiresInSeconds: 3600,
      });
      return c.json(
        {
          generationId: result.generationId,
          status: result.status,
          filename: result.filename,
          pageCount: result.pageCount,
          size: result.size,
          downloadUrl: link.url,
          pdfPath: `/api/v1/generations/${result.generationId}/pdf`,
        },
        200,
      );
    }
    default:
      return c.json({ generationId: result.generationId, status: result.status }, 202);
  }
}

/** The key owner's own generation with a stored PDF. */
async function ownOutput(c: Context<ApiKeyEnv>, id: string) {
  const [row] = await db
    .select({ fileId: generation.outputFileId, filename: generation.filename })
    .from(generation)
    .where(and(eq(generation.id, id), eq(generation.userId, c.get("apiKey").owner.id)));
  return row?.fileId ? { fileId: row.fileId, filename: row.filename } : null;
}

async function ownBatch(c: Context<ApiKeyEnv>, id: string) {
  const [row] = await db
    .select({ id: batch.id, name: batch.templateName })
    .from(batch)
    .where(and(eq(batch.id, id), eq(batch.userId, c.get("apiKey").owner.id)));
  return row ?? null;
}

const publishedTemplates = () =>
  db
    .select({
      id: template.id,
      kind: template.kind,
      // What's published, not unpublished renames.
      name: templateVersion.name,
      description: templateVersion.description,
      latestVersion: templateVersion.version,
      publishedAt: templateVersion.publishedAt,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    })
    .from(template)
    .innerJoin(latest, eq(latest.templateId, template.id))
    .innerJoin(
      templateVersion,
      and(eq(templateVersion.templateId, template.id), eq(templateVersion.version, latest.version)),
    )
    .$dynamic();

// ---------------------------------------------------------------------------------------------
// Routes

const keyed = new Hono<AppEnv>()
  .post(
    "/render",
    describeRoute({
      tags: ["Render"],
      summary: "Render HTML to PDF",
      description:
        "HTML with Liquid (rendered with `data`), optional CSS, theme, header and footer bands, and page setup. `output.lang` is the document language: `date`, `number` and `currency` format for it, `t` looks text up in `translations`, and right-to-left languages lay out right to left. Logged in the generation log with source `api`.",
      requestBody: { content: { "application/json": { schema: resolver(v1RenderSchema) } } },
      responses: signingRenderResponses,
    }),
    requireScope("render:html"),
    json(v1RenderSchema),
    async (c) => {
      const key = c.get("apiKey");
      const { response, async, signing: asked, subject, ...request } = c.req.valid("json");
      const signing = asked ? signingOptionsOf(asked) : undefined;
      if (request.themeId) {
        const [found] = await db
          .select({ id: theme.id })
          .from(theme)
          .where(eq(theme.id, request.themeId));
        if (!found)
          return v1Error(c, 422, "invalid_request", `Theme ${request.themeId} doesn't exist`);
      }
      const result = await generate({
        request: {
          ...request,
          ...(signing ? { signing: { anchors: signing.anchors } } : {}),
          preview: false,
        },
        source: "api",
        userId: key.owner.id,
        apiKeyId: key.id,
        requestId: c.get("requestId"),
        subject,
        wait: !async,
      });
      return answer(c, result, response, signing);
    },
  )
  .get(
    "/templates",
    describeRoute({
      tags: ["Templates"],
      summary: "List published templates",
      description:
        "Published, non-archived templates, limited to the key's templates if it has any.",
      responses: { 200: jsonBody("Templates by name.", z.array(v1TemplateSchema)), ...keyErrors },
    }),
    requireScope("templates:read"),
    async (c) => {
      const { templateIds } = c.get("apiKey");
      const rows = await publishedTemplates()
        .where(
          and(
            isNull(template.archivedAt),
            templateIds.length ? inArray(template.id, templateIds) : undefined,
          ),
        )
        .orderBy(templateVersion.name);
      return c.json(rows, 200);
    },
  )
  .get(
    "/templates/:id",
    describeRoute({
      tags: ["Templates"],
      summary: "Get a template and its versions",
      responses: {
        200: jsonBody(
          "The template with its published versions, newest first.",
          v1TemplateDetailSchema,
        ),
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("templates:read"),
    params(idParams),
    async (c) => {
      const { id } = c.req.valid("param");
      if (!templateAllowed(c.get("apiKey"), id)) {
        return v1Error(c, 403, "template_not_allowed", "This key can't use that template");
      }
      const [found] = await publishedTemplates().where(
        and(eq(template.id, id), isNull(template.archivedAt)),
      );
      if (!found) return v1Error(c, 404, "not_found", "Template not found");
      const versions = await db
        .select({
          id: templateVersion.id,
          templateId: templateVersion.templateId,
          version: templateVersion.version,
          note: templateVersion.note,
          publisherName: user.name,
          publishedAt: templateVersion.publishedAt,
        })
        .from(templateVersion)
        .leftJoin(user, eq(user.id, templateVersion.publishedBy))
        .where(eq(templateVersion.templateId, id))
        .orderBy(desc(templateVersion.version));
      return c.json({ ...found, versions }, 200);
    },
  )
  .get(
    "/templates/:id/versions/:version/schema",
    describeRoute({
      tags: ["Templates"],
      summary: "Get a version's JSON Schema",
      description: "The JSON Schema the version's `data` must match.",
      responses: {
        200: jsonBody("JSON Schema (draft 2020-12).", jsonSchemaDocumentSchema),
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("templates:read"),
    params(versionParams),
    async (c) => {
      const key = c.get("apiKey");
      const { id, version } = c.req.valid("param");
      if (!templateAllowed(key, id)) {
        return v1Error(c, 403, "template_not_allowed", "This key can't use that template");
      }
      const row = await findVersion(key.owner, id, version);
      if (!row || row.archivedAt) return v1Error(c, 404, "not_found", "Version not found");
      return c.json(templateJsonSchema(row.version.sections), 200);
    },
  )
  .post(
    "/templates/:id/versions/:version/generate",
    describeRoute({
      tags: ["Templates"],
      summary: "Generate a PDF from a template",
      description:
        "Validates `data` against the version's fields (422 with every field error), then renders it. `output.lang` makes the PDF in another language than the template's: formatting, the template's translations and text direction follow it.",
      requestBody: { content: { "application/json": { schema: resolver(v1GenerateSchema) } } },
      responses: {
        ...signingRenderResponses,
        ...notFound,
        409: errorBody("The template is archived."),
      },
    }),
    requireScope("templates:generate"),
    params(versionParams),
    json(v1GenerateSchema),
    async (c) => {
      const key = c.get("apiKey");
      const { id, version } = c.req.valid("param");
      const {
        data,
        filename,
        async,
        response,
        signing: asked,
        output,
        subject,
      } = c.req.valid("json");
      const signing = asked ? signingOptionsOf(asked) : undefined;
      if (!templateAllowed(key, id)) {
        return v1Error(c, 403, "template_not_allowed", "This key can't use that template");
      }
      const row = await findVersion(key.owner, id, version);
      if (!row) return v1Error(c, 404, "not_found", "Version not found");
      if (row.archivedAt) return v1Error(c, 409, "template_archived", "This template is archived");
      const v = row.version;
      const parsed = templateDataSchema(v.sections).safeParse(data);
      if (!parsed.success) {
        return v1Error(c, 422, "invalid_data", "Invalid data", {
          fieldErrors: fieldErrors(parsed.error),
        });
      }
      const result = await generate({
        request: {
          ...versionRequest(v, parsed.data, filename ?? v.name, output),
          ...(signing ? { signing: { anchors: signing.anchors } } : {}),
        },
        source: "api",
        userId: key.owner.id,
        apiKeyId: key.id,
        requestId: c.get("requestId"),
        template: { id, versionId: v.id },
        subject,
        wait: !async,
      });
      return answer(c, result, response, signing);
    },
  )
  .post(
    "/templates/:id/versions/:version/batch",
    describeRoute({
      tags: ["Batches"],
      summary: "Start a batch",
      description:
        "One document per row, queued behind interactive renders. Invalid rows fail alone with their field errors. Poll the batch, or subscribe a webhook to `batch.completed`.",
      requestBody: { content: { "application/json": { schema: resolver(v1BatchSchema) } } },
      responses: {
        202: jsonBody("Queued.", v1BatchSummarySchema),
        ...notFound,
        409: errorBody("The template is archived."),
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("batches:write"),
    params(versionParams),
    json(v1BatchSchema),
    async (c) => {
      const key = c.get("apiKey");
      const target = c.req.valid("param");
      if (!templateAllowed(key, target.id)) {
        return v1Error(c, 403, "template_not_allowed", "This key can't use that template");
      }
      const result = await createBatch(
        key.owner,
        target,
        c.req.valid("json"),
        c.get("requestId"),
        key.id,
      );
      if (result.status !== undefined) {
        const code = result.status === 404 ? "not_found" : "template_archived";
        return v1Error(c, result.status, code, result.error);
      }
      return c.json(result.summary, 202);
    },
  )
  .get(
    "/batches/:id",
    describeRoute({
      tags: ["Batches"],
      summary: "Get a batch",
      description: "Status and progress (done, failed, cancelled of total).",
      responses: {
        200: jsonBody("The batch.", v1BatchSummarySchema),
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("batches:read"),
    params(idParams),
    async (c) => {
      const { id } = c.req.valid("param");
      const [summary] = await batchSummaries(
        and(eq(batch.id, id), eq(batch.userId, c.get("apiKey").owner.id)),
      );
      return summary ? c.json(summary, 200) : v1Error(c, 404, "not_found", "Batch not found");
    },
  )
  .get(
    "/batches/:id/zip",
    describeRoute({
      tags: ["Batches"],
      summary: "Download a batch as a ZIP",
      description: "Every PDF rendered so far, one file per row, streamed.",
      responses: {
        200: {
          description: "The ZIP.",
          content: { "application/zip": { schema: { type: "string", format: "binary" } } },
        },
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("batches:read"),
    params(idParams),
    async (c) => {
      const found = await ownBatch(c, c.req.valid("param").id);
      return found ? batchZip(c, found) : v1Error(c, 404, "not_found", "Batch not found");
    },
  )
  .get(
    "/batches/:id/packet",
    describeRoute({
      tags: ["Batches"],
      summary: "Download a batch as one PDF",
      description: "Every PDF rendered so far, merged in row order.",
      responses: {
        200: { description: "The packet.", content: pdfContent },
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("batches:read"),
    params(idParams),
    async (c) => {
      const found = await ownBatch(c, c.req.valid("param").id);
      return found ? batchPacket(c, found) : v1Error(c, 404, "not_found", "Batch not found");
    },
  )
  .get(
    "/generations/:id",
    describeRoute({
      tags: ["Generations"],
      summary: "Get a generation",
      description: "Status, timing, size and errors of one of the key owner's generations.",
      responses: {
        200: jsonBody("The generation.", v1GenerationSchema),
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("generations:read"),
    params(idParams),
    async (c) => {
      const { id } = c.req.valid("param");
      const [row] = await selectSummaries({
        requestId: generation.requestId,
        outputProfile: generation.outputProfile,
      }).where(and(eq(generation.id, id), eq(generation.userId, c.get("apiKey").owner.id)));
      return row ? c.json(row, 200) : v1Error(c, 404, "not_found", "Generation not found");
    },
  )
  .get(
    "/generations/:id/pdf",
    describeRoute({
      tags: ["Generations"],
      summary: "Download a generation's PDF",
      description:
        "Streams from storage with ETag (304 on `If-None-Match`) and single-range (206) support. `?download=1` sends it as an attachment.",
      responses: {
        200: { description: "The PDF.", content: pdfContent },
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("generations:read"),
    params(idParams),
    async (c) => {
      const output = await ownOutput(c, c.req.valid("param").id);
      return output
        ? serveFile(c, output)
        : v1Error(c, 404, "not_found", "No PDF for this generation");
    },
  )
  .post(
    "/generations/:id/link",
    describeRoute({
      tags: ["Generations"],
      summary: "Mint a signed download link",
      description: "A URL to the PDF that works without a key for an hour.",
      responses: {
        201: jsonBody("The link.", z.object({ url: z.url(), expiresAt: z.iso.datetime() })),
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("generations:read"),
    params(idParams),
    async (c) => {
      const { id } = c.req.valid("param");
      const output = await ownOutput(c, id);
      if (!output) return v1Error(c, 404, "not_found", "No PDF for this generation");
      const link = await mintLink({
        fileId: output.fileId,
        generationId: id,
        userId: c.get("apiKey").owner.id,
        expiresInSeconds: 3600,
      });
      return c.json(link, 201);
    },
  )
  .get(
    "/generations/:id/signing-package",
    describeRoute({
      tags: ["Generations"],
      summary: "Get a generation's signing package",
      description:
        "Signers, sign box positions and provider JSON (DocuSign, Dropbox Sign, Adobe Acrobat Sign) for handing the PDF to an e-sign service. Empty for documents without signers or sign boxes.",
      responses: {
        200: jsonBody("The signing package.", v1SigningPackageSchema),
        ...notFound,
        ...invalidRequest,
        ...keyErrors,
      },
    }),
    requireScope("generations:read"),
    params(idParams),
    validator("query", signingPackageQuerySchema, invalid),
    async (c) => {
      const { id } = c.req.valid("param");
      const owner = c.get("apiKey").owner.id;
      const [row] = await db
        .select({
          id: generation.id,
          filename: generation.filename,
          pageCount: generation.pageCount,
          fileId: generation.outputFileId,
          signing: generation.signing,
        })
        .from(generation)
        .where(and(eq(generation.id, id), eq(generation.userId, owner)));
      if (!row?.fileId) return v1Error(c, 404, "not_found", "No PDF for this generation");
      const options = signingQueryOptions(c.req.valid("query"));
      return c.json(await signingResponse({ ...row, fileId: row.fileId }, options, owner), 200);
    },
  )
  .post(
    "/combine",
    describeRoute({
      tags: ["Combine"],
      summary: "Combine PDFs into a packet",
      description:
        "Merges your generations and uploaded PDFs, in order, into one PDF. Each input's form is flattened. Logged with source `combine`.",
      requestBody: { content: { "application/json": { schema: resolver(v1CombineSchema) } } },
      responses: renderResponses,
    }),
    requireScope("combine:write"),
    json(v1CombineSchema),
    async (c) => {
      const key = c.get("apiKey");
      const { inputs, filename, response, async, output } = c.req.valid("json");
      const generationIds = inputs.flatMap((input) =>
        "generationId" in input ? [input.generationId] : [],
      );
      const found = generationIds.length
        ? await db
            .select({ id: generation.id, fileId: generation.outputFileId })
            .from(generation)
            .where(and(inArray(generation.id, generationIds), eq(generation.userId, key.owner.id)))
        : [];
      const outputs = new Map(found.map((row) => [row.id, row.fileId]));
      // Check everything before storing any upload.
      for (const [i, input] of inputs.entries()) {
        if ("generationId" in input && !outputs.get(input.generationId)) {
          return v1Error(c, 422, "invalid_input", `Input ${i + 1}: no PDF for that generation`);
        }
        if (
          "pdf" in input &&
          !Buffer.from(input.pdf.slice(0, 12), "base64").toString().startsWith("%PDF-")
        ) {
          return v1Error(c, 422, "invalid_input", `Input ${i + 1} isn't a PDF`);
        }
      }
      const parts: { fileId: string; generationId?: string }[] = [];
      for (const input of inputs) {
        if ("generationId" in input) {
          const fileId = outputs.get(input.generationId);
          if (fileId) parts.push({ fileId, generationId: input.generationId });
        } else {
          const bytes = new Uint8Array(Buffer.from(input.pdf, "base64"));
          parts.push({
            fileId: await storeFile(db, {
              bytes,
              mimeType: "application/pdf",
              ownerId: key.owner.id,
            }),
          });
        }
      }
      const result = await generate({
        request: {
          kind: "combine",
          parts,
          filename: filename ?? "packet",
          preview: false,
          ...(output ? { output } : {}),
        },
        source: "combine",
        userId: key.owner.id,
        apiKeyId: key.id,
        requestId: c.get("requestId"),
        wait: !async,
      });
      return answer(c, result, response);
    },
  );

// ---------------------------------------------------------------------------------------------
// The document

const specOptions: Partial<GenerateSpecOptions> = {
  documentation: {
    openapi: "3.1.0",
    info: {
      title: "necodoc API",
      version: "1.0.0",
      description:
        "Render HTML to PDF, generate from published templates (singly or in batches), and combine PDFs. Authenticate with an API key in the `x-api-key` header. Every response carries `X-Request-Id`.",
    },
    servers: [{ url: "/api/v1", description: "This deployment" }],
    tags: [
      { name: "Render", description: "HTML to PDF." },
      {
        name: "Templates",
        description: "Published templates, their schemas, and generating from them.",
      },
      { name: "Batches", description: "Many documents from one template." },
      { name: "Generations", description: "Entries in the generation log, and their PDFs." },
      { name: "Combine", description: "Packets of several PDFs." },
    ],
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
    },
    security: [{ apiKey: [] }],
  },
  defaultValidationErrorResponse: false,
};

/** The OpenAPI 3.1 document for /api/v1 (ADR 0030). */
export const v1Spec = () => generateSpecs(keyed, specOptions);

let cached: ReturnType<typeof v1Spec> | undefined;

export const v1Routes = new Hono<AppEnv>()
  .get("/openapi.json", async (c) => {
    cached ??= v1Spec();
    return c.json(await cached);
  })
  .route("/", keyed);
