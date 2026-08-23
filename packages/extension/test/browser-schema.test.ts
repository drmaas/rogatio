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

  it("rejects backslash origins and duplicate collection entries", () => {
    expect(
      validateProjectDetailed({
        ...project,
        groups: [
          {
            ...project.groups[0],
            origins: ["https://example.com\\evil.com/"],
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
            origins: ["https://example.com", "https://example.com"],
          },
        ],
      }),
    ).toMatchObject({ valid: false });
  });
});
