import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test helper: veraPDF, when it's on PATH (`brew install verapdf`). Tests skip it otherwise.

export const hasVerapdf = (() => {
  try {
    execFileSync("verapdf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** veraPDF's verdict for one flavour (`2b`, `2u`, `ua1`) and the clauses that failed. */
export function verapdf(pdf: Uint8Array, flavour: string) {
  const dir = mkdtempSync(join(tmpdir(), "necodoc-verapdf-"));
  const file = join(dir, "check.pdf");
  writeFileSync(file, pdf);
  let report: string;
  try {
    report = execFileSync("verapdf", ["-f", flavour, file], { encoding: "utf8" });
  } catch (error) {
    // Exit code 1 means "not compliant"; the report is still on stdout.
    report = String((error as { stdout?: string }).stdout ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    compliant: report.includes('isCompliant="true"'),
    failed: [...report.matchAll(/clause="([^"]+)" testNumber="(\d+)" status="failed"/g)].map(
      (m) => `${m[1]}-${m[2]}`,
    ),
  };
}
