import { createAnthropic } from "@ai-sdk/anthropic";
import { createMiddleware } from "hono/factory";
import { env } from "./env";

// ADR 0022: the one module that owns the model. AI is on only when ANTHROPIC_KEY is set; without
// it no AI code path runs, AI routes answer 404 and /api/me reports it off so the app hides every
// AI control. Another provider (Bedrock, Vertex, Azure) would be configured here.

/** The model for every AI feature, or null when AI is off. */
export const aiModel = env.ANTHROPIC_KEY
  ? createAnthropic({ apiKey: env.ANTHROPIC_KEY })(env.AI_MODEL)
  : null;

/** Guards AI routes: 404, as if they didn't exist, when AI is off. */
export const requireAi = createMiddleware(async (c, next) => {
  if (!aiModel) return c.json({ error: "Not found" }, 404);
  await next();
});
