import { describe, expect, it } from "vitest";
import {
  authorizeExact,
  fetchAndRewriteAuthorizedResponse,
  normalizeRuntimePreset,
  type OutboundTransport,
  rewriteResponseBody,
} from "../src/index.js";
import { RUNTIME_LIMITS } from "../src/limits.js";
import {
  __failNextRegexWorkerBootForTests,
  __resetRegexWorkerForTests,
} from "../src/regex-replace.js";
import { makeGrant, makePresetInput } from "./helpers.js";

describe(" response-body transformation", () => {
  it("applies replacements globally and in order", async () => {
    const result = await rewriteResponseBody(
      {
        contentType: "application/json",
        body: new TextEncoder().encode('{"value":"old"}'),
      },
      [
        { pattern: "old", replacement: "new" },
        { pattern: "new", replacement: "final" },
      ],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"value":"final"}',
      );
    }
  });

  it("rejects binary and unsupported content", async () => {
    const result = await rewriteResponseBody(
      { contentType: "image/png", body: new Uint8Array([0, 1]) },
      [],
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid UTF-8", async () => {
    const result = await rewriteResponseBody(
      { contentType: "text/plain", body: new Uint8Array([0xc3, 0x28]) },
      [{ pattern: "x", replacement: "y" }],
    );
    expect(result.ok).toBe(false);
  });

  it("produces the same output as a direct global unicode replace", async () => {
    const source = '{"n":"x1","m":"x2","price":"5"}';
    const replacements = [
      { pattern: "x(\\d)", replacement: "y$1" },
      { pattern: "5", replacement: "$$5" },
    ];
    let expected = source;
    for (const entry of replacements) {
      expected = expected.replace(
        new RegExp(entry.pattern, "gu"),
        entry.replacement,
      );
    }
    const result = await rewriteResponseBody(
      {
        contentType: "application/json",
        body: new TextEncoder().encode(source),
      },
      replacements,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe(expected);
    }
  });

  it("rejects an invalid pattern with the canonical-value error", async () => {
    const result = await rewriteResponseBody(
      {
        contentType: "text/plain",
        body: new TextEncoder().encode("hello"),
      },
      [{ pattern: "(", replacement: "x" }],
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.invalid-canonical-value" },
    });
  });

  it("returns within the regex deadline and fails closed", async () => {
    const warmup = await rewriteResponseBody(
      {
        contentType: "text/plain",
        body: new TextEncoder().encode("ab"),
      },
      [{ pattern: "a", replacement: "b" }],
    );
    expect(warmup.ok).toBe(true);

    const body = `${"a".repeat(28)}!`;
    const start = Date.now();
    const result = await rewriteResponseBody(
      {
        contentType: "text/plain",
        body: new TextEncoder().encode(body),
      },
      [{ pattern: "(a+)+$", replacement: "b" }],
    );
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.invalid-canonical-value" },
    });

    const after = await rewriteResponseBody(
      {
        contentType: "text/plain",
        body: new TextEncoder().encode("hello"),
      },
      [{ pattern: "h", replacement: "j" }],
    );
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(new TextDecoder().decode(after.value.body)).toBe("jello");
    }
  });

  it("fails closed promptly when the worker fails to boot", async () => {
    __failNextRegexWorkerBootForTests();
    try {
      const start = Date.now();
      const result = await rewriteResponseBody(
        {
          contentType: "text/plain",
          body: new TextEncoder().encode(`${"a".repeat(30)}!`),
        },
        [{ pattern: "(a+)+$", replacement: "b" }],
      );
      expect(Date.now() - start).toBeLessThan(1000);
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.invalid-canonical-value" },
      });
    } finally {
      __resetRegexWorkerForTests();
    }
  });

  it("fetches only an authorized GET and rewrites the response in-process", async () => {
    const normalized = normalizeRuntimePreset(
      makePresetInput({ grants: [makeGrant()] }),
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const authorized = authorizeExact(
      normalized.value,
      makeGrant(),
      "https://example.com/page",
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const transport: OutboundTransport = {
      async request() {
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: (async function* () {
            yield new TextEncoder().encode('{"value":"old"}');
          })(),
        };
      },
    };
    const result = await fetchAndRewriteAuthorizedResponse(
      authorized.value,
      { replacements: [{ pattern: "old", replacement: "new" }] },
      {
        resolver: {
          async lookup() {
            return [{ address: "93.184.216.34", family: 4 }];
          },
        },
        transport,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(200);
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"value":"new"}',
      );
    }
  });

  it("tagged regex mode still rewrites the fetched body", async () => {
    const normalized = normalizeRuntimePreset(
      makePresetInput({ grants: [makeGrant()] }),
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const authorized = authorizeExact(
      normalized.value,
      makeGrant(),
      "https://example.com/page",
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const transport: OutboundTransport = {
      async request() {
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: (async function* () {
            yield new TextEncoder().encode('{"value":"old"}');
          })(),
        };
      },
    };
    const result = await fetchAndRewriteAuthorizedResponse(
      authorized.value,
      {
        mode: "regex",
        replacements: [{ pattern: "old", replacement: "new" }],
      },
      {
        resolver: {
          async lookup() {
            return [{ address: "93.184.216.34", family: 4 }];
          },
        },
        transport,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"value":"new"}',
      );
    }
  });

  it("replace mode returns configured body after fetch and preserves status/headers", async () => {
    const normalized = normalizeRuntimePreset(
      makePresetInput({ grants: [makeGrant()] }),
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const authorized = authorizeExact(
      normalized.value,
      makeGrant(),
      "https://example.com/page",
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const transport: OutboundTransport = {
      async request() {
        return {
          status: 418,
          headers: [
            ["content-type", "image/png"],
            ["x-upstream", "seen"],
          ],
          body: (async function* () {
            yield new TextEncoder().encode("ignored upstream bytes");
          })(),
        };
      },
    };
    const result = await fetchAndRewriteAuthorizedResponse(
      authorized.value,
      { mode: "replace", body: '{"replaced":true}' },
      {
        resolver: {
          async lookup() {
            return [{ address: "93.184.216.34", family: 4 }];
          },
        },
        transport,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(418);
      expect(result.value.headers).toEqual([
        ["content-type", "image/png"],
        ["x-upstream", "seen"],
      ]);
      expect(new TextDecoder().decode(result.value.body)).toBe(
        '{"replaced":true}',
      );
    }
  });

  it("replace mode rejects authored body over maxResponseBodyBytes", async () => {
    const normalized = normalizeRuntimePreset(
      makePresetInput({ grants: [makeGrant()] }),
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const authorized = authorizeExact(
      normalized.value,
      makeGrant(),
      "https://example.com/page",
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    const transport: OutboundTransport = {
      async request() {
        return {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: (async function* () {
            yield new TextEncoder().encode("{}");
          })(),
        };
      },
    };
    const body = "x".repeat(RUNTIME_LIMITS.maxResponseBodyBytes + 1);
    const result = await fetchAndRewriteAuthorizedResponse(
      authorized.value,
      { mode: "replace", body },
      {
        resolver: {
          async lookup() {
            return [{ address: "93.184.216.34", family: 4 }];
          },
        },
        transport,
      },
    );

    expect(result.ok).toBe(false);
  });
});
