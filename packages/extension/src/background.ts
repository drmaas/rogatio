import type { NativeRuntimePhase } from "@rogatio/browser-core";
import {
  type ChromePort,
  createPermissionAdapter,
  createStorageAdapter,
  setBadge,
} from "./chrome.js";
import { createDnrInstaller } from "./dnr.js";
import { createMockConnectionHolder } from "./mock-runtime.js";
import type {
  NativeEnvelope,
  NativeEnvelopeInput,
  NativeRuntimeConfig,
} from "./native-session.js";
import { createExtensionApplication } from "./service-worker.js";

const NATIVE_HOST_NAME = "com.rogatio.runtime";

interface NativeRuntimeAdapter {
  start(config: NativeRuntimeConfig): Promise<{
    state: NativeRuntimePhase | "unsupported";
    message?: string;
  }>;
  stop(): Promise<{ state: NativeRuntimePhase | "unsupported" }>;
  status(): Promise<{ state: NativeRuntimePhase | "unsupported" }>;
  sendPolicy(frames: Uint8Array[]): Promise<void>;
  send(envelope: NativeEnvelopeInput): Promise<NativeEnvelope>;
}

/**
 * Production native-messaging adapter. Chrome launches the consolidated native
 * host (`rogatio runtime-host <path>`) via `connectNative`; the host's stdio
 * frame loop reads envelopes and returns response envelopes (spec REQ-001).
 * Control-plane methods (`start`/`stop`/`status`/`sendPolicy`) are thin shims;
 * the host is running once connected and receives lifecycle envelopes directly.
 */
function createNativeRuntimeAdapter(): NativeRuntimeAdapter {
  let port: ChromePort | null = null;
  let connected = false;
  let counter = 0;
  const pending = new Map<string, (envelope: NativeEnvelope) => void>();
  const rejected = new Map<string, (reason: Error) => void>();

  function ensurePort(): ChromePort {
    if (port) return port;
    const connect = api.runtime.connectNative;
    if (!connect) throw new Error("extension.chrome-native-unavailable");
    const next = connect(NATIVE_HOST_NAME);
    next.onMessage.addListener((message: unknown) => {
      const envelope = message as { requestId?: unknown };
      const requestId =
        envelope.requestId !== undefined
          ? String(envelope.requestId)
          : undefined;
      if (requestId !== undefined) {
        const resolve = pending.get(requestId);
        const reject = rejected.get(requestId);
        pending.delete(requestId);
        rejected.delete(requestId);
        if (resolve) resolve(message as NativeEnvelope);
        else if (reject) reject(new Error("unexpected response"));
      }
    });
    next.onDisconnect.addListener(() => {
      connected = false;
      port = null;
      for (const reject of rejected.values())
        reject(new Error("host disconnected"));
      pending.clear();
      rejected.clear();
    });
    connected = true;
    port = next;
    return next;
  }

  return {
    async start(): Promise<{ state: NativeRuntimePhase | "unsupported" }> {
      const active = ensurePort();
      active.postMessage({
        protocol: "v1",
        type: "runtime.start",
        metadata: {},
      });
      return { state: "started" };
    },
    async stop(): Promise<{ state: NativeRuntimePhase | "unsupported" }> {
      if (port) {
        try {
          port.postMessage({
            protocol: "v1",
            type: "runtime.stop",
            metadata: {},
          });
          // Chrome closes the native port when the service worker releases it.
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
    send(envelope: NativeEnvelopeInput): Promise<NativeEnvelope> {
      const active = ensurePort();
      const requestId = String(++counter);
      const full = { ...envelope, requestId } as NativeEnvelopeInput & {
        requestId: string;
      };
      return new Promise<NativeEnvelope>((resolve, reject) => {
        pending.set(requestId, resolve);
        rejected.set(requestId, reject);
        active.postMessage(full);
        setTimeout(() => {
          if (pending.has(requestId)) {
            pending.delete(requestId);
            rejected.delete(requestId);
            reject(new Error("native host timeout"));
          }
        }, 10000);
      });
    },
  };
}

const api = chrome;
const mockConnectionHolder = createMockConnectionHolder();
const application = createExtensionApplication({
  storage: createStorageAdapter(api),
  permissions: createPermissionAdapter(api),
  installer: createDnrInstaller(api, {
    mockUrlResolver: (operation) =>
      mockConnectionHolder.mockUrl(operation.ruleId),
  }),
  badge: (value) => setBadge(value, api),
  extensionId: api.runtime.id,
  nativeRuntime: createNativeRuntimeAdapter(),
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void application.handle(message).then(sendResponse);
  return true;
});
