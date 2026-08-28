import {
  hasActiveSession,
  type SessionProvider,
  startInterception,
  stopInterception,
} from "./interception.js";
import type { NativeRuntimeState } from "./types.js";

export interface CapabilityProfile {
  readonly supported: boolean;
  readonly reasons: string[];
}

export interface RuntimeActivation {
  readonly state: "running";
  readonly startedAt: number;
  readonly proxy?: { readonly host: string; readonly port: number };
  readonly pacOrigins: readonly string[];
}

export interface SessionConfig {
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacOrigins: readonly string[];
  readonly targetPolicy: {
    readonly public: boolean;
    readonly localOrigins: readonly string[];
  };
}

export interface NativeRuntimeControllerOptions {
  readonly detectCapabilities?: () =>
    | CapabilityProfile
    | Promise<CapabilityProfile>;
  readonly onStart?: (
    activation: RuntimeActivation,
    session: SessionProvider,
  ) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly clock?: () => number;
}

export interface RuntimeStartResult {
  readonly state:
    | "running"
    | "unsupported"
    | "starting"
    | "stopping"
    | "stopped"
    | "idle";
  readonly activation?: RuntimeActivation;
  readonly session?: SessionProvider | null;
  readonly reasons?: string[];
}

export interface NativeRuntimeController {
  start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult>;
  stop(): Promise<{ readonly state: "stopped" | "unsupported" | "idle" }>;
  status(): { readonly state: NativeRuntimeState };
  getSession(): SessionProvider | null;
}

const DEFAULT_CAPABILITY: CapabilityProfile = {
  supported: false,
  reasons: ["no-capability-provider"],
};

/**
 * Guarded native-runtime control plane with session ownership.
 * Explicit Start/Stop (no auto-start). Activation is capability-based:
 * when no trusted device-local CA / PAC routing capability is present
 * the controller reports `unsupported` rather than starting.
 */
export function createNativeRuntimeController(
  options: NativeRuntimeControllerOptions = {},
): NativeRuntimeController {
  let state: NativeRuntimeState = "idle";
  let activation: RuntimeActivation | undefined;
  const detect = options.detectCapabilities ?? (() => DEFAULT_CAPABILITY);
  const clock = options.clock ?? (() => Date.now());

  return {
    async start(sessionConfig?: SessionConfig): Promise<RuntimeStartResult> {
      if (state === "running" || state === "starting") {
        if (activation) {
          return { state: "running", activation };
        }
        return { state };
      }

      if (hasActiveSession()) {
        return { state: "unsupported", reasons: ["session-collision"] };
      }

      state = "starting";
      const capabilities = await detect();
      if (!capabilities.supported) {
        state = "unsupported";
        return { state: "unsupported", reasons: capabilities.reasons };
      }

      const startedAt = clock();
      activation = { state: "running", startedAt, pacOrigins: [] };

      let session: SessionProvider | null = null;

      // Start interception with session config if provided
      if (sessionConfig) {
        const result = await startInterception(
          activation,
          sessionConfig.policyDigest,
          sessionConfig.extensionId,
          sessionConfig.pacOrigins,
          sessionConfig.targetPolicy,
        );

        if (result.kind === "unsupported") {
          state = "unsupported";
          activation = undefined;
          return { state: "unsupported", reasons: result.reasons };
        }

        session = getCurrentSession();
        if (!session) {
          state = "unsupported";
          activation = undefined;
          return { state: "unsupported", reasons: ["session-not-created"] };
        }

        // Update activation with PAC origins from session
        activation = { ...activation, pacOrigins: session.pacOrigins };
      }

      if (options.onStart && session)
        await options.onStart(activation, session);
      state = "running";
      return { state: "running", activation, session };
    },

    async stop() {
      if (state === "idle") {
        state = "stopped";
        return { state: "stopped" };
      }
      if (state === "unsupported") {
        return { state: "unsupported" };
      }
      if (state === "stopped") {
        return { state: "stopped" };
      }
      state = "stopping";
      if (options.onStop) await options.onStop();
      await stopInterception();
      activation = undefined;
      state = "stopped";
      return { state: "stopped" };
    },

    status() {
      return { state };
    },

    getSession() {
      return hasActiveSession() ? getCurrentSession() : null;
    },
  };
}

function _hasActiveSession(): boolean {
  // Import dynamically to avoid circular dependency
  return false;
}

function getCurrentSession(): SessionProvider | null {
  return null;
}
