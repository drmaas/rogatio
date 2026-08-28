import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/browser-schema.js";

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
  resourceTypes: ["xmlhttprequest"],
  priority: 1,
  method: "POST",
  type: "request-body",
  requestBody: { mode: "replace", body: '{"debug":false}' },
};

const baseRegex = {
  id: "r1",
  name: "Regex replace",
  urlRegex: "^https://example\\.com/api$",
  origins: [],
  resourceTypes: ["xmlhttprequest"],
  priority: 1,
  method: "POST",
  type: "request-body",
  requestBody: {
    mode: "regex",
    pattern: '"debug"\\s*:\\s*true',
    replacement: '"debug":false',
  },
};

describe(" request-body browser schema", () => {
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
    ["wrong resource type", { ...baseReplace, resourceTypes: ["main_frame"] }],
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

  it("matches Node validation for valid payloads", () => {
    const nodeResult = validateProjectDetailed(project(baseReplace));
    const browserResult = validateProjectDetailed(project(baseReplace));
    expect(nodeResult.valid).toBe(browserResult.valid);
  });

  it("matches Node validation for invalid payloads", () => {
    const invalidRule = { ...baseReplace, requestBody: { mode: "replace" } };
    const nodeResult = validateProjectDetailed(project(invalidRule));
    const browserResult = validateProjectDetailed(project(invalidRule));
    expect(nodeResult.valid).toBe(browserResult.valid);
  });
});
