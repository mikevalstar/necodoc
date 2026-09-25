import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  // Bundle workspace packages (they ship TS source); leave npm deps external.
  noExternal: [/^@necodoc\//],
});
