import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/browser-schema.js";

function project(rule: Record<string, unknown>) {
  return {
    version: 1,
    name: "Query",
    groups: [
      {
        id: "g1",
        name: "Group",
        origins: ["https://example.com"],
        rules: [rule],
      },
    ],
  };
}

const baseSet = {
  id: "r1",
  name: "Set param",
  urlRegex: "^https://example\\.com/",
  origins: [],
  resourceTypes: ["main_frame"],
  priority: 1,
  type: "query",
  action: {
    type: "query",
    params: [{ name: "ref", value: "rogatio" }],
  },
};

describe("query browser schema", () => {
  it("accepts legacy name/value params and explicit set/remove", () => {
    expect(validateProjectDetailed(project(baseSet)).valid).toBe(true);
    expect(
      validateProjectDetailed(
        project({
          ...baseSet,
          action: {
            type: "query",
            params: [{ name: "ref", operation: "set", value: "rogatio" }],
          },
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateProjectDetailed(
        project({
          ...baseSet,
          action: {
            type: "query",
            params: [{ name: "ref", operation: "remove" }],
          },
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateProjectDetailed(
        project({
          ...baseSet,
          action: {
            type: "query",
            params: [
              { name: "a", operation: "set", value: "1" },
              { name: "b", operation: "remove" },
            ],
          },
        }),
      ).valid,
    ).toBe(true);
  });

  it("rejects remove params with value and set params without value", () => {
    expect(
      validateProjectDetailed(
        project({
          ...baseSet,
          action: {
            type: "query",
            params: [{ name: "ref", operation: "remove", value: "x" }],
          },
        }),
      ).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(
        project({
          ...baseSet,
          action: {
            type: "query",
            params: [{ name: "ref", operation: "set" }],
          },
        }),
      ).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(
        project({
          ...baseSet,
          action: {
            type: "query",
            params: [{ name: "ref" }],
          },
        }),
      ).valid,
    ).toBe(false);
  });
});
