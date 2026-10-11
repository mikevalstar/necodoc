import { LiquidError } from "liquidjs";
import { describe, expect, it } from "vitest";
import { isInfrastructureError } from "./errors";
import { liquid } from "./liquid";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("isInfrastructureError", () => {
  it("retries browser crashes and lost connections", () => {
    const closed = new Error("page.pdf: Target page, context or browser has been closed");
    closed.name = "TargetClosedError";
    expect(isInfrastructureError(closed)).toBe(true);
    expect(isInfrastructureError(new Error("browserType.launch: Executable doesn't exist"))).toBe(
      true,
    );
    expect(
      isInfrastructureError(new Error("Protocol error (Page.printToPDF): Target crashed")),
    ).toBe(true);
    expect(
      isInfrastructureError(
        withCode("write CONNECTION_CLOSED localhost:5432", "CONNECTION_CLOSED"),
      ),
    ).toBe(true);
    expect(
      isInfrastructureError(withCode("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED")),
    ).toBe(true);
  });

  it("fails template and data errors once", async () => {
    const liquidError = await liquid.parseAndRender("{% if %}", {}).catch((e: unknown) => e);
    expect(liquidError).toBeInstanceOf(LiquidError);
    expect(isInfrastructureError(liquidError)).toBe(false);
    expect(isInfrastructureError(new Error("Theme 123 doesn't exist"))).toBe(false);
    expect(isInfrastructureError(new Error("The PDF is over 20 MB"))).toBe(false);
    expect(isInfrastructureError(new Error("Render timed out"))).toBe(false);
    expect(isInfrastructureError("a string")).toBe(false);
  });
});
