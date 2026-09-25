import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnvelope, serializeEnvelope } from "../src/envelope.js";
import { createNativeHost } from "../src/host.js";
import { clearSession } from "../src/interception.js";
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

const bodyProject = {
  version: 1,
  name: "body",
  groups: [
    {
      id: "g1",
      name: "g",
      origins: ["http://127.0.0.1:8080"],
      rules: [
        {
          id: "r1",
          name: "resp",
          urlRegex: "^http://127\\.0\\.0\\.1:8080/data\\.json$",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "response-body",
          responseBody: {
            replacements: [{ pattern: "a", replacement: "b" }],
          },
        },
      ],
    },
  ],
};

describe("host PAC install round-trip", () => {
  afterEach(() => {
    clearSession();
  });

  it("installs PAC over host- requestId and sets activation.proxy", async () => {
    const trustRoot = mkdtempSync(join(tmpdir(), "rogatio-host-"));
    writeFileSync(join(trustRoot, ".rogatio-ca.key"), "key");
    writeFileSync(join(trustRoot, ".rogatio-ca.crt"), "cert");

    const host = createNativeHost({ trustRoot });
    const pacScripts: string[] = [];

    (
      host as unknown as {
        __setOutboundWrite: (w: (f: Uint8Array) => void) => void;
      }
    ).__setOutboundWrite((frame) => {
      const req = decodeFrame(frame);
      expect(req.requestId?.startsWith("host-")).toBe(true);
      if (req.type === "runtime.pac.install") {
        pacScripts.push(String(req.metadata.script ?? ""));
        void host.processFrame(
          encodeFrame({
            protocol: "v1",
            type: "runtime.pac.install",
            requestId: req.requestId,
            timestamp: Date.now(),
            metadata: { ok: true },
          }),
        );
      } else if (req.type === "runtime.pac.remove") {
        void host.processFrame(
          encodeFrame({
            protocol: "v1",
            type: "runtime.pac.remove",
            requestId: req.requestId,
            timestamp: Date.now(),
            metadata: { ok: true },
          }),
        );
      }
    });

    await host.start();

    const setReply = await host.processFrame(
      encodeFrame({
        protocol: "v1",
        type: "runtime.project.set",
        requestId: "1",
        timestamp: Date.now(),
        metadata: { project: bodyProject },
      }),
    );
    expect(setReply).not.toBeNull();
    if (setReply === null) throw new Error("expected project.set reply");
    expect(decodeFrame(setReply).metadata.ok).toBe(true);

    const startReply = await host.processFrame(
      encodeFrame({
        protocol: "v1",
        type: "runtime.start",
        requestId: "2",
        timestamp: Date.now(),
        metadata: {
          policyDigest: "sha256:x",
          extensionId: "ext",
          pacOrigins: ["http://127.0.0.1:8080"],
          targetPolicy: { publicAllowed: true, localOrigins: [] },
        },
      }),
    );
    expect(startReply).not.toBeNull();
    if (startReply === null) throw new Error("expected runtime.start reply");
    const started = decodeFrame(startReply);
    expect(started.metadata.ok).toBe(true);
    expect(started.metadata.interception).toEqual({
      active: true,
      reasons: [],
    });
    expect(started.metadata.proxy).toMatchObject({
      host: "127.0.0.1",
      port: expect.any(Number),
    });
    expect(pacScripts.length).toBeGreaterThanOrEqual(1);
    expect(pacScripts[0]).toContain("127.0.0.1:");
    expect(pacScripts[0]).toContain("http://127.0.0.1:8080");

    const stopReply = await host.processFrame(
      encodeFrame({
        protocol: "v1",
        type: "runtime.stop",
        requestId: "3",
        timestamp: Date.now(),
        metadata: {},
      }),
    );
    expect(stopReply).not.toBeNull();
    if (stopReply === null) throw new Error("expected runtime.stop reply");
    expect(decodeFrame(stopReply).metadata.ok).toBe(true);
    await host.stop();
  });
});
