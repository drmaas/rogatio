import { describe, expect, it } from "vitest";
import {
  type RequestBodyInput,
  rewriteRequestBody,
} from "../src/request-body.js";

function input(
  body: string,
  contentType = "application/json",
): RequestBodyInput {
  return {
    contentType,
    contentEncoding: "identity",
    body: new TextEncoder().encode(body),
  };
}

describe(" request-body transform", () => {
  it("replace mode substitutes the configured UTF-8 body and preserves media type", async () => {
    const result = await rewriteRequestBody(input('{"a":1}'), {
      mode: "replace",
      body: '{"a":2}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe('{"a":2}');
      expect(result.value.contentType).toBe("application/json");
    }
  });

  it("regex mode applies a global unicode ECMAScript replace with $-expansion", async () => {
    const result = await rewriteRequestBody(input('{"n":"x1","m":"x2"}'), {
      mode: "regex",
      pattern: '"x(\\d)"',
      replacement: '"y$1"',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"n":"y1","m":"y2"}',
      );
    }
  });

  it("regex replacement text is never evaluated as code ($$ escaping)", async () => {
    const result = await rewriteRequestBody(input("price 5"), {
      mode: "regex",
      pattern: "5",
      replacement: "$$5",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe("price $5");
    }
  });

  it("rejects unsupported MIME types", async () => {
    const result = await rewriteRequestBody(
      input("<xml/>", "application/xml"),
      { mode: "replace", body: "x" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "runtime.request-body-unsupported-mime-type",
      );
    }
  });

  it("rejects non-identity content-encoding", async () => {
    const result = await rewriteRequestBody(
      { ...input('{"a":1}'), contentEncoding: "gzip" },
      { mode: "replace", body: "x" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "runtime.request-body-unsupported-content-encoding",
      );
    }
  });

  it("rejects lone surrogates in the replacement text", async () => {
    const loneSurrogate = String.fromCharCode(0xd800);
    const result = await rewriteRequestBody(input('{"a":1}'), {
      mode: "regex",
      pattern: "a",
      replacement: loneSurrogate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("runtime.request-body-lone-surrogate");
    }
  });

  it("rejects an oversized policy pattern", async () => {
    const result = await rewriteRequestBody(input('{"a":1}'), {
      mode: "regex",
      pattern: "a".repeat(3000),
      replacement: "b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "runtime.request-body-regex-pattern-too-large",
      );
    }
  });

  it("enforces the 250ms regex deadline on catastrophic input", async () => {
    const big = `${"a".repeat(40)}!`;
    const start = Date.now();
    const result = await rewriteRequestBody(input(big), {
      mode: "regex",
      pattern: "(a+)+$",
      replacement: "b",
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "runtime.request-body-regex-deadline-exceeded",
      );
    }
    expect(elapsed).toBeLessThan(2000);
  });

  it("rejects output exceeding the 4 MiB limit", async () => {
    const result = await rewriteRequestBody(input("x"), {
      mode: "replace",
      body: "y".repeat(5_000_000),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("runtime.request-body-replace-too-large");
    }
  });
});
