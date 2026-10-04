import { describe, expect, it } from "vitest";
import { summarizeAiPreview } from "../src/ai-preview.js";

function redirectProject() {
  return {
    version: 2,
    name: "Redirect example.com",
    groups: [
      {
        id: "grp-one",
        name: "Group One",
        rules: [
          {
            id: "rule-one",
            name: "Redirect docs",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/docs",
            },
            resourceTypes: ["main_frame"],
            priority: 100,
            type: "redirect",
            redirect: { destination: "https://example.com/guide" },
          },
        ],
      },
    ],
  };
}

describe("ai-preview summary", () => {
  it("summarizes a redirect preview with source and destination", () => {
    const summary = summarizeAiPreview(redirectProject());
    expect(summary.name).toBe("Redirect example.com");
    expect(summary.groups).toHaveLength(1);
    const group = summary.groups[0];
    expect(group?.name).toBe("Group One");
    expect(group?.rules).toHaveLength(1);
    const rule = group?.rules[0];
    expect(rule?.name).toBe("Redirect docs");
    expect(rule?.type).toBe("redirect");
    expect(rule?.source).toContain("^https://example\\.com/docs");
    expect(rule?.action).toContain("https://example.com/guide");
    expect(rule?.resourceTypes).toBe("main_frame");
    expect(rule?.priority).toBe("priority 100");
  });

  it("summarizes query, header, and body kinds", () => {
    const summary = summarizeAiPreview({
      version: 2,
      name: "Mixed",
      groups: [
        {
          id: "g",
          name: "G",
          rules: [
            {
              id: "q",
              name: "Query",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "query",
              action: {
                type: "query",
                params: [
                  { name: "a", value: "1" },
                  { name: "b", operation: "remove" },
                ],
              },
            },
            {
              id: "h",
              name: "Header",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "header",
              headerDirection: "request",
              headerOperation: "set",
              headerName: "X-Test",
              headerValue: "value",
            },
            {
              id: "rb",
              name: "Body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "response-body",
              responseBody: { mode: "replace", body: "hello" },
            },
            {
              id: "qb",
              name: "Req body",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.com/",
              },
              resourceTypes: ["xmlhttprequest"],
              priority: 100,
              method: "POST",
              type: "request-body",
              requestBody: { mode: "regex", pattern: "a", replacement: "b" },
            },
          ],
        },
      ],
    });
    const rules = summary.groups[0]?.rules ?? [];
    expect(rules).toHaveLength(4);
    expect(rules[0]?.action).toContain("a=1");
    expect(rules[0]?.action).toContain("b → removed");
    expect(rules[1]?.action).toContain("X-Test");
    expect(rules[2]?.action).toContain("Response body replace");
    expect(rules[3]?.action).toContain("Request body regex");
    expect(rules[3]?.method).toBe("POST");
  });

  it("falls back on empty and invalid input without throwing", () => {
    expect(summarizeAiPreview(null).groups).toEqual([]);
    expect(summarizeAiPreview({}).name).toBe("Generated project");
    expect(
      summarizeAiPreview({ version: 2, name: "", groups: [] }).groups,
    ).toEqual([]);
    expect(
      summarizeAiPreview({
        version: 2,
        name: "P",
        groups: [{ id: "g", name: "G", rules: [null] }],
      }).groups[0]?.rules[0]?.name,
    ).toBe("Invalid rule");
  });

  it("truncates large bodies with a length note", () => {
    const body = "x".repeat(500);
    const summary = summarizeAiPreview({
      version: 2,
      name: "P",
      groups: [
        {
          id: "g",
          name: "G",
          rules: [
            {
              id: "r",
              name: "R",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://a\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "response-body",
              responseBody: { mode: "replace", body },
            },
          ],
        },
      ],
    });
    const action = summary.groups[0]?.rules[0]?.action ?? "";
    expect(action).toContain("500 chars");
    expect(action.length).toBeLessThan(body.length);
  });

  it("caps groups and rules with omitted counts", () => {
    const groups = Array.from({ length: 70 }, (_, index) => ({
      id: `g-${index}`,
      name: `G ${index}`,
      rules: [],
    }));
    const manyRules = Array.from({ length: 300 }, (_, index) => ({
      id: `r-${index}`,
      name: `R ${index}`,
      source: { key: "url", operator: "regex", value: "^https://a\\.com/" },
      resourceTypes: ["main_frame"],
      priority: 100,
      type: "redirect",
      redirect: { destination: "https://example.com/" },
    }));
    const cappedGroups = summarizeAiPreview({ version: 2, name: "P", groups });
    expect(cappedGroups.groups).toHaveLength(64);
    expect(cappedGroups.omittedGroups).toBe(6);

    const cappedRules = summarizeAiPreview({
      version: 2,
      name: "P",
      groups: [{ id: "g", name: "G", rules: manyRules }],
    });
    expect(cappedRules.groups[0]?.rules).toHaveLength(256);
    expect(cappedRules.groups[0]?.omittedRules).toBe(44);
  });

  it("never invokes hostile accessors or proxies", () => {
    const evil = {
      get name() {
        throw new Error("getter");
      },
    };
    const proxy = new Proxy(
      { version: 2, name: "P", groups: [] },
      {
        get() {
          throw new Error("proxy");
        },
      },
    );
    expect(() => summarizeAiPreview(evil)).not.toThrow();
    expect(() => summarizeAiPreview(proxy)).not.toThrow();
    const sparse: unknown[] = [];
    sparse[5] = {
      id: "g",
      name: "G",
      rules: [],
    };
    expect(() =>
      summarizeAiPreview({ version: 2, name: "P", groups: sparse }),
    ).not.toThrow();
  });

  it("truncates long names, descriptions, sources, and destinations", () => {
    const longName = "n".repeat(500);
    const longDescription = "d".repeat(2000);
    const longPattern = `^https://a\\.com/${"p".repeat(2000)}`;
    const longDestination = `https://example.com/${"q".repeat(2000)}`;
    const summary = summarizeAiPreview({
      version: 2,
      name: longName,
      description: longDescription,
      groups: [
        {
          id: "g",
          name: longName,
          rules: [
            {
              id: "r",
              name: longName,
              source: { key: "url", operator: "regex", value: longPattern },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "redirect",
              redirect: { destination: longDestination },
            },
          ],
        },
      ],
    });
    expect(summary.name.length).toBeLessThan(longName.length);
    expect(summary.name).toContain("chars");
    expect(summary.description?.length).toBeLessThan(longDescription.length);
    const rule = summary.groups[0]?.rules[0];
    expect(rule?.name.length).toBeLessThan(longName.length);
    expect(rule?.source.length).toBeLessThan(longPattern.length + 20);
    expect(rule?.action.length).toBeLessThan(longDestination.length + 20);
  });

  it("never throws on throwing-length arrays", () => {
    const throwingGroups = new Proxy([], {
      get(target, prop, receiver) {
        if (prop === "length") throw new Error("length");
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(() =>
      summarizeAiPreview({ version: 2, name: "P", groups: throwingGroups }),
    ).not.toThrow();
    const throwingRules = new Proxy([], {
      get(target, prop, receiver) {
        if (prop === "length") throw new Error("length");
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(() =>
      summarizeAiPreview({
        version: 2,
        name: "P",
        groups: [{ id: "g", name: "G", rules: throwingRules }],
      }),
    ).not.toThrow();
  });

  it("labels empty or invalid response-body objects as generic rules", () => {
    for (const responseBody of [{}, { mode: "oops" }, { mode: "replace" }]) {
      const summary = summarizeAiPreview({
        version: 2,
        name: "P",
        groups: [
          {
            id: "g",
            name: "G",
            rules: [
              {
                id: "r",
                name: "R",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://a\\.com/",
                },
                resourceTypes: ["main_frame"],
                priority: 100,
                type: "response-body",
                responseBody,
              },
            ],
          },
        ],
      });
      const action = summary.groups[0]?.rules[0]?.action ?? "";
      expect(action).not.toContain("regex (");
      expect(action).toMatch(/Response body (rule|replace)/);
    }
  });
});
