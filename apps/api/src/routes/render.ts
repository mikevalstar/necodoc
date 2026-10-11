import { zValidator } from "@hono/zod-validator";
import { renderRequestSchema } from "@necodoc/shared";
import { Hono } from "hono";
import { generate } from "../generate";
import { type AppEnv, requirePermission } from "../middleware";
import { pdfHeaders } from "./http";

// Spec: docs/features/html-to-pdf-api.md (the app's own render; /api/v1 adds API keys later).
export const renderRoutes = new Hono<AppEnv>().post(
  "/",
  requirePermission({ document: ["view"] }),
  zValidator("json", renderRequestSchema),
  async (c) => {
    const result = await generate({
      request: c.req.valid("json"),
      source: "app",
      userId: c.get("user").id,
    });
    if (!result.ok) {
      return c.json({ error: result.error, generationId: result.generationId }, 422);
    }
    return c.body(result.pdf, 200, {
      ...pdfHeaders(result.filename),
      "X-Page-Count": String(result.pageCount),
      ...(result.generationId ? { "X-Generation-Id": result.generationId } : {}),
    });
  },
);
