// Regenerates every /api/v1 SDK (ADR 0030, ADR 0041). Run with `pnpm sdk:generate`.
//
// 1. The TypeScript SDK's generate script writes packages/sdk-ts/openapi.json from the API's code.
// 2. A copy of that document gets a small compatibility pass (see `forGenerators`).
// 3. openapi-generator (a pinned jar, downloaded once) writes the Python, .NET and Java clients,
//    with inline enums lifted into named types.
//
// Needs Java 11+: `java` on PATH, or JAVA_HOME (e.g. JAVA_HOME=$(brew --prefix openjdk)).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GENERATOR_VERSION = "7.26.0";
const SDK_VERSION = "0.1.0";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "node_modules/.cache/necodoc-sdks");
const jar = join(cache, `openapi-generator-cli-${GENERATOR_VERSION}.jar`);
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/java") : "java";

type Sdk = { dir: string; generator: string; options: Record<string, string> };

const sdks: Sdk[] = [
  {
    dir: "packages/sdk-python",
    generator: "python",
    options: { packageName: "necodoc", projectName: "necodoc", packageVersion: SDK_VERSION },
  },
  {
    dir: "packages/sdk-dotnet",
    generator: "csharp",
    options: {
      library: "generichost",
      packageName: "Necodoc.Sdk",
      packageVersion: SDK_VERSION,
      targetFramework: "net8.0",
    },
  },
  {
    dir: "packages/sdk-java",
    generator: "java",
    options: {
      library: "native",
      groupId: "dev.necodoc",
      artifactId: "necodoc-sdk",
      artifactVersion: SDK_VERSION,
      invokerPackage: "dev.necodoc.sdk",
      apiPackage: "dev.necodoc.sdk.api",
      modelPackage: "dev.necodoc.sdk.model",
    },
  },
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Rewrites what openapi-generator 7.x misreads in zod's OpenAPI 3.1 output. The API doesn't change;
 * without this the Java and C# clients don't compile.
 */
function forGenerators(spec: JsonObject): JsonObject {
  // `anyOf` parameters: the array branch (sent repeated) if there is one, else a string. The only
  // one today is `version`, a number or `latest`.
  for (const pathItem of Object.values(isObject(spec.paths) ? spec.paths : {})) {
    for (const operation of Object.values(isObject(pathItem) ? pathItem : {})) {
      if (!isObject(operation) || !Array.isArray(operation.parameters)) continue;
      for (const parameter of operation.parameters) {
        if (!isObject(parameter) || !isObject(parameter.schema)) continue;
        const { anyOf } = parameter.schema;
        if (!Array.isArray(anyOf)) continue;
        const array = anyOf.find((branch) => isObject(branch) && branch.type === "array");
        parameter.schema = array ?? { type: "string" };
        if (array) parameter.explode = true;
      }
    }
  }

  const visit = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isObject(node)) return;
    // `const` becomes a one-value enum; a boolean enum only makes generators emit a broken type.
    if ("const" in node) {
      const value = node.const ?? null;
      delete node.const;
      if (node.type !== "boolean") node.enum = [value];
    }
    // zod adds a regex next to `format: date-time` / `uuid`; C# applies it to a DateTime.
    if (typeof node.format === "string") delete node.pattern;
    Object.values(node).forEach(visit);
  };
  visit(spec);

  // The served document has a relative server (the deployment's own origin).
  spec.servers = [{ url: "https://necodoc.example.com/api/v1", description: "Your deployment" }];
  return spec;
}

async function ensureJar() {
  if (existsSync(jar)) return;
  mkdirSync(cache, { recursive: true });
  const url = `https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/${GENERATOR_VERSION}/openapi-generator-cli-${GENERATOR_VERSION}.jar`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  writeFileSync(jar, new Uint8Array(await response.arrayBuffer()));
}

/** Deletes what the previous run generated, so files for removed schemas don't linger. */
function removeGenerated(dir: string) {
  const list = join(dir, ".openapi-generator/FILES");
  if (!existsSync(list)) return;
  for (const file of readFileSync(list, "utf8").split("\n")) {
    if (file && file !== ".openapi-generator-ignore") rmSync(join(dir, file), { force: true });
  }
}

execFileSync("pnpm", ["--filter", "@necodoc/sdk", "generate"], { cwd: root, stdio: "inherit" });

const spec: JsonObject = JSON.parse(
  readFileSync(join(root, "packages/sdk-ts/openapi.json"), "utf8"),
);
mkdirSync(cache, { recursive: true });
const specPath = join(cache, "openapi.json");
writeFileSync(specPath, JSON.stringify(forGenerators(spec), null, 2));

await ensureJar();

for (const sdk of sdks) {
  const out = join(root, sdk.dir);
  removeGenerated(out);
  execFileSync(
    java,
    [
      "-jar",
      jar,
      "generate",
      "--input-spec",
      specPath,
      "--generator-name",
      sdk.generator,
      "--output",
      out,
      "--global-property",
      "apiTests=false,modelTests=false,apiDocs=false,modelDocs=false",
      // Named enum types; C# writes an unset inline enum and throws.
      "--inline-schema-options",
      "RESOLVE_INLINE_ENUMS=true",
      "--additional-properties",
      Object.entries({ ...sdk.options, hideGenerationTimestamp: "true" })
        .map(([key, value]) => `${key}=${value}`)
        .join(","),
    ],
    // The generator logs every file it writes; warnings and errors still reach stderr.
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`sdk:generate: wrote ${sdk.dir}`);
}
