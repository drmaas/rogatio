import { describe, expect, it } from "vitest";
import { RUNTIME_LIMITS } from "../src/limits.js";
import { validateRequestBodyPolicy } from "../src/policy.js";

function policy(pattern: string) {
  return {
    protocol: "v1" as const,
    version: 1 as const,
    extensionId: "a".repeat(32),
    projectId: "project",
    projectRevision: 1,
    enabledGroupIds: ["g1"],
    localTargetOrigins: [],
    operations: [
      {
        kind: "request-body" as const,
        groupId: "g1",
        ruleId: "r1",
        sourceOrder: 0,
        matcher: {
          source: {
            key: "url" as const,
            operator: "regex" as const,
            value: "^https://example\\.com/",
          },
          resourceTypes: ["xmlhttprequest"],
          priority: 1,
          method: "POST",
        },
        requestBody: {
          mode: "regex" as const,
          pattern,
          replacement: "x",
        },
      },
    ],
    limits: {
      maxRequestBodyBytes: RUNTIME_LIMITS.maxRequestBodyBytes,
      maxRequestBodyPatternLength: RUNTIME_LIMITS.maxRequestBodyPatternLength,
      maxRequestBodyReplacementLength:
        RUNTIME_LIMITS.maxRequestBodyReplacementLength,
      maxRequestBodyOperations: RUNTIME_LIMITS.maxRequestBodyOperations,
      maxRequestBodyTransforms: RUNTIME_LIMITS.maxRequestBodyTransforms,
      maxRegexDeadlineMs: RUNTIME_LIMITS.maxRegexDeadlineMs,
      maxLocalOrigins: RUNTIME_LIMITS.maxLocalOrigins,
      maxCanonicalPolicyBytes: RUNTIME_LIMITS.maxPresetBytes,
      maxNativeFrameBytes: RUNTIME_LIMITS.maxControlBodyBytes,
    },
  };
}

describe(" request-body policy regex validity", () => {
  it.each(["\\u{1F600}", "\\p{Letter}"])(
    "accepts unicode pattern %s",
    (pattern) => {
      expect(validateRequestBodyPolicy(policy(pattern)).ok).toBe(true);
    },
  );

  it.each(["\\q", "\\8", "\\#", "\\-", "["])(
    "rejects pattern %s with runtime.request-body-regex-invalid",
    (pattern) => {
      const result = validateRequestBodyPolicy(policy(pattern));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("runtime.request-body-regex-invalid");
      }
    },
  );
});
