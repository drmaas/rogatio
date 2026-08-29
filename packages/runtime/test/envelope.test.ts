import { describe, expect, it } from "vitest";
import {
  containsBodyKey,
  EnvelopeError,
  parseEnvelope,
  serializeEnvelope,
} from "../src/envelope.js";
import { ENVELOPE_MAX_BYTES, PROTOCOL } from "../src/types.js";

describe("envelope body exclusion", () => {
  it("rejects a top-level body key", () => {
    expect(() =>
      serializeEnvelope({ type: "transform.request", metadata: { body: "x" } }),
    ).toThrow(EnvelopeError);
  });

  it("rejects a nested requestBody key at any depth", () => {
    expect(() =>
      serializeEnvelope({
        type: "transform.request",
        metadata: { a: { b: { requestBody: "x" } } },
      }),
    ).toThrow(EnvelopeError);
  });

  it("rejects a nested responseBody key", () => {
    expect(containsBodyKey({ wrapper: { responseBody: 1 } })).toBe(true);
    expect(() =>
      serializeEnvelope({
        type: "transform.request",
        metadata: { responseBody: 1 },
      }),
    ).toThrow(EnvelopeError);
  });

  it("allows metadata without body content", () => {
    expect(() =>
      serializeEnvelope({ type: "runtime.status", metadata: { ruleId: "r1" } }),
    ).not.toThrow();
  });
});

describe("mockBody confinement (spec REQ-006)", () => {
  it("allows mockBody only on the mock.response envelope", () => {
    expect(() =>
      serializeEnvelope({
        type: "mock.response",
        metadata: { status: 200, mockBody: "eA==" },
      }),
    ).not.toThrow();
  });

  it("rejects mockBody on any other envelope type", () => {
    expect(() =>
      serializeEnvelope({
        type: "runtime.status",
        metadata: { mockBody: "eA==" },
      }),
    ).toThrow(EnvelopeError);
  });

  it("round-trips a mock.response with base64 mockBody", () => {
    const json = serializeEnvelope({
      type: "mock.response",
      requestId: "r1",
      metadata: { status: 201, mockBody: "aGVsbG8=" },
    });
    const parsed = parseEnvelope(json);
    expect(parsed.type).toBe("mock.response");
    expect((parsed.metadata as { mockBody: string }).mockBody).toBe("aGVsbG8=");
  });
});

describe("envelope round-trip and determinism", () => {
  it("round-trips a parsed envelope", () => {
    const json = serializeEnvelope({
      type: "runtime.start",
      requestId: "abc",
      timestamp: 123,
      metadata: { groupId: "g1" },
    });
    const parsed = parseEnvelope(json);
    expect(parsed.protocol).toBe(PROTOCOL);
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
    const big = "x".repeat(ENVELOPE_MAX_BYTES + 10);
    expect(() =>
      serializeEnvelope({ type: "transform.result", metadata: { data: big } }),
    ).toThrow(EnvelopeError);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseEnvelope("{not json")).toThrow(EnvelopeError);
  });

  it("rejects an unknown protocol", () => {
    expect(() =>
      parseEnvelope(
        '{"protocol":"wrong","type":"runtime.status","metadata":{}}',
      ),
    ).toThrow(EnvelopeError);
  });
});
