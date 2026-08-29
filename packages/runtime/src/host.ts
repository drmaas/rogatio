import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import type { Readable, Writable } from "node:stream";
import { parseEnvelope, serializeEnvelope } from "./envelope.js";
import { createNativeRuntimeController } from "./lifecycle.js";
import type {
  Envelope,
  NormalizedRuntimePreset,
  PresetDigest,
} from "./types.js";

export interface NativeHostOptions {
  readonly preset: NormalizedRuntimePreset;
  readonly fileRoot?: string;
  /** Loopback port for the mock-body faucet (browser DNR redirect target). */
  readonly mockPort?: number;
  readonly clock?: () => number;
}

export interface NativeHostHandle {
  readonly controller: ReturnType<typeof createNativeRuntimeController>;
  /** Process one length-prefixed stdio frame and return the response frame. */
  readonly processFrame: (frame: Uint8Array) => Promise<Uint8Array | null>;
  /** Bound mock-body faucet port, or null when no faucet is configured. */
  readonly mockPort: number | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function encodeEnvelopeFrame(envelope: Envelope): Uint8Array {
  const json = new TextEncoder().encode(serializeEnvelope(envelope));
  const out = new Uint8Array(4 + json.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  return out;
}

function decodeEnvelopeFrame(buffer: Uint8Array): Envelope {
  if (buffer.byteLength < 4) throw new Error("frame too small");
  const length = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(
    0,
    true,
  );
  if (buffer.byteLength !== 4 + length)
    throw new Error("frame length mismatch");
  const json = new TextDecoder("utf-8", { fatal: true }).decode(
    buffer.slice(4),
  );
  return parseEnvelope(json);
}

/**
 * Loopback faucet that serves rendered mock bodies for browser DNR redirects
 * (spec REQ-003). The control plane stays on stdio; this is purely a bytes
 * faucet keyed by the per-rule mock token returned from `mock.connect`.
 */
function startMockFaucet(
  port: number,
  controller: ReturnType<typeof createNativeRuntimeController>,
): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "", "http://localhost");
        const match = /^\/mock\/([a-f0-9]+)$/.exec(url.pathname);
        if (!match || req.method !== "GET") {
          res.writeHead(404);
          res.end();
          return;
        }
        const result = await controller.serveMock(match[1]);
        if (!result.ok) {
          res.writeHead(404);
          res.end();
          return;
        }
        const { status, headers, bodyBytes } = result.value;
        res.writeHead(
          status,
          Object.fromEntries(
            headers.map((h: readonly [string, string]) => [h[0], h[1]]),
          ),
        );
        res.end(Buffer.from(bodyBytes));
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    })();
  });
  return new Promise<Server>((resolve) =>
    server.listen(port, () => resolve(server)),
  );
}

/**
 * Create a long-lived native-messaging host that reads envelope frames from
 * stdin and writes response frames to stdout (spec REQ-001). All pairing,
 * authorization, and mock delivery happen in this single process.
 */
export function createNativeHost(options: NativeHostOptions): NativeHostHandle {
  const controller = createNativeRuntimeController({
    preset: options.preset,
    fileRoot: options.fileRoot,
    ...(options.mockPort !== undefined ? { mockPort: options.mockPort } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });

  let faucet: Server | null = null;

  return {
    controller,
    mockPort: options.mockPort ?? null,
    async start() {
      await controller.start();
      if (options.mockPort !== undefined) {
        faucet = await startMockFaucet(options.mockPort, controller);
      }
    },
    async stop() {
      if (faucet) {
        await new Promise<void>((resolve) => faucet?.close(() => resolve()));
        faucet = null;
      }
      await controller.stop();
    },
    async processFrame(frame: Uint8Array): Promise<Uint8Array | null> {
      let envelope: Envelope;
      try {
        envelope = decodeEnvelopeFrame(frame);
      } catch {
        return null;
      }
      let response: Envelope;
      try {
        response = await controller.handleEnvelope(envelope);
      } catch {
        return null;
      }
      try {
        return encodeEnvelopeFrame(response);
      } catch {
        return null;
      }
    },
  };
}

/** Run the host against Node stdio streams (used by the `runtime-host` binary). */
export async function runNativeHost(
  options: NativeHostOptions & {
    readonly stdin?: NodeJS.ReadableStream;
    readonly stdout?: NodeJS.WritableStream;
    readonly onReady?: () => void;
  },
): Promise<void> {
  const host = createNativeHost(options);
  await host.start();
  const stdin = (options.stdin ??
    (process.stdin as unknown as Readable)) as Readable;
  const stdout = (options.stdout ??
    (process.stdout as unknown as Writable)) as Writable;
  if (options.onReady) options.onReady();

  let buffer = Buffer.alloc(0);
  stdin.on("data", (chunk: Buffer | string) => {
    buffer = Buffer.concat([
      buffer,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ]);
    void (async () => {
      for (;;) {
        if (buffer.length < 4) break;
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const frame = new Uint8Array(
          buffer.buffer,
          buffer.byteOffset + 4,
          length,
        );
        const response = await host.processFrame(frame);
        buffer = buffer.subarray(4 + length);
        if (response && stdout.writable) {
          stdout.write(Buffer.from(response));
        }
      }
    })();
  });

  await new Promise<void>((resolve) => {
    stdin.on("end", () => {
      void host.stop().then(resolve);
    });
  });
}

export type { PresetDigest };
