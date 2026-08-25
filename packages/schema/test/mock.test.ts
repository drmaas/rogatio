import { describe, expect, it } from "vitest";
import type { RogatioProject } from "../src/index.js";
import { validateProjectDetailed } from "../src/index.js";

function mockRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-mock",
    name: "Mock rule",
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame" as const],
    priority: 100,
    type: "mock" as const,
    mock: { status: 200, body: "hello" },
    ...overrides,
  };
}

function projectWith(rule: Record<string, unknown>): RogatioProject {
  return {
    version: 1,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        origins: ["https://example.com"],
        rules: [rule as never],
      },
    ],
  };
}

describe("@rogatio/schema mock rules", () => {
  it("accepts a valid inline-body mock rule", () => {
    const result = validateProjectDetailed(projectWith(mockRule()));
    expect(result).toMatchObject({ valid: true });
  });

  it("accepts a valid file mock rule with headers and delay", () => {
    const rule = mockRule({
      mock: {
        status: 201,
        headers: [{ name: "x-test", value: "1" }],
        delayMs: 250,
        file: "fixtures/approved.json",
      },
    });
    expect(validateProjectDetailed(projectWith(rule))).toMatchObject({
      valid: true,
    });
  });

  it("rejects a mock rule with both body and file set", () => {
    const rule = mockRule({ mock: { status: 200, body: "x", file: "a.txt" } });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (error) =>
            error.instancePath === "/groups/0/rules/0/mock" &&
            error.keyword === "mock-body-source",
        ),
      ).toBe(true);
    }
  });

  it("rejects a mock rule with neither body nor file", () => {
    const rule = mockRule({ mock: { status: 200 } });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (error) =>
            error.instancePath === "/groups/0/rules/0/mock" &&
            error.keyword === "mock-body-source",
        ),
      ).toBe(true);
    }
  });

  it("rejects an out-of-range, non-integer, or missing status", () => {
    for (const status of [199, 600, 200.5, "200", undefined]) {
      const rule = mockRule({ mock: { status, body: "x" } });
      const result = validateProjectDetailed(projectWith(rule));
      expect(result.valid, String(status)).toBe(false);
    }
  });

  it("rejects a negative or over-limit delayMs", () => {
    for (const delayMs of [-1, 30_001, 1.5, "10"]) {
      const rule = mockRule({
        mock: { status: 200, body: "x", delayMs },
      });
      const result = validateProjectDetailed(projectWith(rule));
      expect(result.valid, String(delayMs)).toBe(false);
    }
  });

  it("rejects an over-limit inline body", () => {
    const rule = mockRule({
      mock: { status: 200, body: "a".repeat(65_537) },
    });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
  });

  it("rejects over-limit header count, header name, and header value", () => {
    const manyHeaders = Array.from({ length: 33 }, (_, index) => ({
      name: `x-${index}`,
      value: "1",
    }));
    expect(
      validateProjectDetailed(
        projectWith(
          mockRule({ mock: { status: 200, body: "x", headers: manyHeaders } }),
        ),
      ).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [{ name: "a".repeat(257), value: "1" }],
            },
          }),
        ),
      ).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [{ name: "x-a", value: "b".repeat(4097) }],
            },
          }),
        ),
      ).valid,
    ).toBe(false);
  });

  it("rejects a header name with NUL, control, or colon characters", () => {
    for (const name of ["bad\x00name", "bad\x01name", "bad:name", ""]) {
      const rule = mockRule({
        mock: { status: 200, body: "x", headers: [{ name, value: "1" }] },
      });
      const result = validateProjectDetailed(projectWith(rule));
      expect(result.valid, JSON.stringify(name)).toBe(false);
    }
  });

  it("rejects an empty or control-character file path and an over-limit path", () => {
    expect(
      validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, file: "" } })),
      ).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, file: "a\x00b" } })),
      ).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(
        projectWith(
          mockRule({ mock: { status: 200, file: "a".repeat(2049) } }),
        ),
      ).valid,
    ).toBe(false);
  });

  it("rejects an unknown property on the mock payload", () => {
    const rule = mockRule({ mock: { status: 200, body: "x", path: "a" } });
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  it("rejects a mock rule without the mock payload and an unknown rule type", () => {
    expect(
      validateProjectDetailed(projectWith(mockRule({ mock: undefined }))).valid,
    ).toBe(false);
    expect(
      validateProjectDetailed(projectWith(mockRule({ type: "bogus" }))).valid,
    ).toBe(false);
  });
});
