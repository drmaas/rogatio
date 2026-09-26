import type { NativeRuntimePhase } from "@rogatio/browser-core";
import {
  type ChromePort,
  createProxyAdapter,
  createStorageAdapter,
  setBadge,
} from "./chrome.js";
import { createDnrInstaller } from "./dnr.js";
import { registerMatchLogListener } from "./match-listener.js";

import type {
  NativeEnvelope,
  NativeEnvelopeInput,
  NativeRuntimeConfig,
} from "./native-session.js";
import { createExtensionApplication } from "./service-worker.js";

const NATIVE_HOST_NAME = "com.rogatio.runtime";
const api = chrome;

/**
 * Raised when the native-messaging host manifest is not registered with
 * Chrome. Chrome throws synchronously from `connectNative` when the host was
 * never installed on this profile, which callers must not confuse with a
 * storage or platform failure.
 */
class NativeHostMissingError extends Error {
  constructor() {
    super("extension.native-host-missing");
    this.name = "NativeHostMissingError";
  }
}

function isNativeHostMissingError(error: unknown): boolean {
  return error instanceof NativeHostMissingError;
}

interface NativeRuntimeAdapter {
  start(config: NativeRuntimeConfig): Promise<{
    state: NativeRuntimePhase | "unsupported";
    message?: string;
  }>;
  stop(): Promise<{ state: NativeRuntimePhase | "unsupported" }>;
  status(): Promise<{ state: NativeRuntimePhase | "unsupported" }>;
  sendPolicy(frames: Uint8Array[]): Promise<void>;
  send(envelope: NativeEnvelopeInput): Promise<NativeEnvelope>;
  lastConnectError(): string | null;
}

/**
 * Production native-messaging adapter. Chrome launches the consolidated native
 * host (`rogatio runtime host <path>`) via `connectNative`; the host's stdio
 * frame loop reads envelopes and returns response envelopes (spec REQ-001).
 * Control-plane methods (`start`/`stop`/`status`/`sendPolicy`) are thin shims;
 * the host is running once connected and receives lifecycle envelopes directly.
 */
function createNativeRuntimeAdapter(): NativeRuntimeAdapter {
  let port: ChromePort | null = null;
  let connected = false;
  let counter = 0;
  let lastConnectError: string | null = null;
  let pacInstalled = false;
  const pending = new Map<string, (envelope: NativeEnvelope) => void>();
  const rejected = new Map<string, (reason: Error) => void>();
  const proxy = createProxyAdapter(api);

  function rememberConnectError(error: unknown): Error {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string" && error.length > 0
          ? error
          : "Native messaging host disconnected before responding.";
    lastConnectError = message;
    return new Error(message);
  }

  function replyToHost(envelope: NativeEnvelopeInput & { requestId: string }) {
    if (!port) return;
    try {
      port.postMessage(envelope);
    } catch (error) {
      console.log("[rogatio] replyToHost failed:", error);
    }
  }

  async function handleHostRequest(message: NativeEnvelope): Promise<void> {
    const requestId = message.requestId;
    if (requestId === undefined) return;
    try {
      if (message.type === "runtime.pac.install") {
        const script =
          typeof message.metadata.script === "string"
            ? message.metadata.script
            : "";
        await proxy.installPac(script);
        pacInstalled = true;
        replyToHost({
          protocol: "v1",
          type: "runtime.pac.install",
          requestId,
          timestamp: Date.now(),
          metadata: { ok: true },
        });
        return;
      }
      if (message.type === "runtime.pac.remove") {
        await proxy.clearPac();
        pacInstalled = false;
        replyToHost({
          protocol: "v1",
          type: "runtime.pac.remove",
          requestId,
          timestamp: Date.now(),
          metadata: { ok: true },
        });
        return;
      }
      replyToHost({
        protocol: "v1",
        type: message.type,
        requestId,
        timestamp: Date.now(),
        metadata: { ok: false, error: "runtime.request-malformed" },
      });
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "pac-install-failed";
      replyToHost({
        protocol: "v1",
        type: message.type,
        requestId,
        timestamp: Date.now(),
        metadata: { ok: false, error: code },
      });
    }
  }

  function ensurePort(): ChromePort {
    if (port) {
      console.log("[rogatio] ensurePort: reusing existing port");
      return port;
    }
    const connect = api.runtime.connectNative;
    if (!connect) throw new NativeHostMissingError();
    let next: ChromePort;
    try {
      console.log("[rogatio] ensurePort: connecting to", NATIVE_HOST_NAME);
      next = connect(NATIVE_HOST_NAME);
      lastConnectError = null;
      console.log("[rogatio] ensurePort: connected successfully");
    } catch (error) {
      console.log("[rogatio] ensurePort: connectNative FAILED:", error);
      rememberConnectError(error);
      throw new NativeHostMissingError();
    }
    next.onMessage.addListener((message: unknown) => {
      const envelope = message as {
        requestId?: unknown;
        type?: string;
        metadata?: Record<string, unknown>;
        protocol?: string;
        timestamp?: number;
      };
      console.log(
        "[rogatio] onMessage:",
        envelope.type,
        "requestId:",
        envelope.requestId,
      );
      const requestId =
        envelope.requestId !== undefined
          ? String(envelope.requestId)
          : undefined;
      if (requestId?.startsWith("host-")) {
        void handleHostRequest(message as NativeEnvelope);
        return;
      }
      if (requestId !== undefined) {
        const resolve = pending.get(requestId);
        const reject = rejected.get(requestId);
        pending.delete(requestId);
        rejected.delete(requestId);
        if (resolve) resolve(message as NativeEnvelope);
        else if (reject) reject(new Error("unexpected response"));
        else
          console.log("[rogatio] onMessage: no pending request for", requestId);
      }
    });
    next.onDisconnect.addListener(() => {
      const disconnectError = rememberConnectError(
        api.runtime.lastError?.message ??
          "Native messaging host disconnected before responding.",
      );
      console.log("[rogatio] port disconnected:", disconnectError.message);
      connected = false;
      port = null;
      if (pacInstalled) {
        void proxy.clearPac().catch(() => undefined);
        pacInstalled = false;
      }
      for (const reject of rejected.values()) reject(disconnectError);
      pending.clear();
      rejected.clear();
    });
    connected = true;
    port = next;
    return next;
  }

  function send(envelope: NativeEnvelopeInput): Promise<NativeEnvelope> {
    console.log(
      "[rogatio] send:",
      envelope.type,
      "requestId:",
      envelope.requestId,
    );
    const active = ensurePort();
    const requestId = String(++counter);
    const full = { ...envelope, requestId } as NativeEnvelopeInput & {
      requestId: string;
    };
    return new Promise<NativeEnvelope>((resolve, reject) => {
      pending.set(requestId, resolve);
      rejected.set(requestId, reject);
      try {
        active.postMessage(full);
      } catch (error) {
        const postError = rememberConnectError(error);
        pending.delete(requestId);
        rejected.delete(requestId);
        reject(postError);
        return;
      }
      setTimeout(() => {
        if (pending.has(requestId)) {
          console.log("[rogatio] send timeout for", envelope.type);
          pending.delete(requestId);
          rejected.delete(requestId);
          reject(
            rememberConnectError(
              "Native messaging host timed out before responding.",
            ),
          );
        }
      }, 10000);
    });
  }

  return {
    async start(config: NativeRuntimeConfig): Promise<{
      state: NativeRuntimePhase | "unsupported";
      message?: string;
    }> {
      try {
        console.log("[rogatio] background.start: ensurePort + runtime.start");
        const response = await send({
          protocol: "v1",
          type: "runtime.start",
          timestamp: Date.now(),
          metadata: {
            sessionId: config.sessionId,
            policyDigest: config.policyDigest,
            extensionId: config.extensionId,
            pacRoutes: [...config.pacRoutes],
            targetPolicy: {
              publicAllowed: config.targetPolicy.publicAllowed,
              localOrigins: [...config.targetPolicy.localOrigins],
            },
          },
        });
        const interception = response.metadata.interception as
          | { active?: boolean; reasons?: string[] }
          | undefined;
        const needsPac = config.pacRoutes.length > 0;
        const active = interception?.active === true;
        if (needsPac && !active) {
          const reasons = Array.isArray(interception?.reasons)
            ? interception.reasons.join(",")
            : "interception-inactive";
          console.log(
            "[rogatio] background.start interception failed:",
            reasons,
          );
          return {
            state: "unsupported",
            message: reasons || "interception-inactive",
          };
        }
        if (response.metadata.ok === false && needsPac) {
          return {
            state: "failed",
            message:
              typeof response.metadata.error === "string"
                ? response.metadata.error
                : "runtime.start-failed",
          };
        }
        return { state: "started" };
      } catch (error) {
        console.log("[rogatio] background.start error:", error);
        if (isNativeHostMissingError(error))
          return {
            state: "unsupported",
            message: "extension.native-host-missing",
          };
        return {
          state: "failed",
          message: "extension.native-runtime-transition",
        };
      }
    },
    async stop(): Promise<{ state: NativeRuntimePhase | "unsupported" }> {
      try {
        if (pacInstalled) {
          await proxy.clearPac();
          pacInstalled = false;
        }
      } catch {
        // Best-effort PAC clear.
      }
      if (port) {
        try {
          await send({
            protocol: "v1",
            type: "runtime.stop",
            timestamp: Date.now(),
            metadata: {},
          });
        } catch {
          // The browser may already have disconnected the host.
        }
      }
      connected = false;
      port = null;
      return { state: "stopped" };
    },
    async status(): Promise<{ state: NativeRuntimePhase | "unsupported" }> {
      return { state: connected ? "started" : "stopped" };
    },
    async sendPolicy(): Promise<void> {
      return;
    },
    send,
    lastConnectError(): string | null {
      return lastConnectError;
    },
  };
}

const application = createExtensionApplication({
  storage: createStorageAdapter(api),
  installer: createDnrInstaller(api),
  badge: (value) => setBadge(value, api),
  extensionId: api.runtime.id,
  chromeApi: api,
  // Fail-closed: stripReservedMarkers is wired inside proxyRequest, but that
  // helper has no live caller yet (no PAC / session-proxy routing). Claiming
  // "available" would install DNR set markers that can reach the origin.
  // Flip true only when session traffic actually traverses the strip path.
  runtimeStripPathAvailable: false,
  nativeRuntime: createNativeRuntimeAdapter(),
});

registerMatchLogListener(api);

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void application.handle(message).then(sendResponse);
  return true;
});
