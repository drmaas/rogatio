import type { MatcherOperation } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { dryRunProject } from "../src/index.js";

/**
 * Pins the full dryRunProject result before/after the #296 module split.
 * Covers url- and host-key rules, method/resource with and without constraints,
 * matched/unmatched/not-applicable for both dimensions, two-pass error order
 * (shape + non-string url before parse failures), and previewAction.
 */
const GOLDEN_OPERATIONS: readonly MatcherOperation[] = [
  {
    kind: "matcher",
    groupId: "g1",
    ruleId: "url-method-rt",
    name: "url with method and resourceTypes",
    redactSensitiveInLogs: false,
    matcher: {
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },
      resourceTypes: ["main_frame"],
      priority: 1,
      method: "GET",
    },
  },
  {
    kind: "matcher",
    groupId: "g1",
    ruleId: "host-open",
    name: "host with no method or resourceTypes",
    redactSensitiveInLogs: false,
    matcher: {
      source: {
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      },
      resourceTypes: [],
      priority: 2,
    },
  },
];

const GOLDEN_CASES = [
  { url: "not-a-valid-url" },
  { resourceType: "main_frame" },
  { url: 42 },
  {
    url: "https://example.com/page",
    method: "GET",
    resourceType: "main_frame",
  },
  {
    url: "https://example.com/page",
    method: "POST",
    resourceType: "script",
  },
  { url: "https://example.com/page" },
  {
    url: "https://example.com/other",
    method: "PUT",
    resourceType: "xmlhttprequest",
  },
] as const;

const GOLDEN_RESULT = {
  results: [
    {
      url: "https://example.com/page",
      rules: [
        {
          groupId: "g1",
          ruleId: "url-method-rt",
          matched: true,
          source: {
            state: "matched",
            matched: true,
            detail: "url matched /^https://example\\.com// (url)",
          },
          method: {
            state: "matched",
            matched: true,
            detail: "method GET matches",
          },
          resourceType: {
            state: "matched",
            matched: true,
            detail: "resource type main_frame matches",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:url-method-rt",
          },
        },
        {
          groupId: "g1",
          ruleId: "host-open",
          matched: true,
          source: {
            state: "matched",
            matched: true,
            detail: "hostname matched /^example\\.com$/ (host)",
          },
          method: {
            state: "matched",
            matched: true,
            detail: "rule has no method constraint",
          },
          resourceType: {
            state: "matched",
            matched: true,
            detail: "rule has no resource type constraint",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:host-open",
          },
        },
      ],
      matchedRuleCount: 2,
    },
    {
      url: "https://example.com/page",
      rules: [
        {
          groupId: "g1",
          ruleId: "url-method-rt",
          matched: false,
          source: {
            state: "matched",
            matched: true,
            detail: "url matched /^https://example\\.com// (url)",
          },
          method: {
            state: "unmatched",
            matched: false,
            detail: "rule method GET != POST",
          },
          resourceType: {
            state: "unmatched",
            matched: false,
            detail: "rule resource types [main_frame] exclude script",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:url-method-rt",
          },
        },
        {
          groupId: "g1",
          ruleId: "host-open",
          matched: true,
          source: {
            state: "matched",
            matched: true,
            detail: "hostname matched /^example\\.com$/ (host)",
          },
          method: {
            state: "matched",
            matched: true,
            detail: "rule has no method constraint",
          },
          resourceType: {
            state: "matched",
            matched: true,
            detail: "rule has no resource type constraint",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:host-open",
          },
        },
      ],
      matchedRuleCount: 1,
    },
    {
      url: "https://example.com/page",
      rules: [
        {
          groupId: "g1",
          ruleId: "url-method-rt",
          matched: true,
          source: {
            state: "matched",
            matched: true,
            detail: "url matched /^https://example\\.com// (url)",
          },
          method: {
            state: "not-applicable",
            matched: null,
            detail: "method not specified",
          },
          resourceType: {
            state: "not-applicable",
            matched: null,
            detail: "resource type not specified",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:url-method-rt",
          },
        },
        {
          groupId: "g1",
          ruleId: "host-open",
          matched: true,
          source: {
            state: "matched",
            matched: true,
            detail: "hostname matched /^example\\.com$/ (host)",
          },
          method: {
            state: "not-applicable",
            matched: null,
            detail: "method not specified",
          },
          resourceType: {
            state: "not-applicable",
            matched: null,
            detail: "resource type not specified",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:host-open",
          },
        },
      ],
      matchedRuleCount: 2,
    },
    {
      url: "https://example.com/other",
      rules: [
        {
          groupId: "g1",
          ruleId: "url-method-rt",
          matched: false,
          source: {
            state: "matched",
            matched: true,
            detail: "url matched /^https://example\\.com// (url)",
          },
          method: {
            state: "unmatched",
            matched: false,
            detail: "rule method GET != PUT",
          },
          resourceType: {
            state: "unmatched",
            matched: false,
            detail: "rule resource types [main_frame] exclude xmlhttprequest",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:url-method-rt",
          },
        },
        {
          groupId: "g1",
          ruleId: "host-open",
          matched: true,
          source: {
            state: "matched",
            matched: true,
            detail: "hostname matched /^example\\.com$/ (host)",
          },
          method: {
            state: "matched",
            matched: true,
            detail: "rule has no method constraint",
          },
          resourceType: {
            state: "matched",
            matched: true,
            detail: "rule has no resource type constraint",
          },
          actionPreview: {
            kind: "noop",
            summary: "g1:host-open",
          },
        },
      ],
      matchedRuleCount: 1,
    },
  ],
  errors: [
    {
      code: "dryrun.invalid-case",
      message: "Test case is invalid",
      index: 1,
    },
    {
      code: "dryrun.invalid-url",
      message: "Test case URL is invalid",
      index: 2,
    },
    {
      code: "dryrun.invalid-url",
      message: "Test case URL is invalid",
      index: 0,
    },
  ],
  summary: {
    caseCount: 5,
    urlCount: 4,
    matchedUrlCount: 4,
    matchedRuleTotal: 6,
  },
};

describe("dryRunProject golden (#296)", () => {
  it("pins the full result for the split fixture", () => {
    const result = dryRunProject(
      GOLDEN_OPERATIONS,
      GOLDEN_CASES as unknown as Parameters<typeof dryRunProject>[1],
      {
        previewAction: (operation) => ({
          kind: "noop",
          summary: `${operation.groupId}:${operation.ruleId}`,
        }),
      },
    );
    expect(result).toEqual(GOLDEN_RESULT);
  });
});
