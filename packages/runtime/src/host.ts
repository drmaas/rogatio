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
import {
  decodeNativeFrame,
  encodeNativeFrame,
  type NativeFrame,
  NativeFrameType,
  type PolicyStageState,
} from "./native-framing.js";
import {
  acceptProjectPart,
  beginProjectStage,
  finishProjectStage,
  isProjectStageType,
} from "./project-stage.js";
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
  /**
   * Reader used to re-read the AI provider config while the host runs, so
   * `rogatio ai setup` takes effect without a host restart (spec REQ-003).
   */
  readonly aiConfigReader?: () => Promise<AIProviderConfig | null>;
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

function stageAck(
  type: NativeFrameType,
  requestId: string | undefined,
  ok: boolean,
  error?: string,
): Uint8Array {
  return encodeNativeFrame({
    protocol: "v1",
    type,
    ...(requestId !== undefined ? { requestId } : {}),
    data: JSON.stringify({
      ok,
      ...(error !== undefined ? { error } : {}),
    }),
  });
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
    ...(options.aiConfigReader !== undefined
      ? { aiConfigReader: options.aiConfigReader }
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
          ? {
              project: policy.project,
              operations: policy.operations,
              presetDigest: policy.presetDigest,
            }
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

  // Session-scoped InterceptionProvider closes over pacRoutes from the
  // activation/session start path via PlatformInterceptionProvider.start.
  // startInterception calls provider.start(activation); we wrap so routes
  // come from the SessionProvider registration arguments stored on activation.
  let pendingRoutes: readonly string[] = [];
  registerInterceptionProvider({
    platform: platformProvider.platform,
    detect: () => platformProvider.detect(),
    async start(activation) {
      const routes =
        pendingRoutes.length > 0 ? pendingRoutes : activation.pacRoutes;
      const endpoint = await platformProvider.start(activation, routes);
      const policy = controller.getActivePolicy();
      interceptProxy?.setPolicy(
        policy
          ? {
              project: policy.project,
              operations: policy.operations,
              presetDigest: policy.presetDigest,
            }
          : null,
      );
      return endpoint;
    },
    async stop() {
      await platformProvider.stop();
    },
  });

  // Hook startInterception pacRoutes: lifecycle passes them into
  // startInterception which does not forward to provider.start. Capture via
  // pendingRoutes before start by wrapping getCurrentSession path.
  //
  // The lifecycle stores pacRoutes on activation when provided in
  // sessionConfig (activation.pacRoutes). Use that.

  let projectStage: PolicyStageState | undefined;

  async function handleProjectStage(
    frame: NativeFrame,
  ): Promise<Uint8Array | null> {
    const requestId = frame.requestId;
    if (frame.type === NativeFrameType.PolicyBegin) {
      const begun = beginProjectStage(frame);
      if (!begun.ok) {
        projectStage = undefined;
        return stageAck(
          NativeFrameType.PolicyBegin,
          requestId,
          false,
          begun.error.code,
        );
      }
      projectStage = begun.value;
      return stageAck(NativeFrameType.PolicyBegin, requestId, true);
    }
    if (frame.type === NativeFrameType.PolicyPart) {
      if (projectStage === undefined) {
        return stageAck(
          NativeFrameType.PolicyPart,
          requestId,
          false,
          "runtime.project-stage-invalid",
        );
      }
      const accepted = acceptProjectPart(projectStage, frame);
      if (!accepted.ok) {
        projectStage = undefined;
        return stageAck(
          NativeFrameType.PolicyPart,
          requestId,
          false,
          accepted.error.code,
        );
      }
      return stageAck(NativeFrameType.PolicyPart, requestId, true);
    }
    if (projectStage === undefined) {
      return stageAck(
        NativeFrameType.PolicyCommit,
        requestId,
        false,
        "runtime.project-stage-invalid",
      );
    }
    const finished = finishProjectStage(projectStage);
    projectStage = undefined;
    if (!finished.ok) {
      return stageAck(
        NativeFrameType.PolicyCommit,
        requestId,
        false,
        finished.error.code,
      );
    }
    try {
      const json = new TextDecoder("utf-8", { fatal: true }).decode(
        finished.value,
      );
      const envelope = parseEnvelope(json);
      if (envelope.type !== "runtime.project.set") {
        return stageAck(
          NativeFrameType.PolicyCommit,
          requestId,
          false,
          "runtime.project-stage-invalid",
        );
      }
      const response = await controller.handleEnvelope(envelope);
      return encodeEnvelopeFrame(response);
    } catch {
      return stageAck(
        NativeFrameType.PolicyCommit,
        requestId,
        false,
        "runtime.project-stage-invalid",
      );
    }
  }

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
      projectStage = undefined;
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
      const native = decodeNativeFrame(frame);
      if (native.ok && isProjectStageType(native.value.type)) {
        return handleProjectStage(native.value);
      }

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

      // Capture pacRoutes before controller binds interception.
      if (envelope.type === "runtime.start") {
        const routes = envelope.metadata.pacRoutes;
        pendingRoutes = Array.isArray(routes)
          ? routes.filter((o): o is string => typeof o === "string")
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
  // Chrome closes the pipe on disconnect. Without a listener that write
  // surfaces as an unhandled 'error' and kills the host.
  stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") return;
    console.error("[rogatio-host] stdout error:", error.message);
  });

  let buffer = Buffer.alloc(0);
  // Extension commands run one at a time. A host- reply (PAC install/remove)
  // arrives while that command is still awaiting it, so replies bypass the
  // queue. The frame is copied out of `buffer` before any await; otherwise a
  // reply chunk re-reads the in-flight command and the reply is never parsed.
  let commandChain: Promise<void> = Promise.resolve();
  let pumping = false;

  function writeResponse(response: Uint8Array | null): void {
    if (response && stdout.writable) {
      console.error(
        "[rogatio-host] writing response:",
        response.length,
        "bytes",
      );
      stdout.write(Buffer.from(response));
      return;
    }
    console.error("[rogatio-host] no response to write");
  }

  function isHostReply(frame: Uint8Array): boolean {
    try {
      const envelope = decodeEnvelopeFrame(frame);
      return (
        typeof envelope.requestId === "string" &&
        envelope.requestId.startsWith("host-")
      );
    } catch {
      return false;
    }
  }

  function dispatch(frame: Uint8Array): void {
    if (isHostReply(frame)) {
      void host.processFrame(frame).then(writeResponse);
      return;
    }
    commandChain = commandChain
      .then(async () => {
        console.error(
          "[rogatio-host] processing frame:",
          frame.byteLength,
          "bytes",
        );
        writeResponse(await host.processFrame(frame));
      })
      .catch((error: unknown) => {
        console.error(
          "[rogatio-host] frame failed:",
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  function pump(): void {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (buffer.length < 4) break;
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const frame = Buffer.from(buffer.subarray(0, 4 + length));
        buffer = buffer.subarray(4 + length);
        dispatch(frame);
      }
    } finally {
      pumping = false;
    }
  }

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
    pump();
  });

  await new Promise<void>((resolve) => {
    stdin.on("end", () => {
      void commandChain.finally(() => host.stop()).then(() => resolve());
    });
    if (options.onReady) options.onReady();
    pump();
  });
}

export type { PresetDigest };
