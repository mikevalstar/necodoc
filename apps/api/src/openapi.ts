import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// ADR 0030: writes the /api/v1 OpenAPI document to a file, for builds without a running API
// (developer docs, SDK generation). `pnpm --filter @necodoc/api openapi [out.json]`.

// env.ts validates at import; nothing here connects, so placeholders are enough.
process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused";
process.env.BETTER_AUTH_SECRET ??= "openapi-emit-placeholder-secret-0000000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { v1Spec } = await import("./routes/v1");
const out = resolve(process.argv[2] ?? "openapi.json");
await writeFile(out, `${JSON.stringify(await v1Spec(), null, 2)}\n`);
console.log(`openapi: wrote ${out}`);
// pg-boss and postgres handles would keep the process alive.
process.exit(0);
