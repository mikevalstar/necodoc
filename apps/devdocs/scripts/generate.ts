// Build hook for generated content (ADR 0026). Runs before `astro build`.
//
// Coming with /api/v1: fetch or build its OpenAPI document into src/generated/openapi.json, wire
// starlight-openapi to it in astro.config.mjs, and copy each SDK's README into
// src/content/docs/reference/sdks/. Until then there is nothing to generate.

console.log("devdocs generate: no /api/v1 OpenAPI spec yet; the API reference is a placeholder.");
