import { describe, expect, it } from "vitest";
import type { DoctorReport } from "../src/doctor.js";
import { parseEnvelope, serializeEnvelope } from "../src/envelope.js";
import { createNativeHost } from "../src/host.js";
import type { Envelope } from "../src/types.js";

function encodeFrame(envelope: Envelope): Uint8Array {
  const json = new TextEncoder().encode(serializeEnvelope(envelope));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  return out;
}

function decodeFrame(frame: Uint8Array): Envelope {
  const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(
    0,
    true,
  );
  return parseEnvelope(new TextDecoder().decode(frame.slice(4, 4 + length)));
}

const report: DoctorReport = {
  version: 1,
  ok: true,
  exitCode: 0,
  checks: [
    {
      id: "node",
      status: "pass",
      optional: false,
      summary: "Node 26.11.1, CLI 1.2.3.",
      fix: null,
    },
    {
      id: "project",
      status: "pass",
      optional: false,
      summary: "Active project is valid.",
      fix: null,
    },
    {
      id: "host",
      status: "pass",
      optional: false,
      summary:
        "allowed_origins includes chrome-extension://dkngkciiiabbdjcopbipkpndfmpbmjom/",
      fix: null,
    },
    {
      id: "ca",
      status: "pass",
      optional: false,
      summary: "Device CA is present and trusted.",
      fix: null,
    },
    {
      id: "pac",
      status: "pass",
      optional: false,
      summary: "Runtime answered a PAC request.",
      fix: null,
    },
    {
      id: "ai",
      status: "warn",
      optional: true,
      summary: "Optional. No AI provider is configured.",
      fix: "rogatio ai setup",
    },
  ],
};

describe("runtime.doctor envelope", () => {
  it("returns the shared report and does not echo the project", async () => {
    const host = createNativeHost({
      cliVersion: "1.2.3",
      runDoctor: async () => report,
    });
    const frame = await host.processFrame(
      encodeFrame({
        protocol: "v1",
        type: "runtime.doctor",
        requestId: "doctor-1",
        timestamp: 1,
        metadata: {
          project: { version: 2, name: "n", groups: [], body: "secret-body" },
        },
      }),
    );
    expect(frame).not.toBeNull();
    if (frame === null) throw new Error("expected a doctor reply");
    const reply = decodeFrame(frame);
    expect(reply.type).toBe("runtime.doctor");
    expect(reply.requestId).toBe("doctor-1");
    expect(reply.metadata.report).toEqual(report);
    expect(JSON.stringify(reply.metadata)).not.toContain("secret-body");
  });

  it("allows a project body on the doctor request", () => {
    expect(() =>
      serializeEnvelope({
        type: "runtime.doctor",
        metadata: { project: { body: "authored" } },
      }),
    ).not.toThrow();
  });
});
