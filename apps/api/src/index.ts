import { serve } from "@hono/node-server";
import app from "./app";
import { seedBuiltinThemes } from "./builtin-themes";
import { env } from "./env";

await seedBuiltinThemes();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
