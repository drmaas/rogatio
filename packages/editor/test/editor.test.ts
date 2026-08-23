import { LIMITS } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { urlToExactRegex } from "../src/index.js";

describe("@rogatio/editor URL conversion", () => {
  it("serializes and escapes an absolute URL as an exact source", () => {
    expect(urlToExactRegex("HTTPS://Example.COM:443/a.b?x=1&x=2")).toEqual({
      ok: true,
      source: "^https://example\\.com/a\\.b\\?x=1&x=2$",
    });
  });

  it("adds the URL serializer's empty path and preserves encoded query data", () => {
    expect(urlToExactRegex("https://example.com")).toEqual({
      ok: true,
      source: "^https://example\\.com/$",
    });
    expect(urlToExactRegex("https://example.com/a%2Fb?q=a%2Bb&q=a+b")).toEqual({
      ok: true,
      source: "^https://example\\.com/a%2Fb\\?q=a%2Bb&q=a\\+b$",
    });
  });

  it("rejects unsafe or non-request URL inputs without producing a source", () => {
    for (const value of [
      "https://user:pass@example.com/",
      "https://example.com/#fragment",
      " https://example.com/",
      "https://example.com/\n",
      "ftp://example.com/",
      "not a URL",
      "",
    ]) {
      expect(urlToExactRegex(value)).toMatchObject({
        ok: false,
        code: "editor.invalid-url",
      });
    }
  });

  it("rejects a generated source over the F2 regex bound", () => {
    const result = urlToExactRegex(
      `https://example.com/${"a".repeat(LIMITS.maxUrlRegexLength)}`,
    );

    expect(result).toEqual({ ok: false, code: "editor.url-too-long" });
  });

  it("does not treat URL text as a regex or add flags", () => {
    const result = urlToExactRegex("https://example.com/(a)+[b]|c");

    expect(result).toEqual({
      ok: true,
      source: "^https://example\\.com/\\(a\\)\\+\\[b\\]\\|c$",
    });
  });
});
