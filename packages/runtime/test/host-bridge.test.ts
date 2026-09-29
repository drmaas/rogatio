import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnvelope, serializeEnvelope } from "../src/envelope.js";
import { createNativeHost, runNativeHost } from "../src/host.js";
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
  version: 2,
  name: "body",
  groups: [
    {
      id: "g1",
      name: "g",
      rules: [
        {
          id: "r1",
          name: "resp",
          source: {
            key: "url",
            operator: "regex",
            value: "^http://127\\.0\\.0\\.1:8080/data\\.json$",
          },
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
          pacRoutes: ["127.0.0.1"],
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
    expect(pacScripts[0]).toContain('"127.0.0.1"');

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

  it("reads a PAC reply that arrives on stdin while runtime.start is in flight", async () => {
    const trustRoot = mkdtempSync(join(tmpdir(), "rogatio-host-stdio-"));
    writeFileSync(join(trustRoot, ".rogatio-ca.key"), "key");
    writeFileSync(join(trustRoot, ".rogatio-ca.crt"), "cert");

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const extensionReplies: Envelope[] = [];
    let pacInstalls = 0;
    let readBuffer = Buffer.alloc(0);

    const finished = runNativeHost({
      trustRoot,
      stdin,
      stdout,
    });

    try {
      stdout.on("data", (chunk: Buffer) => {
        readBuffer = Buffer.concat([readBuffer, chunk]);
        for (;;) {
          if (readBuffer.length < 4) return;
          const length = readBuffer.readUInt32LE(0);
          if (readBuffer.length < 4 + length) return;
          const frame = readBuffer.subarray(0, 4 + length);
          readBuffer = readBuffer.subarray(4 + length);
          const envelope = decodeFrame(frame);
          if (envelope.requestId?.startsWith("host-")) {
            if (envelope.type === "runtime.pac.install") pacInstalls += 1;
            const reply = Buffer.from(
              encodeFrame({
                protocol: "v1",
                type: envelope.type,
                requestId: envelope.requestId,
                timestamp: Date.now(),
                metadata: { ok: true },
              }),
            );
            // Split the reply the way the native-messaging pipe does when the
            // start frame is still unread. A correct loop consumes the start
            // frame before this reply, then dispatches the reply immediately.
            stdin.write(reply.subarray(0, 8));
            stdin.write(reply.subarray(8));
            continue;
          }
          extensionReplies.push(envelope);
        }
      });

      stdin.write(
        Buffer.from(
          encodeFrame({
            protocol: "v1",
            type: "runtime.project.set",
            requestId: "1",
            timestamp: Date.now(),
            metadata: { project: bodyProject },
          }),
        ),
      );

      await waitFor(() =>
        extensionReplies.some(
          (envelope) => envelope.type === "runtime.project.set",
        ),
      );

      stdin.write(
        Buffer.from(
          encodeFrame({
            protocol: "v1",
            type: "runtime.start",
            requestId: "2",
            timestamp: Date.now(),
            metadata: {
              policyDigest: "sha256:x",
              extensionId: "ext",
              pacRoutes: ["127.0.0.1"],
              contentListener: true,
              targetPolicy: { publicAllowed: true, localOrigins: [] },
            },
          }),
        ),
      );

      await waitFor(() =>
        extensionReplies.some((envelope) => envelope.type === "runtime.start"),
      );

      const starts = extensionReplies.filter(
        (envelope) => envelope.type === "runtime.start",
      );
      expect(starts).toHaveLength(1);
      expect(starts[0]?.metadata.ok).toBe(true);
      expect(starts[0]?.metadata.interception).toEqual({
        active: true,
        reasons: [],
      });
      expect(pacInstalls).toBe(1);

      stdin.write(
        Buffer.from(
          encodeFrame({
            protocol: "v1",
            type: "runtime.stop",
            requestId: "3",
            timestamp: Date.now(),
            metadata: {},
          }),
        ),
      );
      await waitFor(() =>
        extensionReplies.some((envelope) => envelope.type === "runtime.stop"),
      );
      stdin.end();
      await finished;
    } finally {
      if (!stdin.writableEnded) stdin.end();
      await finished;
    }
  }, 3_000);
});

function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > 2_000) {
        clearInterval(timer);
        reject(new Error("timed out waiting for host reply"));
      }
    }, 10);
  });
}
