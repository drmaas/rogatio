import { describe, expect, it } from "vitest";
import { composeSmokeMessage } from "../src/index.js";

describe("smoke package", () => {
  it("composes a deterministic bootstrap message", () => {
    expect(composeSmokeMessage("test")).toBe("test -> smoke");
  });
});
