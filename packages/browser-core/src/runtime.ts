import { coreDiagnostic } from "./diagnostics.js";
import type {
  NativeRuntimeState,
  RuntimeStates,
  RuntimeTransitionResult,
} from "./types.js";

export function initialRuntimeStates(): RuntimeStates {
  return {
    native: { phase: "stopped" },
  };
}

export class RuntimeStateController {
  private states: RuntimeStates;

  constructor(states?: RuntimeStates) {
    this.states = states ?? initialRuntimeStates();
  }

  snapshot(): RuntimeStates {
    return structuredClone(this.states);
  }

  startNative(): RuntimeTransitionResult {
    const native = this.states.native;
    if (native.phase === "starting" || native.phase === "started") {
      return this.reject(native.phase, "starting");
    }
    return this.commit({ ...this.states, native: { phase: "starting" } });
  }

  markNativeStarted(): RuntimeTransitionResult {
    const native = this.states.native;
    if (native.phase !== "starting") {
      return this.reject(native.phase, "started");
    }
    return this.commit({ ...this.states, native: { phase: "started" } });
  }

  failNative(message?: string): RuntimeTransitionResult {
    const native = this.states.native;
    if (native.phase !== "starting") {
      return this.reject(native.phase, "failed");
    }
    const next: NativeRuntimeState = {
      phase: "failed",
      ...(message !== undefined ? { lastError: message } : {}),
    };
    return this.commit({ ...this.states, native: next });
  }

  stopNative(): RuntimeTransitionResult {
    const native = this.states.native;
    if (native.phase === "stopped") {
      return this.commit({ ...this.states, native });
    }
    if (
      native.phase === "starting" ||
      native.phase === "started" ||
      native.phase === "failed"
    ) {
      return this.commit({ ...this.states, native: { phase: "stopped" } });
    }
    return this.reject(native.phase, "stopped");
  }

  private commit(states: RuntimeStates): RuntimeTransitionResult {
    this.states = states;
    return { ok: true, value: structuredClone(states) };
  }

  private reject(current: string, requested: string): RuntimeTransitionResult {
    return {
      ok: false,
      kind: "failure",
      diagnostics: [
        coreDiagnostic("core.runtime-transition", { current, requested }),
      ],
    };
  }
}
