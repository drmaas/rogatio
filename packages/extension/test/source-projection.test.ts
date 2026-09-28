import type { NormalizedMatcher } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import {
  isRequestBodySteerable,
  projectSourceCondition,
} from "../src/source-projection.js";

function matcher(
  source: NormalizedMatcher["source"],
  overrides: Partial<NormalizedMatcher> = {},
): NormalizedMatcher {
  return {
    source,
    resourceTypes: ["main_frame"],
    priority: 100,
    ...overrides,
  };
}

describe("projectSourceCondition", () => {
  it("uses regexFilter bytes for url key without requestDomains", () => {
    const result = projectSourceCondition(
      matcher({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/path$",
      }),
    );
    expect(result).toEqual({
      projectable: true,
      condition: { regexFilter: "^https://example\\.com/path$" },
    });
  });

  it("pins literal host with requestDomains and subdomain-safe regex", () => {
    const result = projectSourceCondition(
      matcher({
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      }),
    );
    expect(result.projectable).toBe(true);
    if (!result.projectable) return;
    expect(result.condition.requestDomains).toEqual(["example.com"]);
    expect(result.condition.regexFilter).toBe(
      "^https?://example\\.com(?::[0-9]+)?(?:[/?#]|$)",
    );
    expect(result.condition.regexFilter).not.toMatch(/a\.example/);
  });

  it("refuses non-literal host patterns", () => {
    expect(
      projectSourceCondition(
        matcher({
          key: "host",
          operator: "regex",
          value: "^.*\\.example\\.com$",
        }),
      ),
    ).toEqual({ projectable: false });
  });
});

describe("isRequestBodySteerable", () => {
  it("steers a literal host and a URL regex that names one literal host", () => {
    expect(
      isRequestBodySteerable(
        matcher({
          key: "host",
          operator: "regex",
          value: "^127\\.0\\.0\\.1$",
        }),
      ),
    ).toBe(true);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/data\\.json$",
        }),
      ),
    ).toBe(true);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/data\\.json/([^/]+)",
        }),
      ),
    ).toBe(true);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/api/.*$",
        }),
      ),
    ).toBe(true);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^http://127\\.0\\.0\\.1/",
        }),
      ),
    ).toBe(true);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/.*$",
        }),
      ),
    ).toBe(true);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^https://.*\\.example\\.com/",
        }),
      ),
    ).toBe(false);
    expect(
      isRequestBodySteerable(
        matcher({
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/x/((a+)+)",
        }),
      ),
    ).toBe(false);
  });
});
