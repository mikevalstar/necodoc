import { z } from "zod";

// Spec: docs/features/template-test-cases-and-visual-diff.md

const needle = z.string().trim().min(1).max(500);

/** What a test case checks beyond "it renders". Every assertion is optional. */
export const testAssertionsSchema = z.object({
  /** The data passes the template's field validation. */
  validates: z.boolean().default(true),
  /** No overlay box had its text cut to fit. */
  noTextCut: z.boolean().default(false),
  pageCount: z
    .object({ op: z.enum(["equals", "at_most"]), value: z.int().min(1).max(1000) })
    .nullable()
    .default(null),
  /** Text the PDF must contain, on any page (case-sensitive, whitespace collapsed). */
  contains: z.array(needle).max(20).default([]),
  notContains: z.array(needle).max(20).default([]),
});
export type TestAssertions = z.infer<typeof testAssertionsSchema>;

const data = z.record(z.string(), z.unknown());
const name = z.string().trim().min(1, "Enter a name").max(200);

/** Where a new case's data comes from. The API reads generations and documents itself. */
export const testCaseFromSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample") }),
  z.object({ kind: z.literal("data"), data }),
  z.object({ kind: z.literal("generation"), id: z.uuid() }),
  z.object({ kind: z.literal("submission"), id: z.uuid() }),
]);
export type TestCaseFrom = z.infer<typeof testCaseFromSchema>;
export type TestCaseSource = TestCaseFrom["kind"];

export const createTestCaseSchema = z.object({
  name,
  from: testCaseFromSchema,
  assertions: testAssertionsSchema.prefault({}),
});
export type CreateTestCase = z.input<typeof createTestCaseSchema>;

export const updateTestCaseSchema = z
  .object({ name, data, assertions: testAssertionsSchema })
  .partial();

export const runTestsSchema = z.object({
  /** Omit to run every case. */
  caseIds: z.array(z.uuid()).max(100).optional(),
});

export const testCheckSchema = z.object({
  label: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export type TestCheck = z.infer<typeof testCheckSchema>;

export const testResultSchema = z.object({
  caseId: z.uuid(),
  name: z.string(),
  passed: z.boolean(),
  pageCount: z.number().int().nullable(),
  durationMs: z.number().int(),
  checks: z.array(testCheckSchema),
});
export type TestResult = z.infer<typeof testResultSchema>;

/** One test case's data, or the sample data when `caseId` is omitted. */
export const visualDiffSchema = z.object({ caseId: z.uuid().optional() });

/** Visual diff: pages are compared at the same index; a missing side is null. */
export const pageDiffSchema = z.object({
  page: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  /** PNG data URLs. */
  before: z.string().nullable(),
  after: z.string().nullable(),
  diff: z.string().nullable(),
  changedPixels: z.number().int(),
  /** 0–100. */
  changedPercent: z.number(),
  beforeText: z.string(),
  afterText: z.string(),
});
export type PageDiff = z.infer<typeof pageDiffSchema>;

/** Above this share of changed pixels a page counts as changed (anti-aliasing noise sits below). */
export const PAGE_CHANGED_PERCENT = 0.01;
