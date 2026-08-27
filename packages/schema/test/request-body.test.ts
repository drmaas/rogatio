import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/index.js";

function project(rule: Record<string, unknown>) {
  return {
    version: 1,
    name: "Request body",
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

const baseReplace = {
  id: "r1",
  name: "Replace body",
  urlRegex: "^https://example\\.com/api$",
  origins: [],
  resourceTypes: ["xmlhttprequest"] as const,
  priority: 1,
  method: "POST" as const,
  type: "request-body" as const,
  requestBody: { mode: "replace" as const, body: '{"debug":false}' },
};

const baseRegex = {
  id: "r1",
  name: "Regex replace",
  urlRegex: "^https://example\\.com/api$",
  origins: [],
  resourceTypes: ["xmlhttprequest"] as const,
  priority: 1,
  method: "POST" as const,
  type: "request-body" as const,
  requestBody: {
    mode: "regex" as const,
    pattern: '"debug"\\s*:\\s*true',
    replacement: '"debug":false',
  },
};

describe("F17 request-body schema", () => {
  it("accepts a valid replace action", () =>
    expect(validateProjectDetailed(project(baseReplace)).valid).toBe(true));

  it("accepts a valid regex action", () =>
    expect(validateProjectDetailed(project(baseRegex)).valid).toBe(true));

  it.each([
    ["missing action", { ...baseReplace, requestBody: undefined }],
    [
      "invalid mode",
      { ...baseReplace, requestBody: { mode: "invalid", body: "x" } },
    ],
    [
      "replace missing body",
      { ...baseReplace, requestBody: { mode: "replace" } },
    ],
    [
      "replace body too large",
      {
        ...baseReplace,
        requestBody: { mode: "replace", body: "x".repeat(5 * 1024 * 1024) },
      },
    ],
    [
      "regex missing pattern",
      { ...baseRegex, requestBody: { mode: "regex", replacement: "x" } },
    ],
    [
      "regex empty pattern",
      {
        ...baseRegex,
        requestBody: { mode: "regex", pattern: "", replacement: "x" },
      },
    ],
    [
      "regex invalid pattern",
      {
        ...baseRegex,
        requestBody: { mode: "regex", pattern: "[", replacement: "x" },
      },
    ],
    [
      "regex pattern too large",
      {
        ...baseRegex,
        requestBody: {
          mode: "regex",
          pattern: "x".repeat(3000),
          replacement: "y",
        },
      },
    ],
    [
      "regex replacement too large",
      {
        ...baseRegex,
        requestBody: {
          mode: "regex",
          pattern: "x",
          replacement: "y".repeat(5000),
        },
      },
    ],
    [
      "unknown property in replace",
      { ...baseReplace, requestBody: { mode: "replace", body: "x", extra: 1 } },
    ],
    [
      "unknown property in regex",
      {
        ...baseRegex,
        requestBody: {
          mode: "regex",
          pattern: "x",
          replacement: "y",
          extra: 1,
        },
      },
    ],
    ["wrong method GET", { ...baseReplace, method: "GET" }],
    ["wrong method DELETE", { ...baseReplace, method: "DELETE" }],
    ["wrong resource type", { ...baseReplace, resourceTypes: ["main_frame"] }],
    [
      "multiple resource types",
      { ...baseReplace, resourceTypes: ["xmlhttprequest", "fetch"] },
    ],
  ])("rejects %s", (_name, rule) => {
    expect(validateProjectDetailed(project(rule)).valid).toBe(false);
  });

  it("rejects lone surrogates in replace body", () => {
    const result = validateProjectDetailed(
      project({
        ...baseReplace,
        requestBody: { mode: "replace", body: "\uD800" },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects lone surrogates in regex pattern", () => {
    const result = validateProjectDetailed(
      project({
        ...baseRegex,
        requestBody: { mode: "regex", pattern: "\uD800", replacement: "x" },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects lone surrogates in regex replacement", () => {
    const result = validateProjectDetailed(
      project({
        ...baseRegex,
        requestBody: { mode: "regex", pattern: "x", replacement: "\uD800" },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("accepts valid local origins in project config", () => {
    const p = {
      version: 1,
      name: "Test",
      requestBodyPolicy: {
        localOrigins: ["http://127.0.0.1:3000", "https://localhost:8443"],
      },
      groups: [
        {
          id: "g1",
          name: "G",
          origins: ["https://example.com"],
          rules: [baseReplace],
        },
      ],
    };
    expect(validateProjectDetailed(p).valid).toBe(true);
  });

  it.each([
    ["wildcard local origin", { localOrigins: ["https://*.example.com"] }],
    [
      "local origin with path",
      { localOrigins: ["http://localhost:3000/path"] },
    ],
    [
      "local origin with query",
      { localOrigins: ["http://localhost:3000?query"] },
    ],
    [
      "local origin with fragment",
      { localOrigins: ["http://localhost:3000#frag"] },
    ],
    [
      "local origin with credentials",
      { localOrigins: ["http://user:pass@localhost:3000"] },
    ],
    [
      "local origin with backslash",
      { localOrigins: ["http://localhost\\:3000"] },
    ],
    ["local origin invalid port", { localOrigins: ["http://localhost:99999"] }],
    ["local origin trailing dot", { localOrigins: ["http://localhost./"] }],
  ])("rejects %s", (_name, config) => {
    const p = {
      version: 1,
      name: "Test",
      requestBodyPolicy: config,
      groups: [
        {
          id: "g1",
          name: "G",
          origins: ["https://example.com"],
          rules: [baseReplace],
        },
      ],
    };
    expect(validateProjectDetailed(p).valid).toBe(false);
  });

  it("preserves existing project validity without F17 fields", () => {
    const legacy = {
      version: 1,
      name: "Legacy",
      groups: [
        {
          id: "g1",
          name: "G",
          origins: ["https://example.com"],
          rules: [
            {
              id: "r1",
              name: "Query",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["xmlhttprequest"],
              priority: 1,
              type: "query",
              action: { type: "query", params: [{ name: "x", value: "1" }] },
            },
          ],
        },
      ],
    };
    expect(validateProjectDetailed(legacy).valid).toBe(true);
  });
});
