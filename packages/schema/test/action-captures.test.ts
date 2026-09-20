import { describe, expect, it } from "vitest";
import { type RogatioProject, validateProjectDetailed } from "../src/index.js";

const baseRule = {
  id: "rule",
  name: "Capture rule",
  urlRegex: "^https://example\\.com/users/([^/]+)$",
  origins: [],
  resourceTypes: ["xmlhttprequest" as const],
  priority: 1,
};

function project(rule: Record<string, unknown>): RogatioProject {
  return {
    version: 1,
    name: "Capture project",
    groups: [
      {
        id: "group",
        name: "Group",
        origins: ["https://example.com"],
        rules: [rule as never],
      },
    ],
  };
}

describe("action URL capture validation", () => {
  it.each([
    [
      "redirect",
      { type: "redirect", redirect: { destination: "https://new/$2" } },
      "/redirect/destination",
    ],
    [
      "query",
      {
        type: "query",
        action: { type: "query", params: [{ name: "user", value: "$2" }] },
      },
      "/action/params/0/value",
    ],
    [
      "header",
      {
        type: "header",
        headerDirection: "request",
        headerOperation: "set",
        headerName: "x-user",
        headerValue: "$2",
      },
      "/headerValue",
    ],
    [
      "response body",
      {
        type: "response-body",
        responseBody: { mode: "replace", body: '{"user":"$2"}' },
      },
      "/responseBody/body",
    ],
    [
      "request body",
      {
        type: "request-body",
        method: "POST",
        requestBody: { mode: "replace", body: '{"user":"$2"}' },
      },
      "/requestBody/body",
    ],
  ])("rejects an out-of-range capture in %s", (_name, action, path) => {
    const result = validateProjectDetailed(project({ ...baseRule, ...action }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.instancePath.endsWith(path)),
      ).toBe(true);
    }
  });

  it("allows URL captures in replace fields", () => {
    const result = validateProjectDetailed(
      project({
        ...baseRule,
        type: "response-body",
        responseBody: { mode: "replace", body: '{"user":"$1"}' },
      }),
    );
    expect(result).toMatchObject({ valid: true });
  });

  it("does not apply URL-capture validation to body regex replacements", () => {
    const result = validateProjectDetailed(
      project({
        ...baseRule,
        type: "request-body",
        method: "POST",
        requestBody: { mode: "regex", pattern: "user", replacement: "$2" },
      }),
    );
    expect(result).toMatchObject({ valid: true });
  });
});
