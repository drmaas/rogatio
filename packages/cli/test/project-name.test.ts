import { describe, expect, it } from "vitest";
import {
  emptyProjectDocument,
  randomCivilizationProjectName,
} from "../src/utils/project-storage.js";

const NAME_PATTERN = /^[A-Z][a-z]+ [A-Z][a-z]+$/;

describe("randomCivilizationProjectName", () => {
  it("returns a Title-Case two-word phrase", () => {
    for (let i = 0; i < 32; i += 1) {
      expect(randomCivilizationProjectName()).toMatch(NAME_PATTERN);
    }
  });

  it("varies across draws", () => {
    const names = new Set(
      Array.from({ length: 48 }, () => randomCivilizationProjectName()),
    );
    expect(names.size).toBeGreaterThan(1);
  });
});

describe("emptyProjectDocument", () => {
  it("bootstraps a schema-shaped project with a civilization-scale name", () => {
    const project = emptyProjectDocument();
    expect(project).toEqual({
      version: 2,
      name: expect.stringMatching(NAME_PATTERN),
      groups: [],
    });
  });
});
