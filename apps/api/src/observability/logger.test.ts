import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, logContext } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  return { lines, log: createLogger({ level: "info", base: { role: "api" } }, stream) };
}

describe("createLogger", () => {
  it("writes one JSON object with a level name, ISO time and the base fields", () => {
    const { lines, log } = capture();
    log.info({ status: 200 }, "GET /api/me 200");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      role: "api",
      status: 200,
      msg: "GET /api/me 200",
    });
    expect(lines[0]?.time).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("redacts secrets at the top level and one object down", () => {
    const { lines, log } = capture();
    log.info({ password: "hunter2", user: { token: "abc", name: "Ada" } }, "x");
    expect(lines[0]).toMatchObject({
      password: "[Redacted]",
      user: { token: "[Redacted]", name: "Ada" },
    });
  });

  it("adds the bindings of the surrounding log context", () => {
    const { lines, log } = capture();
    logContext.run({ requestId: "req-1" }, () => log.warn("inside"));
    log.warn("outside");
    expect(lines[0]).toMatchObject({ requestId: "req-1", level: "warn" });
    expect(lines[1]).not.toHaveProperty("requestId");
  });

  it("leaves out lines below its level", () => {
    const { lines, log } = capture();
    log.debug("quiet");
    expect(lines).toHaveLength(0);
  });

  it("serializes errors with their stack", () => {
    const { lines, log } = capture();
    log.error({ err: new Error("boom") }, "failed");
    expect(lines[0]?.err).toMatchObject({
      type: "Error",
      message: "boom",
      stack: expect.stringContaining("Error: boom"),
    });
  });

  it("drops a failed query's parameters from the error", () => {
    const { lines, log } = capture();
    const error = Object.assign(
      new Error('Failed query: insert into "generation"\nparams: app,{"ssn":"123"}'),
      {
        query: 'insert into "generation"',
        params: ["app", '{"ssn":"123"}'],
      },
    );
    log.error({ err: error }, "failed");
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain("123");
    expect(lines[0]?.err).toMatchObject({
      message: 'Failed query: insert into "generation"\nparams: [Redacted]',
      query: 'insert into "generation"',
    });
  });
});
