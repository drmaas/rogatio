import type { RogatioRule } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { builtInRuleTypes, createMockRuleType } from "../src/index.js";

const ext = createMockRuleType();

const mockRule: RogatioRule = {
  id: "rule-mock",
  name: "Mock rule",
  urlRegex: "^https://example\\.com/",
  origins: [],
  resourceTypes: ["main_frame"],
  priority: 100,
  type: "mock",
  mock: { status: 200, body: "hello" },
};

function asRecord(rule: Record<string, unknown>): Record<string, unknown> {
  return rule;
}

describe("@rogatio/editor mock rule type ()", () => {
  it("registers the mock rule type as a built-in extension", () => {
    expect(builtInRuleTypes.map((e) => e.id)).toContain("mock");
  });

  it("matches only rules carrying a mock payload or type", () => {
    expect(ext.matches(asRecord({ ...mockRule }))).toBe(true);
    expect(
      ext.matches(
        asRecord({
          ...mockRule,
          type: undefined,
          mock: { status: 200, body: "x" },
        }),
      ),
    ).toBe(true);
    expect(ext.matches(asRecord({ ...mockRule, type: "header" }))).toBe(false);
    expect(
      ext.matches(asRecord({ ...mockRule, type: undefined, mock: undefined })),
    ).toBe(false);
  });

  it("provides a fresh default action with a valid inline body", () => {
    expect(ext.defaultAction?.()).toEqual({ status: 200, body: "" });
  });

  it("validates a well-formed inline-body and file mock rule", () => {
    expect(
      ext.validate(asRecord({ ...mockRule }), "/groups/0/rules/0"),
    ).toEqual([]);
    expect(
      ext.validate(
        asRecord({
          ...mockRule,
          mock: {
            status: 201,
            headers: [{ name: "x-test", value: "1" }],
            delayMs: 100,
            file: "fixtures/data.json",
          },
        }),
        "/groups/0/rules/0",
      ),
    ).toEqual([]);
  });

  it("rejects both body and file set, and neither set", () => {
    const both = ext.validate(
      asRecord({
        ...mockRule,
        mock: { status: 200, body: "x", file: "a.txt" },
      }),
      "/groups/0/rules/0",
    );
    expect(both.some((d) => d.code === "editor.mock-body-source")).toBe(true);

    const neither = ext.validate(
      asRecord({ ...mockRule, mock: { status: 200 } }),
      "/groups/0/rules/0",
    );
    expect(neither.some((d) => d.code === "editor.mock-body-source")).toBe(
      true,
    );
  });

  it("rejects an out-of-range status and a negative delayMs", () => {
    for (const status of [199, 600, 200.5]) {
      const diagnostics = ext.validate(
        asRecord({ ...mockRule, mock: { status, body: "x" } }),
        "/groups/0/rules/0",
      );
      expect(diagnostics.length, String(status)).toBeGreaterThan(0);
    }
    const delay = ext.validate(
      asRecord({ ...mockRule, mock: { status: 200, body: "x", delayMs: -1 } }),
      "/groups/0/rules/0",
    );
    expect(delay.length).toBeGreaterThan(0);
  });

  it("rejects over-limit header counts and invalid header names", () => {
    const many = Array.from({ length: 33 }, (_, index) => ({
      name: `x-${index}`,
      value: "1",
    }));
    const count = ext.validate(
      asRecord({
        ...mockRule,
        mock: { status: 200, body: "x", headers: many },
      }),
      "/groups/0/rules/0",
    );
    expect(count.length).toBeGreaterThan(0);

    const colon = ext.validate(
      asRecord({
        ...mockRule,
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "bad:name", value: "1" }],
        },
      }),
      "/groups/0/rules/0",
    );
    expect(colon.length).toBeGreaterThan(0);
  });
});
