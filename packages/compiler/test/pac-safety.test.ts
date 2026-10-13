import { describe, expect, it } from "vitest";
import { isPacSafeSource } from "../src/pac-safety.js";

describe("isPacSafeSource", () => {
  it("rejects a quantified group whose body contains alternation", () => {
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "(a|aa)+",
      }),
    ).toBe(false);
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "^http://example\\.com/(a|aa)+$",
      }),
    ).toBe(false);
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "(a|aa)*",
      }),
    ).toBe(false);
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "(a|aa){2}",
      }),
    ).toBe(false);
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "(a|aa)?",
      }),
    ).toBe(false);
  });

  it("allows an unquantified alternation and a linear group", () => {
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/(a|b)$",
      }),
    ).toBe(true);
    expect(
      isPacSafeSource({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/([^/]+)",
      }),
    ).toBe(true);
    expect(
      isPacSafeSource({
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      }),
    ).toBe(true);
  });
});
