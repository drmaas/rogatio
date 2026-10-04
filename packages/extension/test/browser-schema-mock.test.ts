import { validateProjectDetailed as validateNode } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { mockParityProjects } from "../../schema/test/mock-validation-fixtures.js";
import { validateProjectDetailed as validateBrowser } from "../src/browser-schema.js";

describe("mock browser schema parity", () => {
  it.each(mockParityProjects().map((project, index) => [index, project]))(
    "matches Node diagnostics for fixture %i",
    (_index, project) => {
      const node = validateNode(project);
      const browser = validateBrowser(project);
      expect(browser.valid).toBe(node.valid);
      if (node.valid) {
        expect(browser).toMatchObject({ valid: true });
        return;
      }
      if (browser.valid) return;
      expect(browser.errors).toEqual(node.errors);
    },
  );
});
