import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { AIProviderConfig } from "./ai-client.js";
import { parseEnvelope, serializeEnvelope } from "./envelope.js";
import {
  type InterceptProxyHandle,
  startInterceptProxy,
} from "./intercept-proxy.js";
import {
  clearSession,
  createPlatformInterceptionProvider,
  type PlatformInterceptionAdapter,
  registerInterceptionProvider,
} from "./interception.js";
import { createNativeRuntimeController } from "./lifecycle.js";
import { defaultTrustInstallRoot } from "./trust.js";
import type {
  Envelope,
  NormalizedRuntimePreset,
  PresetDigest,
} from "./types.js";

export interface NativeHostOptions {
  readonly preset?: NormalizedRuntimePreset;
  readonly fileRoot?: string;
  /** Loopback port for the mock-body faucet (browser DNR redirect target). */
  readonly mockPort?: number;
  readonly aiProviderConfig?: AIProviderConfig;
  readonly clock?: () => number;
  /** Override CA material root used by provisionOrVerifyCa (tests). */
  readonly trustRoot?: string;
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

function defaultTrustRoot(): string {
  return defaultTrustInstallRoot(process.platform);
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
    ...(options.aiProviderConfig !== undefined
      ? { aiProviderConfig: options.aiProviderConfig }
      : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });

  let faucet: Server | null = null;
  let interceptProxy: InterceptProxyHandle | null = null;
  let outboundWrite: ((frame: Uint8Array) => void) | null = null;
  let hostRequestCounter = 0;
  const pendingHost = new Map<
    string,
    {
      resolve: (envelope: Envelope) => void;
      reject: (error: Error) => void;
    }
  >();

  function sendHostRequest(
    type: "runtime.pac.install" | "runtime.pac.remove",
    metadata: Record<string, unknown>,
  ): Promise<Envelope> {
    const requestId = `host-${++hostRequestCounter}`;
    const envelope: Envelope = {
      protocol: "v1",
      type,
      requestId,
      timestamp: Date.now(),
      metadata,
    };
    return new Promise<Envelope>((resolve, reject) => {
      if (!outboundWrite) {
        reject(new Error("host stdout not attached"));
        return;
      }
      pendingHost.set(requestId, { resolve, reject });
      try {
        outboundWrite(encodeEnvelopeFrame(envelope));
      } catch (error) {
        pendingHost.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      setTimeout(() => {
        if (pendingHost.has(requestId)) {
          pendingHost.delete(requestId);
          reject(new Error("host pac request timed out"));
        }
      }, 10_000);
    });
  }

  const trustRoot = options.trustRoot ?? defaultTrustRoot();
  const caKeyFile = join(trustRoot, ".rogatio-ca.key");
  const caCertFile = join(trustRoot, ".rogatio-ca.crt");

  const platformAdapter: PlatformInterceptionAdapter = {
    platform: process.platform,
    detect() {
      const trusted = existsSync(caKeyFile) && existsSync(caCertFile);
      return {
        supported: true,
        reasons: [],
        trustedDeviceLocalCa: trusted,
        controllingProxy: false,
        controllingPac: false,
        controllingExtension: false,
        enterprisePolicy: false,
      };
    },
    async provisionOrVerifyCa() {
      return existsSync(caKeyFile) && existsSync(caCertFile);
    },
    async installPac(script: string) {
      const response = await sendHostRequest("runtime.pac.install", {
        script,
      });
      if (response.metadata.ok !== true) {
        const error =
          typeof response.metadata.error === "string"
            ? response.metadata.error
            : "pac-install-failed";
        throw new Error(error);
      }
    },
    async removePac() {
      try {
        await sendHostRequest("runtime.pac.remove", {});
      } catch {
        // Best-effort clear.
      }
    },
    async startTlsProxy() {
      if (interceptProxy) {
        await interceptProxy.stop();
        interceptProxy = null;
      }
      const policy = controller.getActivePolicy();
      interceptProxy = await startInterceptProxy({
        policy: policy
          ? { project: policy.project, operations: policy.operations }
          : null,
      });
      return interceptProxy.endpoint;
    },
    async stopTlsProxy() {
      if (interceptProxy) {
        await interceptProxy.stop();
        interceptProxy = null;
      }
    },
  };

  const platformProvider = createPlatformInterceptionProvider(platformAdapter);

  // Session-scoped InterceptionProvider closes over pacOrigins from the
  // activation/session start path via PlatformInterceptionProvider.start.
  // startInterception calls provider.start(activation); we wrap so origins
  // come from the SessionProvider registration arguments stored on activation.
  let pendingOrigins: readonly string[] = [];
  registerInterceptionProvider({
    platform: platformProvider.platform,
    detect: () => platformProvider.detect(),
    async start(activation) {
      const origins =
        pendingOrigins.length > 0 ? pendingOrigins : activation.pacOrigins;
      const endpoint = await platformProvider.start(activation, origins);
      const policy = controller.getActivePolicy();
      interceptProxy?.setPolicy(
        policy
          ? { project: policy.project, operations: policy.operations }
          : null,
      );
      return endpoint;
    },
    async stop() {
      await platformProvider.stop();
    },
  });

  // Hook startInterception pacOrigins: lifecycle passes them into
  // startInterception which does not forward to provider.start. Capture via
  // a thin monkey-patch on register... Actually lifecycle calls
  // startInterception(..., pacOrigins, ...) and provider.start(activation)
  // only. Plan prefers host wrapper closing over pacOrigins — set pending
  // origins before start by wrapping getCurrentSession path.
  //
  // The lifecycle stores pacOrigins on activation when provided in
  // sessionConfig (activation.pacOrigins). Use that.
  // Override: patch pendingOrigins from activation.pacOrigins in wrapper above.

  const handle: NativeHostHandle = {
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
      clearSession();
      if (interceptProxy) {
        await interceptProxy.stop();
        interceptProxy = null;
      }
    },
    async processFrame(frame: Uint8Array): Promise<Uint8Array | null> {
      let envelope: Envelope;
      try {
        envelope = decodeEnvelopeFrame(frame);
      } catch (error) {
        console.error(
          "[rogatio-host] decodeEnvelopeFrame failed:",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }

      // Host-initiated PAC responses resolve the pending map; no reply.
      if (
        typeof envelope.requestId === "string" &&
        envelope.requestId.startsWith("host-")
      ) {
        const pending = pendingHost.get(envelope.requestId);
        if (pending) {
          pendingHost.delete(envelope.requestId);
          pending.resolve(envelope);
          return null;
        }
      }

      // Capture pacOrigins before controller binds interception.
      if (envelope.type === "runtime.start") {
        const origins = envelope.metadata.pacOrigins;
        pendingOrigins = Array.isArray(origins)
          ? origins.filter((o): o is string => typeof o === "string")
          : [];
      }

      console.error(
        "[rogatio-host] received envelope:",
        envelope.type,
        "requestId:",
        envelope.requestId,
      );
      let response: Envelope;
      try {
        response = await controller.handleEnvelope(envelope);
      } catch (error) {
        console.error(
          "[rogatio-host] handleEnvelope failed:",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
      try {
        return encodeEnvelopeFrame(response);
      } catch {
        return null;
      }
    },
  };

  // Attachable write hook used by runNativeHost / tests.
  Object.defineProperty(handle, "__setOutboundWrite", {
    value(write: (frame: Uint8Array) => void) {
      outboundWrite = write;
    },
    enumerable: false,
  });

  return handle;
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
  const setOutbound = (
    host as unknown as {
      __setOutboundWrite?: (write: (frame: Uint8Array) => void) => void;
    }
  ).__setOutboundWrite;
  const stdout = (options.stdout ??
    (process.stdout as unknown as Writable)) as Writable;
  if (setOutbound) {
    setOutbound((frame) => {
      if (stdout.writable) stdout.write(Buffer.from(frame));
    });
  }
  await host.start();
  const stdin = (options.stdin ??
    (process.stdin as unknown as Readable)) as Readable;
  if (options.onReady) options.onReady();

  let buffer = Buffer.alloc(0);
  stdin.on("data", (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk)
      ? Buffer.from(chunk)
      : Buffer.from(chunk);
    console.error(
      "[rogatio-host] stdin data:",
      buf.length,
      "bytes, buffer:",
      buffer.length,
    );
    buffer = Buffer.concat([buffer, buf]);
    void (async () => {
      for (;;) {
        if (buffer.length < 4) break;
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const frame = new Uint8Array(
          buffer.buffer,
          buffer.byteOffset,
          4 + length,
        );
        console.error("[rogatio-host] processing frame:", 4 + length, "bytes");
        const response = await host.processFrame(frame);
        buffer = buffer.subarray(4 + length);
        if (response && stdout.writable) {
          console.error(
            "[rogatio-host] writing response:",
            response.length,
            "bytes",
          );
          stdout.write(Buffer.from(response));
        } else {
          console.error("[rogatio-host] no response to write");
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
