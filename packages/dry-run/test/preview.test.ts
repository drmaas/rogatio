import { compileProject } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { dryRunProject, previewRuleAction } from "../src/index.js";

function project(rule: Record<string, unknown>) {
  return {
    version: 2 as const,
    name: "Preview",
    groups: [
      {
        id: "ads",
        name: "Ads",
        rules: [rule],
      },
    ],
  };
}

const source = {
  key: "url" as const,
  operator: "regex" as const,
  value: "^https://example\\.com/old/(.*)$",
};

function operation(rule: Record<string, unknown>) {
  const compiled = compileProject(project(rule));
  if (!compiled.ok) {
    throw new Error(
      compiled.diagnostics.map((item) => item.message).join("; "),
    );
  }
  const first = compiled.operations[0];
  if (!first) throw new Error("expected one operation");
  return first;
}

describe("previewRuleAction", () => {
  it("previews redirect, query, header, and replace-mode bodies", () => {
    const url = "https://example.com/old/path";
    expect(
      previewRuleAction(
        operation({
          id: "redirect",
          name: "Old path",
          source,
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "redirect",
          redirect: { destination: "https://example.com/new/$1" },
        }),
        url,
      ),
    ).toEqual({
      kind: "redirect",
      summary: "https://example.com/new/path",
    });
    expect(
      previewRuleAction(
        operation({
          id: "query",
          name: "Query",
          source,
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "query",
          action: {
            type: "query",
            params: [{ name: "q", operation: "set", value: "$1" }],
          },
        }),
        url,
      ),
    ).toEqual({ kind: "query", summary: "q=path" });
    expect(
      previewRuleAction(
        operation({
          id: "header",
          name: "Header",
          source,
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "header",
          headerDirection: "request",
          headerOperation: "set",
          headerName: "X-Test",
          headerValue: "$1",
        }),
        url,
      ),
    ).toEqual({ kind: "header", summary: "X-Test=path" });
    expect(
      previewRuleAction(
        operation({
          id: "response",
          name: "Response",
          source,
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "response-body",
          responseBody: { mode: "replace", body: "body-$1" },
        }),
        url,
      ),
    ).toEqual({ kind: "response-body", summary: "body-path" });
    expect(
      previewRuleAction(
        operation({
          id: "request",
          name: "Request",
          source,
          resourceTypes: ["xmlhttprequest"],
          priority: 1,
          method: "POST",
          type: "request-body",
          requestBody: { mode: "replace", body: "req-$1" },
        }),
        url,
      ),
    ).toEqual({ kind: "request-body", summary: "req-path" });
  });

  it("attaches that preview when dryRunProject is given the operation", () => {
    const compiled = compileProject(
      project({
        id: "redirect",
        name: "Old path",
        source,
        resourceTypes: ["main_frame"],
        priority: 1,
        method: "POST",
        type: "redirect",
        redirect: { destination: "https://example.com/new/" },
      }),
    );
    if (!compiled.ok) throw new Error("fixture did not compile");
    const result = dryRunProject(
      compiled.operations,
      [
        {
          url: "https://example.com/old/path",
          method: "GET",
          resourceType: "main_frame",
        },
      ],
      { previewAction: previewRuleAction },
    );
    expect(result.results[0]?.rules[0]).toMatchObject({
      matched: false,
      method: { state: "unmatched" },
      actionPreview: {
        kind: "redirect",
        summary: "https://example.com/new/",
      },
    });
    const matched = dryRunProject(
      compiled.operations,
      [
        {
          url: "https://example.com/old/path",
          method: "POST",
          resourceType: "main_frame",
        },
      ],
      { previewAction: previewRuleAction },
    );
    expect(matched.results[0]?.rules[0]).toMatchObject({
      matched: true,
      actionPreview: {
        kind: "redirect",
        summary: "https://example.com/new/",
      },
    });
  });
});
