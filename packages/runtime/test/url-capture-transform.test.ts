import { describe, expect, it } from "vitest";
import { rewriteRequestBody } from "../src/request-body.js";
import { rewriteResponseBody } from "../src/response-body.js";

describe("runtime URL capture substitution", () => {
  it("substitutes URL captures in request replace bodies", async () => {
    const result = await rewriteRequestBody(
      {
        contentType: "application/json",
        contentEncoding: "identity",
        body: new TextEncoder().encode("{}"),
      },
      { mode: "replace", body: '{"user":"$1","price":"$$5"}' },
      {
        url: "https://example.com/users/alice",
        urlRegex: "^https://example\\.com/users/([^/]+)$",
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"user":"alice","price":"$5"}',
      );
    }
  });

  it("substitutes URL captures in response replace bodies", async () => {
    const result = await rewriteResponseBody(
      {
        contentType: "application/json",
        body: new TextEncoder().encode("ignored"),
      },
      [],
      {
        mode: "replace",
        body: '{"user":"$1"}',
      },
      {
        url: "https://example.com/users/alice",
        urlRegex: "^https://example\\.com/users/([^/]+)$",
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"user":"alice"}',
      );
    }
  });
});
