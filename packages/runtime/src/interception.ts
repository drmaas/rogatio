import type { CapabilityProfile, RuntimeActivation } from "./lifecycle.js";
import { generatePacScript } from "./pac.js";

export interface ProxyEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface InterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  /** Returns the loopback proxy endpoint when interception becomes active. */
  start(activation: RuntimeActivation): Promise<ProxyEndpoint | undefined>;
  stop(): Promise<void>;
}

export type InterceptionOutcome =
  | {
      readonly kind: "active";
      readonly provider: string;
      readonly proxy: ProxyEndpoint;
    }
  | { readonly kind: "unsupported"; readonly reasons: string[] };

/**
 * Session-bound interception provider management.
 * Replaces the global provider with per-session ownership.
 */
export interface SessionProvider {
  readonly sessionId: string;
  readonly provider: InterceptionProvider;
  readonly activation: RuntimeActivation;
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacRoutes: readonly string[];
  readonly targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  };
  readonly startedAt: number;
}

let registeredProvider: InterceptionProvider | null = null;
let currentSession: SessionProvider | null = null;

/** Register the platform-specific interception provider. */
export function registerInterceptionProvider(
  provider: InterceptionProvider,
): void {
  registeredProvider = provider;
}

export function getInterceptionProvider(): InterceptionProvider | null {
  return registeredProvider;
}

export function getCurrentSession(): SessionProvider | null {
  return currentSession;
}

/**
 * Capability-gated interception entry point with session ownership.
 * With no registered provider (this scope) interception is `unsupported`.
 * Activation is never performed unless the provider reports a supported capability profile.
 */
export async function startInterception(
  activation: RuntimeActivation,
  policyDigest: string,
  extensionId: string,
  pacRoutes: readonly string[],
  targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  },
): Promise<InterceptionOutcome> {
  if (registeredProvider === null) {
    return { kind: "unsupported", reasons: ["no-interception-provider"] };
  }
  const capabilities = registeredProvider.detect();
  if (!capabilities.supported) {
    return { kind: "unsupported", reasons: capabilities.reasons };
  }

  // Check for existing session collision
  if (currentSession !== null) {
    return { kind: "unsupported", reasons: ["session-collision"] };
  }

  const sessionId = `session-${activation.startedAt}-${Math.random().toString(36).slice(2)}`;

  let proxy: ProxyEndpoint;
  try {
    const started = await registeredProvider.start(activation);
    if (
      started &&
      typeof started === "object" &&
      typeof started.host === "string" &&
      typeof started.port === "number"
    ) {
      proxy = started;
    } else if (activation.proxy) {
      proxy = activation.proxy;
    } else {
      return {
        kind: "unsupported",
        reasons: ["provider-start-failed", "missing-proxy-endpoint"],
      };
    }
  } catch (error) {
    return {
      kind: "unsupported",
      reasons: ["provider-start-failed", String(error)],
    };
  }

  // Create session record
  currentSession = {
    sessionId,
    provider: registeredProvider,
    activation: { ...activation, proxy, pacRoutes },
    policyDigest,
    extensionId,
    pacRoutes,
    targetPolicy,
    startedAt: activation.startedAt,
  };

  return { kind: "active", provider: registeredProvider.platform, proxy };
}

export async function stopInterception(): Promise<void> {
  if (currentSession === null && registeredProvider === null) return;

  const session = currentSession;
  currentSession = null;

  if (session?.provider) {
    try {
      await session.provider.stop();
    } catch {
      // Best effort cleanup
    }
  }
}

export function hasActiveSession(): boolean {
  return currentSession !== null;
}

export function clearSession(): void {
  currentSession = null;
}

export interface PlatformCapabilities extends CapabilityProfile {
  readonly trustedDeviceLocalCa: boolean;
  readonly controllingProxy: boolean;
  readonly controllingPac: boolean;
  readonly controllingExtension: boolean;
  readonly enterprisePolicy: boolean;
}

export interface PlatformInterceptionAdapter {
  readonly platform: string;
  detect(): PlatformCapabilities;
  provisionOrVerifyCa(): Promise<boolean>;
  installPac(script: string): Promise<void>;
  removePac(): Promise<void>;
  startTlsProxy(activation: RuntimeActivation): Promise<ProxyEndpoint>;
  stopTlsProxy(): Promise<void>;
}

export interface PlatformInterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  start(
    activation: RuntimeActivation,
    pacRoutes: readonly string[],
  ): Promise<ProxyEndpoint>;
  stop(): Promise<void>;
  status(): "stopped" | "running" | "unsupported";
}

function unsupportedReasons(capabilities: PlatformCapabilities): string[] {
  const reasons = [...capabilities.reasons];
  if (!capabilities.trustedDeviceLocalCa)
    reasons.push("device-local-ca-untrusted");
  if (capabilities.controllingProxy) reasons.push("controlling-proxy");
  if (capabilities.controllingPac) reasons.push("controlling-pac");
  if (capabilities.controllingExtension) reasons.push("controlling-extension");
  if (capabilities.enterprisePolicy) reasons.push("enterprise-policy");
  return [...new Set(reasons)].sort();
}

export function createPlatformInterceptionProvider(
  adapter: PlatformInterceptionAdapter,
): PlatformInterceptionProvider {
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
    async start(activation, pacRoutes) {
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
      // Proxy first so PAC can target a real listening endpoint.
      const endpoint = await adapter.startTlsProxy(activation);
      const pac = generatePacScript(
        pacRoutes.map((hostname) => ({ hostname })),
        endpoint,
      );
      try {
        await adapter.installPac(pac);
        active = true;
        state = "running";
        return endpoint;
      } catch (error) {
        // PAC never installed successfully — tear down proxy only.
        await adapter.stopTlsProxy();
        active = false;
        state = "stopped";
        throw error;
      }
    },
    async stop() {
      if (!active && state !== "running") {
        state = state === "unsupported" ? "unsupported" : "stopped";
        return;
      }
      // Stop routing before tearing down the listener.
      await adapter.removePac();
      await adapter.stopTlsProxy();
      active = false;
      state = "stopped";
    },
    status() {
      return state;
    },
  };
}

export function createUnsupportedPlatformProvider(): PlatformInterceptionProvider {
  return createPlatformInterceptionProvider({
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
    startTlsProxy: async () => ({ host: "127.0.0.1", port: 0 }),
    stopTlsProxy: async () => undefined,
  });
}
