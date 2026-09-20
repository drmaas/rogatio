import { describe, expect, it } from "vitest";
import {
  substituteUrlCaptures,
  validateCaptureTemplate,
} from "../src/index.js";

describe("URL capture templates", () => {
  it("substitutes captures and escaped dollars", () => {
    expect(substituteUrlCaptures("user=$1 price=$$5/$2", ["42", "books"])).toBe(
      "user=42 price=$5/books",
    );
  });

  it("uses an empty string for an unmatched optional capture", () => {
    expect(substituteUrlCaptures("$1-$2", ["one", undefined])).toBe("one-");
  });

  it("rejects references beyond the URL capture count", () => {
    expect(validateCaptureTemplate("$2", "(one)")).toEqual([
      expect.objectContaining({ referenced: 2, groups: 1 }),
    ]);
  });

  it("does not treat escaped dollars as captures", () => {
    expect(validateCaptureTemplate("$$1", "(one)")).toEqual([]);
  });

  it("rejects malformed capture syntax", () => {
    expect(validateCaptureTemplate("$0", "(one)")[0]).toEqual(
      expect.objectContaining({ code: "invalid-syntax" }),
    );
  });
});
