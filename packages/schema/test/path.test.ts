import { describe, expect, it } from "vitest";
import {
  isValidMockLogicalPath as browserIsValidMockLogicalPath,
  normalizeLogicalPath as browserNormalizeLogicalPath,
} from "../src/browser-index.js";
import { isValidMockLogicalPath, normalizeLogicalPath } from "../src/index.js";

const cases: readonly { readonly value: string; readonly accepted: boolean }[] =
  [
    { value: "fixtures/body.txt", accepted: true },
    { value: "mocks/v1/body.json", accepted: true },
    { value: "..", accepted: false },
    { value: "dir/../file", accepted: false },
    { value: "dir/./file", accepted: false },
    { value: "/absolute/path", accepted: false },
    { value: "dir\\file", accepted: false },
    { value: "a%2e", accepted: false },
    { value: "dir//file", accepted: false },
    { value: "dir/", accepted: false },
    { value: "foo:bar", accepted: false },
    { value: "file*", accepted: false },
    { value: "file?", accepted: false },
    { value: "file[", accepted: false },
    { value: "file]", accepted: false },
    { value: "", accepted: false },
    { value: "has\u0000nul", accepted: false },
  ];

describe("logical path helpers", () => {
  it("exports the same functions from the node and browser entries", () => {
    expect(browserNormalizeLogicalPath).toBe(normalizeLogicalPath);
    expect(browserIsValidMockLogicalPath).toBe(isValidMockLogicalPath);
  });

  it("accepts a nested relative path and rejects unsafe segments", () => {
    for (const { value, accepted } of cases) {
      expect(isValidMockLogicalPath(value)).toBe(accepted);
      expect(normalizeLogicalPath(value)).toBe(accepted ? value : null);
      expect(isValidMockLogicalPath(value)).toBe(
        normalizeLogicalPath(value) !== null,
      );
    }
  });

  it("rejects non-strings from normalizeLogicalPath", () => {
    for (const value of [null, undefined, 1, { path: "a" }, ["a"]]) {
      expect(normalizeLogicalPath(value)).toBeNull();
    }
  });
});
