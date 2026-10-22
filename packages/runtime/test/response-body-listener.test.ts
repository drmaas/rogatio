import { describe, expect, it } from "vitest";
import { parseResponseBodyRedirect } from "../src/response-body-listener.js";

describe("parseResponseBodyRedirect", () => {
  it("keeps the original URL, including its query, after the token, rule id, and digest", () => {
    expect(
      parseResponseBodyRedirect(
        "/.rogatio/body/tok/rule-1/sha256%3Aabc/https://example.com/data.json?x=1",
      ),
    ).toEqual({
      token: "tok",
      ruleId: "rule-1",
      digest: "sha256:abc",
      originalUrl: "https://example.com/data.json?x=1",
    });
  });

  it("rejects a path that is not the listener prefix or has no token", () => {
    expect(parseResponseBodyRedirect("https://example.com/data.json")).toBe(
      null,
    );
    expect(parseResponseBodyRedirect("/.rogatio/body/rule-1")).toBeNull();
    expect(
      parseResponseBodyRedirect(
        "/.rogatio/body/rule-1/sha256%3Aabc/https://example.com/data.json?x=1",
      ),
    ).toBeNull();
    expect(
      parseResponseBodyRedirect(
        "/.rogatio/body/to%2fken/rule-1/sha256%3Aabc/https://example.com/",
      ),
    ).toBeNull();
    expect(
      parseResponseBodyRedirect(
        "/.rogatio/body/tok%00en/rule-1/sha256%3Aabc/https://example.com/",
      ),
    ).toBeNull();
  });
});
