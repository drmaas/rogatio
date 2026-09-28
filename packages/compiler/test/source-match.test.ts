import { describe, expect, it } from "vitest";
import {
  literalHostname,
  literalUrl,
  sameOrigin,
  sourceMatches,
  steeredRequestOrigin,
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

describe("literalUrl", () => {
  it("returns one exact URL for an anchored literal, including a literal capture", () => {
    expect(
      literalUrl({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/data\\.json$",
      }),
    ).toBe("https://example.com/data.json");
    expect(
      literalUrl({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/(submit)$",
      }),
    ).toBe("https://example.com/submit");
  });

  it("returns null for wildcards, host keys, and unanchored patterns", () => {
    expect(
      literalUrl({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/api/.*$",
      }),
    ).toBeNull();
    expect(
      literalUrl({
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
      }),
    ).toBeNull();
    expect(
      literalUrl({
        key: "url",
        operator: "regex",
        value: "^http://127\\.0\\.0\\.1/",
      }),
    ).toBeNull();
  });
});

describe("steeredRequestOrigin", () => {
  it("steers scheme and literal host, leaving the path regex out of the origin", () => {
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/data\\.json/([^/]+)",
      }),
    ).toEqual({ scheme: "https", host: "example.com" });
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "^http://127\\.0\\.0\\.1:8080/submit$",
      }),
    ).toEqual({ scheme: "http", host: "127.0.0.1", port: 8080 });
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/.*$",
      }),
    ).toEqual({ scheme: "https", host: "example.com" });
  });

  it("rejects unescaped dots, a missing slash, top-level alternation, and unanchored patterns", () => {
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "^https://example.com/data.json/",
      }),
    ).toBeNull();
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "^https://example\\.com$",
      }),
    ).toBeNull();
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "^https://a\\.example\\.com/|^https://b\\.example\\.com/",
      }),
    ).toBeNull();
    expect(
      steeredRequestOrigin({
        key: "url",
        operator: "regex",
        value: "https://example\\.com/data.json/",
      }),
    ).toBeNull();
    expect(
      steeredRequestOrigin({
        key: "host",
        operator: "regex",
        value: "^example\\.com$",
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
