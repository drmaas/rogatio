import type { QueryOperation, RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { projectMatchers } from "../src/projection.js";
import { operation } from "./fixtures.js";

const queryOperation: QueryOperation = {
  kind: "query",
  groupId: "group-a",
  ruleId: "rule-a",
  name: "Rule A",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/",
    },
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
  name: "Rule B",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/",
    },
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
            source: { key: "url", operator: "regex", value: "[" },
          },
        },
      ]),
    ).toThrowError("extension.invalid-operation");
    expect(() =>
      projectMatchers([
        {
          ...operation,
          matcher: {
            ...operation.matcher,
            source: { key: "host", operator: "regex", value: "^.*$" },
          },
        },
      ]),
    ).not.toThrow();
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
      },
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [
                { key: "a", value: "1", replaceOnly: false },
              ],
            },
          },
        },
      },
    });
  });

  it("builds a DNR query transform with removeParams for remove operations", () => {
    const mixed: QueryOperation = {
      ...queryOperation,
      action: {
        type: "query",
        params: [
          { name: "a", operation: "set", value: "1" },
          { name: "b", operation: "remove" },
        ],
      },
    };
    const result = projectMatchers([mixed]);
    expect(
      result[0]?.dnrRule?.action.redirect.transform?.queryTransform,
    ).toEqual({
      addOrReplaceParams: [{ key: "a", value: "1", replaceOnly: false }],
      removeParams: ["b"],
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
