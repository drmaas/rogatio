import type { NativeRuntimeState } from "./f14-types.js";

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

export interface NativeRuntimeControllerOptions {
  readonly detectCapabilities?: () =>
    | CapabilityProfile
    | Promise<CapabilityProfile>;
  readonly onStart?: (activation: RuntimeActivation) => void | Promise<void>;
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
  readonly reasons?: string[];
}

export interface NativeRuntimeController {
  start(): Promise<RuntimeStartResult>;
  stop(): Promise<{ readonly state: "stopped" | "unsupported" | "idle" }>;
  status(): { readonly state: NativeRuntimeState };
}

const DEFAULT_CAPABILITY: CapabilityProfile = {
  supported: false,
  reasons: ["no-capability-provider"],
};

/**
 * Guarded native-runtime control plane. Explicit Start/Stop (no auto-start).
 * Activation is capability-based: when no trusted device-local CA / PAC routing
 * capability is present the controller reports `unsupported` rather than starting.
 */
export function createNativeRuntimeController(
  options: NativeRuntimeControllerOptions = {},
): NativeRuntimeController {
  let state: NativeRuntimeState = "idle";
  let activation: RuntimeActivation | undefined;
  const detect = options.detectCapabilities ?? (() => DEFAULT_CAPABILITY);
  const clock = options.clock ?? (() => Date.now());

  return {
    async start(): Promise<RuntimeStartResult> {
      if (state === "running" || state === "starting") {
        return activation ? { state: "running", activation } : { state };
      }

      state = "starting";
      const capabilities = await detect();
      if (!capabilities.supported) {
        state = "unsupported";
        return { state: "unsupported", reasons: capabilities.reasons };
      }

      activation = { state: "running", startedAt: clock(), pacOrigins: [] };
      if (options.onStart) await options.onStart(activation);
      state = "running";
      return { state: "running", activation };
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
      activation = undefined;
      state = "stopped";
      return { state: "stopped" };
    },

    status() {
      return { state };
    },
  };
}
