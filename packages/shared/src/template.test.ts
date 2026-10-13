import { describe, expect, it } from "vitest";
import { createTemplateSchema, type DesignedFormat, emptyDesignedContentFor } from "./template";

describe("emptyDesignedContentFor", () => {
  it.each<DesignedFormat>(["visual", "code"])("starts a %s template in that mode", (format) => {
    const created = createTemplateSchema.parse({
      kind: "designed",
      name: "Bond",
      content: emptyDesignedContentFor(format),
    });
    expect(created.kind === "designed" && created.content.mode).toBe(format);
  });

  it("starts a code template with an empty body and no bands", () => {
    expect(emptyDesignedContentFor("code")).toMatchObject({ body: "", header: null, footer: null });
  });
});
