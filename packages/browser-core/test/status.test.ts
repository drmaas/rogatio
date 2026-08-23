import type { MatcherOperation, NormalizedMatcher } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import {
  computeBadge,
  computeDeclaredOrigins,
  computeDesiredRules,
  computeRuleStatuses,
} from "../src/index.js";

function makeOperation(
  ruleId: string,
  groupId: string,
  origins: readonly string[],
  overrides: Partial<NormalizedMatcher> = {},
): MatcherOperation {
  return {
    kind: "matcher",
    groupId,
    ruleId,
    matcher: {
      urlRegex: { source: "^https://example\\.com/", flags: "" },
      origins: [...origins],
      resourceTypes: ["main_frame"],
      priority: 100,
      ...overrides,
    },
  };
}

const operations = [
  makeOperation("r1", "g1", ["https://a.example"]),
  makeOperation("r2", "g1", ["https://a.example", "https://b.example"]),
  makeOperation("r3", "g2", ["https://c.example"]),
];

describe("computeRuleStatuses", () => {
  it("marks rules of disabled groups as disabled", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: [],
      grantedOrigins: [],
      installedRuleIds: [],
    });

    expect(statuses).toEqual([
      { groupId: "g1", ruleId: "r1", status: "disabled" },
      { groupId: "g1", ruleId: "r2", status: "disabled" },
      { groupId: "g2", ruleId: "r3", status: "disabled" },
    ]);
  });

  it("marks enabled rules with un-granted origins as needing permission", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1"],
      grantedOrigins: ["https://a.example"],
      installedRuleIds: ["r1"],
    });

    expect(statuses).toEqual([
      { groupId: "g1", ruleId: "r1", status: "active" },
      {
        groupId: "g1",
        ruleId: "r2",
        status: "needs permission",
      },
      { groupId: "g2", ruleId: "r3", status: "disabled" },
    ]);
  });

  it("marks enabled granted rules that are not installed as errors", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1"],
      grantedOrigins: ["https://a.example"],
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
        status: "needs permission",
      },
      { groupId: "g2", ruleId: "r3", status: "disabled" },
    ]);
  });

  it("produces statuses in source order for mixed groups", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1", "g2"],
      grantedOrigins: ["https://a.example", "https://c.example"],
      installedRuleIds: ["r1", "r3"],
    });

    expect(statuses.map(({ ruleId, status }) => [ruleId, status])).toEqual([
      ["r1", "active"],
      ["r2", "needs permission"],
      ["r3", "active"],
    ]);
  });

  it("never produces runtime-dependent statuses in the F4 slice", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1", "g2"],
      grantedOrigins: [
        "https://a.example",
        "https://b.example",
        "https://c.example",
      ],
      installedRuleIds: ["r1", "r2", "r3"],
    });

    for (const { status } of statuses) {
      expect(["active", "disabled", "needs permission", "error"]).toContain(
        status,
      );
    }
  });

  it("ignores enabled group ids that do not exist", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["missing"],
      grantedOrigins: [],
      installedRuleIds: [],
    });

    expect(statuses.every(({ status }) => status === "disabled")).toBe(true);
  });

  it("returns no statuses for an empty operation list", () => {
    expect(
      computeRuleStatuses({
        operations: [],
        enabledGroupIds: ["g1"],
        grantedOrigins: [],
        installedRuleIds: [],
      }),
    ).toEqual([]);
  });
});

describe("computeDesiredRules", () => {
  it("returns enabled granted operations in source order", () => {
    const desired = computeDesiredRules({
      operations,
      enabledGroupIds: ["g1", "g2"],
      grantedOrigins: ["https://a.example", "https://c.example"],
    });

    expect(desired.map(({ ruleId }) => ruleId)).toEqual(["r1", "r3"]);
    expect(desired).toEqual([operations[0], operations[2]]);
  });

  it("returns nothing when no group is enabled or no origin is granted", () => {
    expect(
      computeDesiredRules({
        operations,
        enabledGroupIds: [],
        grantedOrigins: ["https://a.example"],
      }),
    ).toEqual([]);
    expect(
      computeDesiredRules({
        operations,
        enabledGroupIds: ["g1"],
        grantedOrigins: [],
      }),
    ).toEqual([]);
  });
});

describe("computeBadge", () => {
  it("renders the active rule count", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1", "g2"],
      grantedOrigins: [
        "https://a.example",
        "https://b.example",
        "https://c.example",
      ],
      installedRuleIds: ["r1", "r2", "r3"],
    });

    expect(computeBadge(statuses)).toEqual({ text: "3", attention: false });
  });

  it("shows zero without attention when everything is disabled", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: [],
      grantedOrigins: [],
      installedRuleIds: [],
    });

    expect(computeBadge(statuses)).toEqual({ text: "0", attention: false });
  });

  it("flags attention when an enabled rule needs permission", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1"],
      grantedOrigins: ["https://a.example"],
      installedRuleIds: ["r1"],
    });

    expect(computeBadge(statuses)).toEqual({ text: "1", attention: true });
  });

  it("flags attention when an enabled granted rule is an error", () => {
    const statuses = computeRuleStatuses({
      operations,
      enabledGroupIds: ["g1"],
      grantedOrigins: ["https://a.example"],
      installedRuleIds: [],
    });

    expect(computeBadge(statuses)).toEqual({ text: "0", attention: true });
  });
});

describe("computeDeclaredOrigins", () => {
  it("unions normalized effective origins across all operations", () => {
    const result = computeDeclaredOrigins({
      version: 1,
      name: "Declared",
      groups: [
        {
          id: "g1",
          name: "G1",
          origins: ["HTTPS://A.Example:443/"],
          rules: [
            {
              id: "r1",
              name: "R1",
              urlRegex: "^https://a\\.example/",
              origins: ["https://b.example"],
              resourceTypes: ["main_frame"],
              priority: 100,
            },
          ],
        },
        {
          id: "g2",
          name: "G2",
          origins: [],
          rules: [
            {
              id: "r2",
              name: "R2",
              urlRegex: "^https://c\\.example/",
              origins: ["https://c.example"],
              resourceTypes: ["main_frame"],
              priority: 100,
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        "https://a.example",
        "https://b.example",
        "https://c.example",
      ]);
    }
  });

  it("fails with compiler diagnostics for invalid data", () => {
    const result = computeDeclaredOrigins({ version: 1, name: "Broken" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("failure");
      expect(result.diagnostics[0]?.code).toBe("schema.required");
    }
  });
});
