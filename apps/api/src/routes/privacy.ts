import { zValidator } from "@hono/zod-validator";
import { erasureRequestSchema, subjectSearchSchema } from "@necodoc/shared";
import { Hono } from "hono";
import { type AppEnv, requireRole } from "../middleware";
import { eraseSubject, findSubject } from "../privacy";

// Spec: docs/features/personal-data-masking-and-erasure.md. Admins only. The search term travels
// in the body, never the URL, so it stays out of request logs and proxies.

export const privacyRoutes = new Hono<AppEnv>()
  .post("/subjects/search", requireRole("admin"), zValidator("json", subjectSearchSchema), async (c) =>
    c.json(await findSubject(c.req.valid("json").q), 200),
  )
  .post("/erasures", requireRole("admin"), zValidator("json", erasureRequestSchema), async (c) =>
    c.json(await eraseSubject(c.req.valid("json")), 201),
  );
