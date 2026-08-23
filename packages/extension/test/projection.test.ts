import { describe, expect, it } from "vitest";
import { projectMatchers } from "../src/projection.js";
import { operation } from "./fixtures.js";

describe("F7 matcher projection", () => {
  it("preserves matcher data with deterministic numeric ids", () => {
    const first = projectMatchers([operation]);
    const second = projectMatchers([structuredClone(operation)]);

    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        id: 1000001,
        groupId: "group-a",
        ruleId: "rule-a",
        matcher: operation.matcher,
        installable: false,
      },
    ]);
  });

  it("returns no installable records for actionless matcher operations", () => {
    const result = projectMatchers([operation]);

    expect(result.every((record) => record.installable === false)).toBe(true);
    expect(result.map(({ id }) => id)).toEqual([1000001]);
  });

  it("rejects malformed operations without partial output", () => {
    expect(() => projectMatchers([null as never])).toThrowError(
      "extension.invalid-operation",
    );
  });

  it("rejects invalid normalized matcher fields", () => {
    expect(() =>
      projectMatchers([
        {
          ...operation,
          matcher: {
            ...operation.matcher,
            urlRegex: { source: "[", flags: "" },
          },
        },
      ]),
    ).toThrowError("extension.invalid-operation");
    expect(() =>
      projectMatchers([
        {
          ...operation,
          matcher: { ...operation.matcher, origins: ["<all_urls>"] },
        },
      ]),
    ).toThrowError("extension.invalid-operation");
  });
});
