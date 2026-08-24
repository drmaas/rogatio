import { describe, expect, it } from "vitest";
import {
  containsBodyKey,
  F14EnvelopeError,
  parseEnvelope,
  serializeEnvelope,
} from "../src/f14-envelope.js";
import { F14_ENVELOPE_MAX_BYTES, F14_PROTOCOL } from "../src/f14-types.js";

describe("f14 envelope body exclusion", () => {
  it("rejects a top-level body key", () => {
    expect(() =>
      serializeEnvelope({ type: "transform.request", metadata: { body: "x" } }),
    ).toThrow(F14EnvelopeError);
  });

  it("rejects a nested requestBody key at any depth", () => {
    expect(() =>
      serializeEnvelope({
        type: "transform.request",
        metadata: { a: { b: { requestBody: "x" } } },
      }),
    ).toThrow(F14EnvelopeError);
  });

  it("rejects a nested responseBody key", () => {
    expect(containsBodyKey({ wrapper: { responseBody: 1 } })).toBe(true);
    expect(() =>
      serializeEnvelope({
        type: "transform.request",
        metadata: { responseBody: 1 },
      }),
    ).toThrow(F14EnvelopeError);
  });

  it("allows metadata without body content", () => {
    expect(() =>
      serializeEnvelope({ type: "runtime.status", metadata: { ruleId: "r1" } }),
    ).not.toThrow();
  });
});

describe("f14 envelope round-trip and determinism", () => {
  it("round-trips a parsed envelope", () => {
    const json = serializeEnvelope({
      type: "runtime.start",
      requestId: "abc",
      timestamp: 123,
      metadata: { groupId: "g1" },
    });
    const parsed = parseEnvelope(json);
    expect(parsed.protocol).toBe(F14_PROTOCOL);
    expect(parsed.type).toBe("runtime.start");
    expect(parsed.requestId).toBe("abc");
    expect(parsed.timestamp).toBe(123);
    expect(parsed.metadata).toEqual({ groupId: "g1" });
  });

  it("produces identical output for identical input", () => {
    const input = {
      type: "transform.result" as const,
      metadata: { ruleId: "r1", status: "ok" },
    };
    expect(serializeEnvelope(input)).toBe(serializeEnvelope(input));
  });

  it("rejects envelopes over the size limit", () => {
    const big = "x".repeat(F14_ENVELOPE_MAX_BYTES + 10);
    expect(() =>
      serializeEnvelope({ type: "transform.result", metadata: { data: big } }),
    ).toThrow(F14EnvelopeError);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseEnvelope("{not json")).toThrow(F14EnvelopeError);
  });

  it("rejects an unknown protocol", () => {
    expect(() =>
      parseEnvelope(
        '{"protocol":"wrong","type":"runtime.status","metadata":{}}',
      ),
    ).toThrow(F14EnvelopeError);
  });
});
