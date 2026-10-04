import { describe, expect, it } from "vitest";
import {
  LIMITS,
  migrateV1Project,
  type RogatioProject,
  validateProjectDetailed,
} from "../src/index.js";

function repeat(char: string, count: number): string {
  return char.repeat(count);
}

function mockRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-mock",
    name: "Mock rule",
    source: { key: "url", operator: "regex", value: "^https://example\\.com/" },
    resourceTypes: ["main_frame" as const],
    priority: 100,
    type: "mock" as const,
    mock: { status: 200, body: "hello" },
    ...overrides,
  };
}

function projectWith(rule: Record<string, unknown>): RogatioProject {
  return {
    version: 2,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        rules: [rule as never],
      },
    ],
  };
}

describe("@rogatio/schema mock rules", () => {
  it("accepts a valid inline mock rule", () => {
    const result = validateProjectDetailed(projectWith(mockRule()));
    expect(result).toMatchObject({ valid: true });
  });

  it("accepts a valid file-backed mock with headers and delay", () => {
    const result = validateProjectDetailed(
      projectWith(
        mockRule({
          mock: {
            status: 404,
            delayMs: 100,
            headers: [{ name: "Content-Type", value: "text/plain" }],
            file: "responses/not-found.bin",
          },
        }),
      ),
    );
    expect(result).toMatchObject({ valid: true });
  });

  it("rejects a mock rule without a mock payload", () => {
    const rule = mockRule();
    delete (rule as { mock?: unknown }).mock;
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (error) =>
            error.instancePath === "/groups/0/rules/0/mock" &&
            (error.params as { missingProperty?: string }).missingProperty ===
              "mock",
        ),
      ).toBe(true);
    }
  });

  it("rejects an unknown property on the rule", () => {
    const result = validateProjectDetailed(
      projectWith(mockRule({ unexpectedRuleField: true })),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  it("rejects an unknown property on the mock payload", () => {
    const result = validateProjectDetailed(
      projectWith(
        mockRule({
          mock: { status: 200, body: "x", unexpectedPayloadField: true },
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  it("rejects an unknown property on a rule that only carries a mock payload", () => {
    const rule = {
      id: "rule-mock",
      name: "Mock rule",
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },
      resourceTypes: ["main_frame" as const],
      priority: 100,
      mock: { status: 200, body: "hello" },
      unexpectedRuleField: true,
    };
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  describe("status bounds", () => {
    it.each([
      ["below minimum", LIMITS.minMockStatus - 1, false],
      ["at minimum", LIMITS.minMockStatus, true],
      ["at maximum", LIMITS.maxMockStatus, true],
      ["above maximum", LIMITS.maxMockStatus + 1, false],
    ] as const)("status %s", (_label, status, valid) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status, body: "" } })),
      );
      expect(result.valid).toBe(valid);
    });
  });

  describe("delayMs bounds", () => {
    it.each([
      ["below minimum", -1, false],
      ["at minimum", 0, true],
      ["at maximum", LIMITS.maxMockDelayMs, true],
      ["above maximum", LIMITS.maxMockDelayMs + 1, false],
    ] as const)("delayMs %s", (_label, delayMs, valid) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, body: "x", delayMs } })),
      );
      expect(result.valid).toBe(valid);
    });
  });

  describe("inline body length", () => {
    it("accepts body at maxMockInlineBodyLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: repeat("a", LIMITS.maxMockInlineBodyLength),
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects body over maxMockInlineBodyLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: repeat("a", LIMITS.maxMockInlineBodyLength + 1),
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("file path length", () => {
    it("accepts file at maxMockFilePathLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              file: repeat("f", LIMITS.maxMockFilePathLength),
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects empty file path", () => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, file: "" } })),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects file over maxMockFilePathLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              file: repeat("f", LIMITS.maxMockFilePathLength + 1),
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("headers", () => {
    it("accepts maxMockHeadersPerRule entries", () => {
      const headers = Array.from(
        { length: LIMITS.maxMockHeadersPerRule },
        (_, i) => ({
          name: `h-${i}`,
          value: "v",
        }),
      );
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, body: "x", headers } })),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects more than maxMockHeadersPerRule entries", () => {
      const headers = Array.from(
        { length: LIMITS.maxMockHeadersPerRule + 1 },
        (_, i) => ({
          name: `h-${i}`,
          value: "v",
        }),
      );
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, body: "x", headers } })),
      );
      expect(result.valid).toBe(false);
    });

    it("accepts header name at maxMockHeaderNameLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [
                {
                  name: repeat("n", LIMITS.maxMockHeaderNameLength),
                  value: "v",
                },
              ],
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects header name over maxMockHeaderNameLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [
                {
                  name: repeat("n", LIMITS.maxMockHeaderNameLength + 1),
                  value: "v",
                },
              ],
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects empty header name", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [{ name: "", value: "v" }],
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });

    it("accepts header value at maxMockHeaderValueLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [
                {
                  name: "X-Test",
                  value: repeat("v", LIMITS.maxMockHeaderValueLength),
                },
              ],
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects header value over maxMockHeaderValueLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [
                {
                  name: "X-Test",
                  value: repeat("v", LIMITS.maxMockHeaderValueLength + 1),
                },
              ],
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("payload shape", () => {
    it.each([
      ["missing status", { body: "x" }],
      ["fractional status", { status: 200.5, body: "x" }],
      ["string status", { status: "200", body: "x" }],
      ["fractional delayMs", { status: 200, body: "x", delayMs: 1.5 }],
      ["non-string body", { status: 200, body: 7 }],
      ["non-string file", { status: 200, file: 7 }],
      ["non-array headers", { status: 200, body: "x", headers: {} }],
      [
        "header missing value",
        { status: 200, body: "x", headers: [{ name: "X-Test" }] },
      ],
      [
        "header missing name",
        { status: 200, body: "x", headers: [{ value: "v" }] },
      ],
      [
        "header with unknown property",
        {
          status: 200,
          body: "x",
          headers: [{ name: "X-Test", value: "v", extra: true }],
        },
      ],
    ] as const)("rejects %s", (_label, mock) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: mock as never })),
      );
      expect(result.valid).toBe(false);
    });

    it("accepts an empty header value", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [{ name: "X-Test", value: "" }],
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });
  });

  it("migrateV1Project does not introduce mock rules", () => {
    const v1 = {
      version: 1 as const,
      name: "Legacy",
      groups: [
        {
          id: "g1",
          name: "G1",
          origins: ["https://example.com"],
          rules: [
            {
              id: "r1",
              name: "Redirect",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "redirect",
              redirect: { destination: "https://other.example/" },
            },
          ],
        },
      ],
    };
    const result = migrateV1Project(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rule = result.project.groups[0]?.rules[0];
    expect(rule?.type).toBe("redirect");
    expect(rule).not.toHaveProperty("mock");
  });
});
