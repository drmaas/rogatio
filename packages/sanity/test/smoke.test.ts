import { describe, expect, it } from "vitest";
import { composeSanityMessage } from "../src/index.js";

describe("workspace smoke package", () => {
  it("executes a declared cross-package ESM import", () => {
    expect(composeSanityMessage()).toBe("sanity -> smoke");
  });
});
