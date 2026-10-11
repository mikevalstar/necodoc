import { defineConfig } from "tsdown";

export default defineConfig({
  // The migration CLI ships too, for deployments without tsx (ADR 0023).
  entry: ["src/index.ts", "src/storage-migrate.ts"],
  platform: "node",
  // Bundle workspace packages (they ship TS source); leave npm deps external.
  noExternal: [/^@necodoc\//],
});
