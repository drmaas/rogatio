import type { CapabilityProfile, RuntimeActivation } from "./lifecycle.js";
import { generatePacScript } from "./pac.js";

export interface InterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  start(activation: RuntimeActivation): Promise<void>;
  stop(): Promise<void>;
}

export type InterceptionOutcome =
  | { readonly kind: "active"; readonly provider: string }
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
  readonly pacOrigins: readonly string[];
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
  pacOrigins: readonly string[],
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

  // Start provider in non-accepting mode first
  try {
    await registeredProvider.start(activation);
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
    activation,
    policyDigest,
    extensionId,
    pacOrigins,
    targetPolicy,
    startedAt: activation.startedAt,
  };

  return { kind: "active", provider: registeredProvider.platform };
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
  startTlsProxy(activation: RuntimeActivation): Promise<void>;
  stopTlsProxy(): Promise<void>;
}

export interface PlatformInterceptionProvider {
  readonly platform: string;
  detect(): CapabilityProfile;
  start(
    activation: RuntimeActivation,
    origins: readonly string[],
  ): Promise<void>;
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
    startTlsProxy: async () => undefined,
    stopTlsProxy: async () => undefined,
  });
}
