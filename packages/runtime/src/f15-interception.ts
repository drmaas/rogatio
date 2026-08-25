import type { CapabilityProfile, RuntimeActivation } from "./f14-lifecycle.js";
import { generatePacScript } from "./f14-pac.js";

export interface F15PlatformCapabilities extends CapabilityProfile {
  readonly trustedDeviceLocalCa: boolean;
  readonly controllingProxy: boolean;
  readonly controllingPac: boolean;
  readonly controllingExtension: boolean;
  readonly enterprisePolicy: boolean;
}

export interface F15InterceptionAdapter {
  readonly platform: string;
  detect(): F15PlatformCapabilities;
  provisionOrVerifyCa(): Promise<boolean>;
  installPac(script: string): Promise<void>;
  removePac(): Promise<void>;
  startTlsProxy(activation: RuntimeActivation): Promise<void>;
  stopTlsProxy(): Promise<void>;
}

export interface F15InterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  start(
    activation: RuntimeActivation,
    origins: readonly string[],
  ): Promise<void>;
  stop(): Promise<void>;
  status(): "stopped" | "running" | "unsupported";
}

function unsupportedReasons(capabilities: F15PlatformCapabilities): string[] {
  const reasons = [...capabilities.reasons];
  if (!capabilities.trustedDeviceLocalCa)
    reasons.push("device-local-ca-untrusted");
  if (capabilities.controllingProxy) reasons.push("controlling-proxy");
  if (capabilities.controllingPac) reasons.push("controlling-pac");
  if (capabilities.controllingExtension) reasons.push("controlling-extension");
  if (capabilities.enterprisePolicy) reasons.push("enterprise-policy");
  return [...new Set(reasons)].sort();
}

export function createF15InterceptionProvider(
  adapter: F15InterceptionAdapter,
): F15InterceptionProvider {
  let state: "stopped" | "running" | "unsupported" = "stopped";
  let active = false;
  return {
    platform: adapter.platform,
    detect() {
      const capabilities = adapter.detect();
      const reasons = unsupportedReasons(capabilities);
      return {
        supported: capabilities.supported && reasons.length === 0,
        reasons,
      };
    },
    async start(activation, origins) {
      const capabilities = adapter.detect();
      const reasons = unsupportedReasons(capabilities);
      if (!capabilities.supported || reasons.length > 0) {
        state = "unsupported";
        throw new Error("runtime.platform-unsupported");
      }
      if (!(await adapter.provisionOrVerifyCa())) {
        state = "unsupported";
        throw new Error("runtime.platform-unsupported");
      }
      const pac = generatePacScript(
        origins,
        activation.proxy ?? { host: "127.0.0.1", port: 0 },
      );
      await adapter.installPac(pac);
      try {
        await adapter.startTlsProxy(activation);
        active = true;
        state = "running";
      } catch (error) {
        await adapter.removePac();
        throw error;
      }
    },
    async stop() {
      if (!active && state !== "running") {
        state = state === "unsupported" ? "unsupported" : "stopped";
        return;
      }
      await adapter.stopTlsProxy();
      await adapter.removePac();
      active = false;
      state = "stopped";
    },
    status() {
      return state;
    },
  };
}

export function createUnsupportedF15Provider(): F15InterceptionProvider {
  return createF15InterceptionProvider({
    platform: "unavailable",
    detect: () => ({
      supported: false,
      reasons: ["no-platform-adapter"],
      trustedDeviceLocalCa: false,
      controllingProxy: false,
      controllingPac: false,
      controllingExtension: false,
      enterprisePolicy: false,
    }),
    provisionOrVerifyCa: async () => false,
    installPac: async () => undefined,
    removePac: async () => undefined,
    startTlsProxy: async () => undefined,
    stopTlsProxy: async () => undefined,
  });
}
