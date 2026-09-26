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
});
