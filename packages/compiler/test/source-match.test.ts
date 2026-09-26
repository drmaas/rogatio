import { describe, expect, it } from "vitest";
import {
  literalHostname,
  sameOrigin,
  sourceMatches,
} from "../src/source-match.js";

describe("sourceMatches", () => {
  it("matches url key against the full URL", () => {
    const source = {
      key: "url" as const,
      operator: "regex" as const,
      value: "^https://example\\.com/api$",
    };
    expect(sourceMatches(source, "https://example.com/api")).toBe(true);
    expect(sourceMatches(source, "https://evil.com/?x=example.com")).toBe(
      false,
    );
  });

  it("matches host key against hostname only (no port)", () => {
    // WHATWG URL.hostname is ASCII-lowercased; host patterns must use that form.
    const source = {
      key: "host" as const,
      operator: "regex" as const,
      value: "^example\\.com$",
    };
    expect(sourceMatches(source, "https://Example.com:8443/a")).toBe(true);
    expect(sourceMatches(source, "https://evil.com/?x=example.com")).toBe(
      false,
    );
  });
});

describe("literalHostname", () => {
  it("returns a hostname only for exact host regexes", () => {
    expect(
      literalHostname({
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      }),
    ).toBe("example.com");
    expect(
      literalHostname({
        key: "url",
        operator: "regex",
        value: "^example\\.com$",
      }),
    ).toBeNull();
    expect(
      literalHostname({
        key: "host",
        operator: "regex",
        value: "^example\\.com/path$",
      }),
    ).toBeNull();
  });
});

describe("sameOrigin", () => {
  it("compares origins", () => {
    expect(sameOrigin("https://a.example/x", "https://a.example/y?z=1")).toBe(
      true,
    );
    expect(sameOrigin("https://a.example/", "https://b.example/")).toBe(false);
  });
});
