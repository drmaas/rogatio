import { describe, expect, it } from "vitest";
import { validateProjectDetailed } from "../src/browser-schema.js";
import { project } from "./fixtures.js";

describe("F7 browser schema", () => {
  it("rejects unknown properties like the Node schema boundary", () => {
    expect(
      validateProjectDetailed({ ...project, unexpected: true }),
    ).toMatchObject({
      valid: false,
      errors: [{ keyword: "unknown-property" }],
    });
  });

  it("rejects v1 urlRegex and origins fields", () => {
    expect(
      validateProjectDetailed({
        ...project,
        groups: [
          {
            ...project.groups[0],
            origins: ["https://example.com"],
          },
        ],
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateProjectDetailed({
        ...project,
        groups: [
          {
            ...project.groups[0],
            rules: [
              {
                ...project.groups[0].rules[0],
                urlRegex: "^https://example\\.com/",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ valid: false });
  });

  it("rejects invalid source operator", () => {
    expect(
      validateProjectDetailed({
        ...project,
        groups: [
          {
            ...project.groups[0],
            rules: [
              {
                ...project.groups[0].rules[0],
                source: {
                  key: "url",
                  operator: "equals",
                  value: "^https://example\\.com/",
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ valid: false });
  });

  it("rejects duplicate names the same way the Node schema boundary does", () => {
    const base = project.groups[0];
    const result = validateProjectDetailed({
      ...project,
      groups: [
        { ...base, rules: [] },
        { ...base, id: "group-two", name: base.name, rules: [] },
      ],
    });
    expect(result).toMatchObject({
      valid: false,
      errors: [{ keyword: "duplicate-name", instancePath: "/groups/1/name" }],
    });
  });

  it("treats case-only and spacing-only name differences as duplicates", () => {
    const base = project.groups[0];
    const result = validateProjectDetailed({
      ...project,
      groups: [
        { ...base, rules: [] },
        {
          ...base,
          id: "group-two",
          name: `  ${base.name.toUpperCase()}  `,
          rules: [],
        },
      ],
    });
    expect(result).toMatchObject({
      valid: false,
      errors: [{ keyword: "duplicate-name" }],
    });
  });

  it("does not report a duplicate name for an already invalid name", () => {
    const base = project.groups[0];
    const result = validateProjectDetailed({
      ...project,
      groups: [
        { ...base, name: "", rules: [] },
        { ...base, id: "group-two", name: "", rules: [] },
      ],
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.keyword === "duplicate-name")).toBe(
      false,
    );
  });
});
