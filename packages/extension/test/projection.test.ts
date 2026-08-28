import type { QueryOperation, RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { projectMatchers } from "../src/projection.js";
import { operation } from "./fixtures.js";

const queryOperation: QueryOperation = {
  kind: "query",
  groupId: "group-a",
  ruleId: "rule-a",
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame", "script"],
    priority: 100,
    method: "GET",
  },
  action: { type: "query", params: [{ name: "a", value: "1" }] },
};

const redirectOperation: RogatioOperation = {
  kind: "redirect",
  groupId: "group-a",
  ruleId: "rule-b",
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame", "script"],
    priority: 200,
    method: "POST",
  },
  redirect: { destination: "https://other.example.com/redirected" },
};

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

  it("builds an installable DNR rule for a query action ()", () => {
    const result = projectMatchers([queryOperation]);

    expect(result).toHaveLength(1);
    const record = result[0];
    expect(record.installable).toBe(true);
    expect(record.dnrRule).toEqual({
      id: 1000001,
      priority: 100,
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame", "script"],
        requestMethods: ["GET"],
        requestDomains: ["example.com"],
        initiatorDomains: ["example.com"],
      },
      action: {
        type: "redirect",
        redirect: {
          transform: {
            query: {
              addOrReplaceParams: [
                { name: "a", value: "1", replaceOnly: false },
              ],
            },
          },
        },
      },
    });
  });

  it("builds an installable DNR redirect rule for a redirect action (F9)", () => {
    const result = projectMatchers([redirectOperation]);

    expect(result).toHaveLength(1);
    const record = result[0];
    expect(record.installable).toBe(true);
    expect(record.dnrRule).toEqual({
      id: 1000001,
      priority: 200,
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame", "script"],
        requestMethods: ["POST"],
        requestDomains: ["example.com"],
        initiatorDomains: ["example.com"],
      },
      action: {
        type: "redirect",
        redirect: {
          destination: "https://other.example.com/redirected",
        },
      },
    });
  });
});
