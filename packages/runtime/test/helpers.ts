import type { MatcherOperation } from "@rogatio/compiler";
import {
  RUNTIME_LIMITS,
  type RuntimeGrant,
  type RuntimeLimits,
  type RuntimePresetV1,
} from "../src/index.js";

export function makeMatcher(
  ruleId = "rule-main",
  overrides: Partial<MatcherOperation["matcher"]> = {},
): MatcherOperation {
  return {
    kind: "matcher",
    groupId: "group-main",
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

export function makeGrant(overrides: Partial<RuntimeGrant> = {}): RuntimeGrant {
  return {
    groupId: "group-main",
    ruleId: "rule-main",
    operationId: "operation-main",
    kind: "outbound-http",
    target: "https://example.com/data",
    method: "GET",
    ...overrides,
  };
}

export function makePresetInput(
  overrides: Partial<RuntimePresetV1> = {},
): RuntimePresetV1 {
  return {
    version: 1,
    limits: { ...RUNTIME_LIMITS },
    matchers: [makeMatcher()],
    grants: [makeGrant()],
    ...overrides,
  };
}

export function cloneLimits(): RuntimeLimits {
  return { ...RUNTIME_LIMITS };
}

export function descriptorBody(grant: RuntimeGrant = makeGrant()): string {
  return JSON.stringify({
    groupId: grant.groupId,
    ruleId: grant.ruleId,
    operationId: grant.operationId,
    kind: grant.kind,
    target: grant.target,
    method: grant.method,
  });
}

export const DEFAULT_REQUEST_URL = "https://example.com/page";
