import { zValidator } from "@hono/zod-validator";
import { renderCallSchema } from "@necodoc/shared";
import { Hono } from "hono";
import { generate, renderPreview } from "../generate";
import { generationResponse, pdfHeaders } from "../http";
import { type AppEnv, demo, requirePermission } from "../middleware";

// Spec: docs/features/html-to-pdf-api.md (the app's own render; /api/v1 adds API keys later).
// Previews render here; everything else is queued (ADR 0020).
export const renderRoutes = new Hono<AppEnv>().post(
  "/",
  requirePermission({ document: ["view"] }),
  demo.limit("render"),
  zValidator("json", renderCallSchema),
  async (c) => {
    const { async, ...request } = c.req.valid("json");
    if (request.preview) {
      const result = await renderPreview(request);
      if (!result.ok) return c.json({ error: result.error, generationId: null }, 422);
      return c.body(result.pdf, 200, {
        ...pdfHeaders(result.filename),
        "X-Page-Count": String(result.pageCount),
      });
    }
    const result = await generate({
      request,
      source: "app",
      userId: c.get("user").id,
      requestId: c.get("requestId"),
      wait: !async,
    });
    return generationResponse(c, result);
  },
);
