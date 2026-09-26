import { describe, expect, it } from "vitest";
import {
  authorizeExact,
  fetchAndRewriteAuthorizedResponse,
  normalizeRuntimePreset,
  type OutboundTransport,
  rewriteResponseBody,
} from "../src/index.js";
import { RUNTIME_LIMITS } from "../src/limits.js";
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
