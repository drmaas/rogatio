import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { compileProject } from "../src/index.js";

function makeRule(
  index: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `rule-${index}`,
    name: `Rule ${index}`,
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame"],
    priority: 100,
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

describe("redactSensitiveInLogs compiler", () => {
  it("resolves absent to false on every operation kind", () => {
    const cases = [
      makeRule(1),
      makeRule(2, {
        type: "redirect",
        redirect: { destination: "https://other.example/" },
      }),
      makeRule(3, {
        type: "query",
        action: { type: "query", params: [{ name: "a", value: "1" }] },
      }),
      makeRule(4, {
        type: "header",
        headerDirection: "request",
        headerOperation: "set",
        headerName: "X-Test",
        headerValue: "1",
      }),
      makeRule(5, {
        type: "request-body",
        method: "POST",
        resourceTypes: ["xmlhttprequest"],
        requestBody: { mode: "replace", body: '{"debug":false}' },
      }),
      makeRule(6, {
        type: "response-body",
        resourceTypes: ["xmlhttprequest"],
        responseBody: { mode: "replace", body: '{"ok":true}' },
      }),
    ];

    for (const rule of cases) {
      const result = compileProject(projectWith(rule));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.operations[0]).toMatchObject({
        redactSensitiveInLogs: false,
      });
      expect(result.operations[0]?.matcher).not.toHaveProperty(
        "redactSensitiveInLogs",
      );
    }
  });

  it("preserves explicit true and false", () => {
    for (const flag of [true, false] as const) {
      const result = compileProject(
        projectWith(
          makeRule(1, {
            type: "redirect",
            redirect: { destination: "https://other.example/" },
            redactSensitiveInLogs: flag,
          }),
        ),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.operations[0]?.redactSensitiveInLogs).toBe(flag);
    }
  });
});
