import type { TestAssertions, TestCheck, TestResult } from "@necodoc/shared";
import type { templateTestCase } from "./db/schema";
import { renderPreview } from "./generate";
import { limiter } from "./limiter";
import { draftRenderInput, type SavedDraft } from "./publish";
import { pdfText } from "./visual-diff";

// Spec: docs/features/template-test-cases-and-visual-diff.md. Test cases render through the
// preview path (unlogged, in-process), a few at a time on top of the preview limit.

type TestCase = Pick<typeof templateTestCase.$inferSelect, "id" | "name" | "data" | "assertions">;

const caseSlot = limiter(() => 3);

const collapse = (text: string) => text.replace(/\s+/g, " ");

function checks(
  assertions: TestAssertions,
  rendered: {
    dataErrors: string[];
    pageCount: number;
    warnings: string[];
    text: string;
  },
): TestCheck[] {
  const out: TestCheck[] = [{ label: "Renders without error", passed: true }];
  if (assertions.validates) {
    const errors = rendered.dataErrors;
    out.push({
      label: "Data validates against the fields",
      passed: errors.length === 0,
      ...(errors.length ? { detail: errors.slice(0, 5).join("; ") } : {}),
    });
  }
  if (assertions.noTextCut) {
    const cut = rendered.warnings.filter((w) => w.includes("cut"));
    out.push({
      label: "No text cut to fit",
      passed: cut.length === 0,
      ...(cut.length ? { detail: cut.slice(0, 5).join("; ") } : {}),
    });
  }
  const { pageCount } = assertions;
  if (pageCount) {
    const passed =
      pageCount.op === "equals"
        ? rendered.pageCount === pageCount.value
        : rendered.pageCount <= pageCount.value;
    out.push({
      label: `Page count ${pageCount.op === "equals" ? "is" : "is at most"} ${pageCount.value}`,
      passed,
      ...(passed ? {} : { detail: `Rendered ${rendered.pageCount}` }),
    });
  }
  for (const needle of assertions.contains) {
    out.push({ label: `Contains "${needle}"`, passed: rendered.text.includes(collapse(needle)) });
  }
  for (const needle of assertions.notContains) {
    out.push({
      label: `Doesn't contain "${needle}"`,
      passed: !rendered.text.includes(collapse(needle)),
    });
  }
  return out;
}

async function runCase(draft: SavedDraft, filename: string, test: TestCase): Promise<TestResult> {
  const started = performance.now();
  const result = (checksList: TestCheck[], pageCount: number | null): TestResult => ({
    caseId: test.id,
    name: test.name,
    passed: checksList.every((check) => check.passed),
    pageCount,
    durationMs: Math.round(performance.now() - started),
    checks: checksList,
  });
  const built = draftRenderInput(draft, test.data, filename);
  if (!built.input) {
    return result([{ label: "Renders without error", passed: false, detail: built.error }], null);
  }
  const rendered = await renderPreview(built.input);
  if (!rendered.ok) {
    return result(
      [{ label: "Renders without error", passed: false, detail: rendered.error }],
      null,
    );
  }
  const needsText = test.assertions.contains.length + test.assertions.notContains.length > 0;
  const text = needsText ? collapse((await pdfText(rendered.pdf)).join("\n")) : "";
  return result(
    checks(test.assertions, {
      dataErrors: built.dataErrors,
      pageCount: rendered.pageCount,
      warnings: rendered.warnings,
      text,
    }),
    rendered.pageCount,
  );
}

/** Runs the cases on the draft, in order of the given list. */
export function runTests(draft: SavedDraft, filename: string, cases: readonly TestCase[]) {
  return Promise.all(cases.map((test) => caseSlot(() => runCase(draft, filename, test))));
}
