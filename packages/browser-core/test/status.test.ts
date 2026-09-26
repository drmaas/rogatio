import type { MatcherOperation, NormalizedMatcher } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import {
  computeBadge,
  computeDesiredRules,
  computeRuleStatuses,
} from "../src/index.js";

function makeOperation(
  ruleId: string,
  groupId: string,
  overrides: Partial<NormalizedMatcher> = {},
): MatcherOperation {
  return {
    kind: "matcher",
    groupId,
    ruleId,
    name: ruleId,
    redactSensitiveInLogs: false,
    matcher: {
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },
      resourceTypes: ["main_frame"],
      priority: 100,
      ...overrides,
    },
  };
}

const operations = [
  makeOperation("r1", "g1"),
  makeOperation("r2", "g1"),
  makeOperation("r3", "g2"),
];

describe("computeRuleStatuses", () => {
  it("marks rules of disabled groups as disabled", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: [],
      installedRuleIds: [],
    });

    expect(statuses).toEqual([
      { groupId: "g1", ruleId: "r1", status: "disabled" },
      { groupId: "g1", ruleId: "r2", status: "disabled" },
      { groupId: "g2", ruleId: "r3", status: "disabled" },
    ]);
  });

  it("marks enabled rules that are not installed as errors", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1"],
      installedRuleIds: [],
    });

    expect(statuses).toEqual([
      {
        groupId: "g1",
        ruleId: "r1",
        status: "error",
        diagnostics: [
          {
            code: "core.rule-not-installed",
            severity: "error",
            path: "",
            message: expect.any(String),
            params: { ruleId: "r1", groupId: "g1" },
          },
        ],
      },
      {
        groupId: "g1",
        ruleId: "r2",
        status: "error",
        diagnostics: [
          {
            code: "core.rule-not-installed",
            severity: "error",
            path: "",
            message: expect.any(String),
            params: { ruleId: "r2", groupId: "g1" },
          },
        ],
      },
      { groupId: "g2", ruleId: "r3", status: "disabled" },
    ]);
  });

  it("marks installed enabled rules as active", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1", "g2"],
      installedRuleIds: ["r1", "r3"],
    });

    expect(statuses).toEqual([
      { groupId: "g1", ruleId: "r1", status: "active" },
      {
        groupId: "g1",
        ruleId: "r2",
        status: "error",
        diagnostics: [
          {
            code: "core.rule-not-installed",
            severity: "error",
            path: "",
            message: expect.any(String),
            params: { ruleId: "r2", groupId: "g1" },
          },
        ],
      },
      { groupId: "g2", ruleId: "r3", status: "active" },
    ]);
  });
});

describe("computeDesiredRules", () => {
  it("returns enabled rules without grant filtering", () => {
    const desired = computeDesiredRules({
      operations,
      enabledGroupIds: ["g1"],
    });
    expect(desired.map((op) => op.ruleId)).toEqual(["r1", "r2"]);
  });
});

describe("computeBadge", () => {
  it("counts active rules and raises attention for non-disabled non-active statuses", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1"],
      installedRuleIds: ["r1"],
    });
    const badge = computeBadge(statuses);
    expect(badge.text).toBe("1");
    expect(badge.attention).toBe(true);
  });
});
