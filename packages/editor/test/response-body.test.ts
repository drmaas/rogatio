import { describe, expect, it } from "vitest";
import { createResponseBodyRuleType } from "../src/index.js";

describe("F15 response-body editor extension", () => {
  it("is selectable and validates ordered replacements", () => {
    const extension = createResponseBodyRuleType();
    expect(extension.id).toBe("response-body");
    expect(extension.matches({ type: "response-body" })).toBe(true);
    expect(
      extension.validate(
        {
          type: "response-body",
          responseBody: { replacements: [{ pattern: "a", replacement: "b" }] },
        },
        "/groups/0/rules/0",
      ),
    ).toEqual([]);
  });
});
