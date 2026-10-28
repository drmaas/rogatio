import { createHash } from "node:crypto";
import { LIMITS } from "@rogatio/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeEnvelope } from "../src/envelope.js";
import { createNativeHost } from "../src/host.js";
import {
  decodeNativeFrame,
  encodeNativeFrame,
  NATIVE_FRAME_MAX_BYTES,
  NATIVE_POLICY_STAGE_TIMEOUT_MS,
  NativeFrameType,
  readNativePayloadLength,
} from "../src/native-framing.js";
import type { EnvelopeInput } from "../src/types.js";

function encodeEnvelope(value: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  return out;
}

function encodeRawLengthPrefixed(json: string): Uint8Array {
  const bytes = new TextEncoder().encode(json);
  const out = new Uint8Array(4 + bytes.byteLength);
  new DataView(out.buffer).setUint32(0, bytes.byteLength, true);
  out.set(bytes, 4);
  return out;
}

function decodeFrameData(frame: Uint8Array): Record<string, unknown> {
  const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(
    0,
    true,
  );
  return JSON.parse(
    new TextDecoder().decode(frame.subarray(4, 4 + length)),
  ) as Record<string, unknown>;
}

function smallProjectEnvelope(requestId = "set"): Uint8Array {
  return encodeEnvelope({
    protocol: "v1",
    type: "runtime.project.set",
    requestId,
    timestamp: 1,
    metadata: {
      project: {
        version: 2,
        name: "tiny",
        groups: [
          {
            id: "g1",
            name: "G",
            rules: [
              {
                id: "r1",
                name: "Mock",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/",
                },
                resourceTypes: ["main_frame"],
                priority: 1,
                type: "mock",
                mock: { status: 200, body: "ok" },
              },
            ],
          },
        ],
      },
    },
  });
}

function stageProjectBytes(requestId = "set"): {
  bytes: Uint8Array;
  digest: string;
  parts: Uint8Array[];
} {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      protocol: "v1",
      type: "runtime.project.set",
      requestId,
      timestamp: 1,
      metadata: {
        project: {
          version: 2,
          name: "tiny",
          groups: [
            {
              id: "g1",
              name: "G",
              rules: [
                {
                  id: "r1",
                  name: "Mock",
                  source: {
                    key: "url",
                    operator: "regex",
                    value: "^https://example\\.com/",
                  },
                  resourceTypes: ["main_frame"],
                  priority: 1,
                  type: "mock",
                  mock: { status: 200, body: "ok" },
                },
              ],
            },
          ],
        },
      },
    }),
  );
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 24) {
    parts.push(bytes.subarray(offset, offset + 24));
  }
  return { bytes, digest, parts };
}

function stageAckError(frame: Uint8Array): string {
  const data = JSON.parse(String(decodeFrameData(frame).data)) as {
    error?: string;
  };
  if (typeof data.error !== "string") {
    throw new Error("expected staged error code");
  }
  return data.error;
}

function frameErrorCode(buffer: Uint8Array): string {
  const result = decodeNativeFrame(buffer);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected frame decode failure");
  return result.error.code;
}

describe("native frame reader", () => {
  it("rejects a declared length above 64 KiB before the payload is complete", () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(NATIVE_FRAME_MAX_BYTES + 1, 0);
    const result = readNativePayloadLength(header);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("runtime.native-frame-too-large");
  });

  it("maps length mismatch, short buffer, bad protocol, and invalid JSON to stable codes", () => {
    expect(frameErrorCode(new Uint8Array(3))).toBe(
      "runtime.native-frame-too-small",
    );
    const oversizeHeader = new Uint8Array(8);
    new DataView(oversizeHeader.buffer).setUint32(
      0,
      NATIVE_FRAME_MAX_BYTES + 1,
      true,
    );
    expect(frameErrorCode(oversizeHeader)).toBe(
      "runtime.native-frame-too-large",
    );
    const short = encodeRawLengthPrefixed('{"protocol":"v1"}').slice(0, 6);
    expect(frameErrorCode(short)).toBe("runtime.native-frame-length-mismatch");
    const badProtocol = encodeRawLengthPrefixed('{"protocol":"v2","type":"x"}');
    expect(frameErrorCode(badProtocol)).toBe(
      "runtime.native-frame-invalid-protocol",
    );
    const badJson = encodeRawLengthPrefixed("{not json");
    expect(frameErrorCode(badJson)).toBe("runtime.native-frame-invalid-json");
    const badUtf8 = new Uint8Array(5);
    new DataView(badUtf8.buffer).setUint32(0, 1, true);
    badUtf8[4] = 0xff;
    expect(frameErrorCode(badUtf8)).toBe("runtime.native-frame-invalid-json");
  });
});

describe("native host framing", () => {
  const hosts: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    vi.useRealTimers();
    for (const host of hosts.splice(0)) await host.stop();
  });

  it("rejects a single-frame runtime.project.set larger than 64 KiB without ok: true", async () => {
    const body = "a".repeat(LIMITS.maxMockInlineBodyLength);
    const input: EnvelopeInput = {
      type: "runtime.project.set",
      requestId: "set",
      timestamp: 1,
      metadata: {
        project: {
          version: 2,
          name: "large",
          groups: [
            {
              id: "g1",
              name: "G",
              rules: [
                {
                  id: "r1",
                  name: "Mock",
                  source: {
                    key: "url",
                    operator: "regex",
                    value: "^https://example\\.com/",
                  },
                  resourceTypes: ["main_frame"],
                  priority: 1,
                  type: "mock",
                  mock: { status: 200, body },
                },
              ],
            },
          ],
        },
      },
    };
    expect(() => serializeEnvelope(input)).toThrow(/maximum size/);
    const oversized = encodeEnvelope({ protocol: "v1", ...input });
    expect(oversized.byteLength).toBeGreaterThan(NATIVE_FRAME_MAX_BYTES + 4);

    const host = createNativeHost({});
    hosts.push(host);
    await host.start();

    const reply = await host.processFrame(oversized);
    expect(reply).toBeNull();

    const small = await host.processFrame(smallProjectEnvelope("after"));
    expect(small).not.toBeNull();
    if (small === null) throw new Error("expected small project.set reply");
    expect(decodeFrameData(small).metadata).toMatchObject({ ok: true });
  });

  it("returns no response for invalid non-staging frames", async () => {
    const host = createNativeHost({});
    hosts.push(host);
    await host.start();
    const badProtocol = encodeRawLengthPrefixed('{"protocol":"v2","type":"x"}');
    expect(await host.processFrame(badProtocol)).toBeNull();
    const badJson = encodeRawLengthPrefixed("{not json");
    expect(await host.processFrame(badJson)).toBeNull();
  });

  async function runStage(
    host: ReturnType<typeof createNativeHost>,
    requestId: string,
    parts: Uint8Array[],
    digest: string,
    partOrder?: number[],
  ): Promise<void> {
    const begun = await host.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyBegin,
        requestId,
        totalBytes: parts.reduce((n, p) => n + p.byteLength, 0),
        partCount: parts.length,
        policyDigest: digest,
      }),
    );
    expect(begun).not.toBeNull();
    const order = partOrder ?? parts.map((_, index) => index);
    for (const index of order) {
      const part = parts[index];
      if (part === undefined) throw new Error("missing part");
      const accepted = await host.processFrame(
        encodeNativeFrame({
          protocol: "v1",
          type: NativeFrameType.PolicyPart,
          requestId,
          index,
          data: Buffer.from(part).toString("base64"),
        }),
      );
      expect(accepted).not.toBeNull();
      if (accepted === null) throw new Error("expected part ack");
      expect(decodeFrameData(accepted).data).toContain('"ok":true');
    }
  }

  it("installs a staged runtime.project.set and omits mock body from the reply", async () => {
    const { parts, digest } = stageProjectBytes("good");
    const host = createNativeHost({});
    hosts.push(host);
    await host.start();
    await runStage(host, "good", parts, digest);

    const committed = await host.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "good",
      }),
    );
    expect(committed).not.toBeNull();
    if (committed === null) throw new Error("expected commit reply");
    const setReply = decodeFrameData(committed);
    expect(setReply.type).toBe("runtime.project.set");
    expect(setReply.metadata).toMatchObject({ ok: true });
    expect(JSON.stringify(setReply)).not.toContain("mock body");
  });

  it("accepts out-of-order part indices and assembles by index", async () => {
    const { parts, digest } = stageProjectBytes("reorder");
    if (parts.length < 2) {
      expect(parts.length).toBeGreaterThan(1);
      return;
    }
    const host = createNativeHost({});
    hosts.push(host);
    await host.start();
    await runStage(host, "reorder", parts, digest, [
      parts.length - 1,
      0,
      ...parts.map((_, index) => index).slice(1, parts.length - 1),
    ]);
    const committed = await host.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "reorder",
      }),
    );
    expect(committed).not.toBeNull();
    if (committed === null) throw new Error("expected commit reply");
    expect(decodeFrameData(committed).metadata).toMatchObject({ ok: true });
  });

  it("reports staging failures and leaves no active staged project", async () => {
    const { parts, digest, bytes } = stageProjectBytes("fail");
    const wrongDigest = `sha256:${"0".repeat(64)}`;

    const hostDup = createNativeHost({});
    hosts.push(hostDup);
    await hostDup.start();
    await runStage(hostDup, "dup", parts, digest);
    const dupPart = await hostDup.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyPart,
        requestId: "dup",
        index: 0,
        data: Buffer.from(parts[0] ?? new Uint8Array()).toString("base64"),
      }),
    );
    expect(dupPart).not.toBeNull();
    if (dupPart === null) throw new Error("expected dup ack");
    expect(stageAckError(dupPart)).toBe(
      "runtime.request-body-policy-duplicate-part",
    );
    const dupCommit = await hostDup.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "dup",
      }),
    );
    expect(dupCommit).not.toBeNull();
    if (dupCommit === null) throw new Error("expected dup commit ack");
    expect(stageAckError(dupCommit)).toBe("runtime.project-stage-invalid");

    await hostDup.stop();
    const hostRange = createNativeHost({});
    hosts.push(hostRange);
    await hostRange.start();
    const begun = await hostRange.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyBegin,
        requestId: "range",
        totalBytes: bytes.byteLength,
        partCount: parts.length,
        policyDigest: digest,
      }),
    );
    expect(begun).not.toBeNull();
    const badIndex = await hostRange.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyPart,
        requestId: "range",
        index: parts.length + 1,
        data: Buffer.from(parts[0] ?? new Uint8Array()).toString("base64"),
      }),
    );
    expect(badIndex).not.toBeNull();
    if (badIndex === null) throw new Error("expected range ack");
    expect(stageAckError(badIndex)).toBe(
      "runtime.request-body-policy-invalid-part-index",
    );

    await hostRange.stop();
    const hostBytes = createNativeHost({});
    hosts.push(hostBytes);
    await hostBytes.start();
    await hostBytes.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyBegin,
        requestId: "bytes",
        totalBytes: bytes.byteLength + 1,
        partCount: parts.length,
        policyDigest: digest,
      }),
    );
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part === undefined) throw new Error("missing part");
      await hostBytes.processFrame(
        encodeNativeFrame({
          protocol: "v1",
          type: NativeFrameType.PolicyPart,
          requestId: "bytes",
          index,
          data: Buffer.from(part).toString("base64"),
        }),
      );
    }
    const byteMismatch = await hostBytes.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "bytes",
      }),
    );
    expect(byteMismatch).not.toBeNull();
    if (byteMismatch === null) throw new Error("expected byte mismatch ack");
    expect(stageAckError(byteMismatch)).toBe(
      "runtime.request-body-policy-byte-count-mismatch",
    );

    await hostBytes.stop();
    const hostIncomplete = createNativeHost({});
    hosts.push(hostIncomplete);
    await hostIncomplete.start();
    await hostIncomplete.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyBegin,
        requestId: "inc",
        totalBytes: bytes.byteLength,
        partCount: parts.length,
        policyDigest: digest,
      }),
    );
    const incomplete = await hostIncomplete.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "inc",
      }),
    );
    expect(incomplete).not.toBeNull();
    if (incomplete === null) throw new Error("expected incomplete ack");
    expect(stageAckError(incomplete)).toBe(
      "runtime.request-body-policy-incomplete",
    );

    await hostIncomplete.stop();
    const hostDigest = createNativeHost({});
    hosts.push(hostDigest);
    await hostDigest.start();
    await runStage(hostDigest, "digest", parts, wrongDigest);
    const digestBad = await hostDigest.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "digest",
      }),
    );
    expect(digestBad).not.toBeNull();
    if (digestBad === null) throw new Error("expected digest ack");
    expect(stageAckError(digestBad)).toBe("runtime.project-stage-invalid");

    await hostDigest.stop();
    const hostEarly = createNativeHost({});
    hosts.push(hostEarly);
    await hostEarly.start();
    const earlyPart = await hostEarly.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyPart,
        requestId: "early",
        index: 0,
        data: Buffer.from(parts[0] ?? new Uint8Array()).toString("base64"),
      }),
    );
    expect(earlyPart).not.toBeNull();
    if (earlyPart === null) throw new Error("expected early ack");
    expect(stageAckError(earlyPart)).toBe("runtime.project-stage-invalid");

    await hostEarly.stop();
    vi.useFakeTimers();
    const hostTimeout = createNativeHost({});
    hosts.push(hostTimeout);
    await hostTimeout.start();
    await hostTimeout.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyBegin,
        requestId: "timeout",
        totalBytes: bytes.byteLength,
        partCount: parts.length,
        policyDigest: digest,
      }),
    );
    vi.advanceTimersByTime(NATIVE_POLICY_STAGE_TIMEOUT_MS + 1);
    const timedOut = await hostTimeout.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyPart,
        requestId: "timeout",
        index: 0,
        data: Buffer.from(parts[0] ?? new Uint8Array()).toString("base64"),
      }),
    );
    expect(timedOut).not.toBeNull();
    if (timedOut === null) throw new Error("expected timeout ack");
    expect(stageAckError(timedOut)).toBe(
      "runtime.request-body-policy-stage-timeout",
    );

    await hostTimeout.stop();
    vi.useFakeTimers();
    const hostLateCommit = createNativeHost({});
    hosts.push(hostLateCommit);
    await hostLateCommit.start();
    await runStage(hostLateCommit, "late", parts, digest);
    vi.advanceTimersByTime(NATIVE_POLICY_STAGE_TIMEOUT_MS + 1);
    const lateCommit = await hostLateCommit.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "late",
      }),
    );
    expect(lateCommit).not.toBeNull();
    if (lateCommit === null) throw new Error("expected late commit ack");
    expect(stageAckError(lateCommit)).toBe(
      "runtime.request-body-policy-stage-timeout",
    );
    const inlineSet = await hostLateCommit.processFrame(
      smallProjectEnvelope("inline-after-timeout"),
    );
    expect(inlineSet).not.toBeNull();
    if (inlineSet === null) throw new Error("expected inline project.set");
    expect(decodeFrameData(inlineSet).metadata).toMatchObject({ ok: true });
  });
});
