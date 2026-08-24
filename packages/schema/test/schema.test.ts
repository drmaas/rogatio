import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_REQUEST_HEADERS,
  FORBIDDEN_RESPONSE_HEADERS,
  isForbiddenHeader,
} from "../src/headers.js";
import {
  assertValidProject,
  compileUrlRegex,
  isSiteOrigin,
  isValidUrlRegex,
  LIMITS,
  normalizeSiteOrigin,
  projectValidator,
  type RogatioProject,
  validateProject,
  validateProjectDetailed,
} from "../src/index.js";

function makeRule(index: number) {
  return {
    id: `rule-${index}`,
    name: `Rule ${index}`,
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame" as const],
    priority: 100,
  };
}

function makeProject(): RogatioProject {
  return {
    version: 1,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        origins: ["https://example.com"],
        rules: [makeRule(1)],
      },
    ],
  };
}

describe("@rogatio/schema", () => {
  it("accepts the common version-1 project and returns typed data", () => {
    const project = makeProject();

    expect(validateProject(project)).toBe(true);
    const result = validateProjectDetailed(project);
    expect(result).toEqual({ valid: true, data: project });
    expect(assertValidProject(project)).toBe(project);
  });

  it("rejects unknown properties and unsupported version values", () => {
    const project = {
      ...makeProject(),
      version: 2,
      unexpected: true,
    };

    const result = validateProjectDetailed(project);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.keyword === "const")).toBe(
        true,
      );
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  it("accepts explicit origins and rejects broad or non-web origins", () => {
    expect(isSiteOrigin("https://example.com")).toBe(true);
    expect(isSiteOrigin("https://example.com/")).toBe(true);
    expect(isSiteOrigin("http://localhost:8080")).toBe(true);
    expect(isSiteOrigin("https://[::1]:8443")).toBe(true);
    expect(normalizeSiteOrigin("HTTPS://Example.COM/")).toBe(
      "https://example.com",
    );

    for (const origin of [
      "https://*.example.com",
      "https://user:pass@example.com",
      "https://@example.com",
      "https://example.com/path",
      "https://example.com/.",
      "https://example.com/%2e%2e",
      "https://exa\nmple.com",
      "https://example.com?query",
      "https://example.com#fragment",
      "ftp://example.com",
      "example.com",
      "",
    ]) {
      expect(isSiteOrigin(origin), origin).toBe(false);
    }
  });

  it("accepts rule-owned origins and preserves regex case sensitivity", () => {
    const project = makeProject();
    project.groups[0].origins = [];
    project.groups[0].rules[0].origins = ["http://localhost:8080"];
    expect(validateProject(project)).toBe(true);

    const pattern = compileUrlRegex("Example");
    expect(pattern?.test("Example")).toBe(true);
    expect(pattern?.test("example")).toBe(false);
    expect(isValidUrlRegex("Example")).toBe(true);
    expect(isValidUrlRegex("[")).toBe(false);
  });

  it("rejects invalid regular expressions and patterns over the bound", () => {
    const invalidRegex = makeProject();
    invalidRegex.groups[0].rules[0].urlRegex = "[";
    expect(validateProject(invalidRegex)).toBe(false);

    const longRegex = makeProject();
    longRegex.groups[0].rules[0].urlRegex = "a".repeat(
      LIMITS.maxUrlRegexLength + 1,
    );
    expect(validateProject(longRegex)).toBe(false);
  });

  it("requires effective origins and unique stable IDs", () => {
    const noEffectiveOrigin = makeProject();
    noEffectiveOrigin.groups[0].origins = [];
    const originResult = validateProjectDetailed(noEffectiveOrigin);
    expect(originResult.valid).toBe(false);
    if (!originResult.valid) {
      expect(
        originResult.errors.some(
          (error) => error.keyword === "effectiveOrigin",
        ),
      ).toBe(true);
    }

    const duplicateId = makeProject();
    duplicateId.groups[0].rules.push(makeRule(1));
    const duplicateResult = validateProjectDetailed(duplicateId);
    expect(duplicateResult.valid).toBe(false);
    if (!duplicateResult.valid) {
      expect(
        duplicateResult.errors.some((error) => error.keyword === "uniqueId"),
      ).toBe(true);
    }
  });

  it("enforces collection and numeric bounds", () => {
    const tooManyRules = makeProject();
    tooManyRules.groups[0].rules = Array.from(
      { length: LIMITS.maxRulesPerGroup + 1 },
      (_, index) => makeRule(index),
    );
    expect(validateProject(tooManyRules)).toBe(false);

    const maxPriority = makeProject();
    maxPriority.groups[0].rules[0].priority = LIMITS.maxPriority;
    expect(validateProject(maxPriority)).toBe(true);

    const invalidPriority = makeProject();
    invalidPriority.groups[0].rules[0].priority = 0;
    expect(validateProject(invalidPriority)).toBe(false);
  });

  it("enforces the project-wide rule bound", () => {
    const project = makeProject();
    project.groups = Array.from({ length: 17 }, (_, groupIndex) => ({
      id: `group-${groupIndex}`,
      name: `Group ${groupIndex}`,
      origins: ["https://example.com"],
      rules: Array.from({ length: LIMITS.maxRulesPerGroup }, (_, ruleIndex) =>
        makeRule(groupIndex * LIMITS.maxRulesPerGroup + ruleIndex),
      ),
    }));

    const result = validateProjectDetailed(project);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "maxRulesPerProject"),
      ).toBe(true);
    }
  });

  it("does not mutate arbitrary input while validating", () => {
    const project = makeProject();
    const before = structuredClone(project);

    expect(validateProject(project)).toBe(true);
    expect(project).toEqual(before);

    for (const value of [null, 1, "project", [], {}, { version: 1 }]) {
      expect(() => validateProject(value)).not.toThrow();
      expect(validateProject(value)).toBe(false);
    }
  });

  it("does not validate fields inherited from a prototype", () => {
    const inherited = Object.create(makeProject()) as object;

    expect(validateProject(inherited)).toBe(false);
  });

  it("rejects accessor-backed values without invoking the accessor", () => {
    const project = makeProject();
    let getterRead = false;
    Object.defineProperty(project.groups[0].rules[0], "priority", {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 1n;
      },
    });

    expect(validateProject(project)).toBe(false);
    expect(getterRead).toBe(false);
  });

  it("does not validate inherited entries in sparse arrays", () => {
    const inheritedGroups = [] as RogatioProject["groups"];
    Object.setPrototypeOf(inheritedGroups, { 0: makeProject().groups[0] });
    inheritedGroups.length = 1;

    const project = { ...makeProject(), groups: inheritedGroups };
    expect(validateProject(project)).toBe(false);
    expect(projectValidator(project)).toBe(false);
  });

  it("does not trust overridden collection iteration", () => {
    const project = makeProject();
    project.groups[0].origins = [];
    project.groups[0].rules[0].origins = [];
    Object.defineProperty(project.groups, "entries", {
      value: () => [][Symbol.iterator](),
    });
    Object.defineProperty(project.groups[0].origins, Symbol.iterator, {
      value: function* () {
        yield "https://example.com";
      },
    });

    expect(validateProject(project)).toBe(false);
  });

  it("exposes frozen, case-insensitive forbidden-header policies", () => {
    expect(Object.isFrozen(FORBIDDEN_REQUEST_HEADERS)).toBe(true);
    expect(Object.isFrozen(FORBIDDEN_RESPONSE_HEADERS)).toBe(true);
    expect(isForbiddenHeader("Host", "request")).toBe(true);
    expect(isForbiddenHeader("SEC-FETCH-SITE", "request")).toBe(true);
    expect(isForbiddenHeader("set-cookie", "response")).toBe(true);
    expect(isForbiddenHeader("X-Rogatio-Test", "request")).toBe(false);
    expect(isForbiddenHeader("set-cookie", "request")).toBe(false);
  });

  it("accepts a valid query action", () => {
    const project = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [
            {
              ...makeRule(1),
              action: {
                type: "query",
                params: [{ name: "utm_source", value: "rogatio" }],
              },
            },
          ],
        },
      ],
    };

    expect(validateProject(project)).toBe(true);
  });

  it("rejects an unknown action type", () => {
    const project = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [{ ...makeRule(1), action: { type: "redirect" } }],
        },
      ],
    };

    const result = validateProjectDetailed(project);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.keyword === "const")).toBe(
        true,
      );
    }
  });

  it("rejects empty params, duplicate param names, and empty values", () => {
    const empty = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [{ ...makeRule(1), action: { type: "query", params: [] } }],
        },
      ],
    };
    expect(validateProject(empty)).toBe(false);

    const duplicate = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [
            {
              ...makeRule(1),
              action: {
                type: "query",
                params: [
                  { name: "a", value: "1" },
                  { name: "a", value: "2" },
                ],
              },
            },
          ],
        },
      ],
    };
    const dupResult = validateProjectDetailed(duplicate);
    expect(dupResult.valid).toBe(false);
    if (!dupResult.valid) {
      expect(
        dupResult.errors.some(
          (error) => error.keyword === "uniqueQueryParamName",
        ),
      ).toBe(true);
    }

    const blank = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [
            {
              ...makeRule(1),
              action: { type: "query", params: [{ name: "", value: "1" }] },
            },
          ],
        },
      ],
    };
    expect(validateProject(blank)).toBe(false);
  });

  it("enforces query param bounds", () => {
    const tooMany = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [
            {
              ...makeRule(1),
              action: {
                type: "query",
                params: Array.from(
                  { length: LIMITS.maxQueryParamsPerRule + 1 },
                  (_, index) => ({ name: `n${index}`, value: "v" }),
                ),
              },
            },
          ],
        },
      ],
    };
    expect(validateProject(tooMany)).toBe(false);

    const longName = {
      ...makeProject(),
      groups: [
        {
          ...makeProject().groups[0],
          rules: [
            {
              ...makeRule(1),
              action: {
                type: "query",
                params: [
                  {
                    name: "x".repeat(LIMITS.maxQueryNameLength + 1),
                    value: "v",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(validateProject(longName)).toBe(false);
  });
});
