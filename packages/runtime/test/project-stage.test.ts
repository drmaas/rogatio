import { createHash } from "node:crypto";
import { LIMITS } from "@rogatio/schema";
import { afterEach, describe, expect, it } from "vitest";
import { serializeEnvelope } from "../src/envelope.js";
import { createNativeHost } from "../src/host.js";
import { encodeNativeFrame, NativeFrameType } from "../src/native-framing.js";
import { ENVELOPE_MAX_BYTES, type EnvelopeInput } from "../src/types.js";

function encodeEnvelope(value: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  return out;
}

function decodeFrame(frame: Uint8Array): Record<string, unknown> {
  const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(
    0,
    true,
  );
  return JSON.parse(
    new TextDecoder().decode(frame.subarray(4, 4 + length)),
  ) as Record<string, unknown>;
}

describe("staged project.set for a maximum inline mock", () => {
  const hosts: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const host of hosts.splice(0)) await host.stop();
  });

  it("reaches the host through native frames and does not return the body in an envelope", async () => {
    expect(ENVELOPE_MAX_BYTES).toBe(64 * 1024);
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

    const bytes = new TextEncoder().encode(
      JSON.stringify({ protocol: "v1", ...input }),
    );
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += 24_000) {
      parts.push(bytes.subarray(offset, offset + 24_000));
    }

    const host = createNativeHost({});
    hosts.push(host);
    await host.start();

    const begun = await host.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyBegin,
        requestId: "set",
        totalBytes: bytes.byteLength,
        partCount: parts.length,
        policyDigest: digest,
      }),
    );
    expect(begun).not.toBeNull();
    if (begun === null) throw new Error("expected begin ack");
    expect(decodeFrame(begun).data).toContain('"ok":true');

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part === undefined) throw new Error("missing part");
      const accepted = await host.processFrame(
        encodeNativeFrame({
          protocol: "v1",
          type: NativeFrameType.PolicyPart,
          requestId: "set",
          index,
          data: Buffer.from(part).toString("base64"),
        }),
      );
      expect(accepted).not.toBeNull();
    }

    const committed = await host.processFrame(
      encodeNativeFrame({
        protocol: "v1",
        type: NativeFrameType.PolicyCommit,
        requestId: "set",
      }),
    );
    expect(committed).not.toBeNull();
    if (committed === null) throw new Error("expected project.set reply");
    const setReply = decodeFrame(committed);
    expect(setReply.type).toBe("runtime.project.set");
    expect(setReply.metadata).toMatchObject({ ok: true });
    expect(JSON.stringify(setReply)).not.toContain(body);

    const connect = await host.processFrame(
      encodeEnvelope({
        protocol: "v1",
        type: "mock.connect",
        requestId: "connect",
        timestamp: 2,
        metadata: {},
      }),
    );
    expect(connect).not.toBeNull();
    if (connect === null) throw new Error("expected connect");
    const token = (
      decodeFrame(connect).metadata as {
        mocks: Array<{ token: string }>;
      }
    ).mocks[0]?.token;
    expect(token).toBeTypeOf("string");

    const rendered = await host.processFrame(
      encodeEnvelope({
        protocol: "v1",
        type: "mock.request",
        requestId: "request",
        timestamp: 3,
        metadata: { token },
      }),
    );
    expect(rendered).toBeNull();
  });
});
