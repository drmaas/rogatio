import { coreDiagnostic } from "./diagnostics.js";
import type {
  MockRuntimeState,
  NativeRuntimeState,
  RuntimeStates,
  RuntimeTransitionResult,
} from "./types.js";

export function initialRuntimeStates(): RuntimeStates {
  return {
    mock: { phase: "disconnected", lastCheck: null },
    native: { phase: "stopped" },
  };
}

export class RuntimeStateController {
  private states: RuntimeStates;
  private readonly now: () => number;

  constructor(states?: RuntimeStates, now?: () => number) {
    this.states = states ?? initialRuntimeStates();
    this.now = now ?? (() => Date.now());
  }

  snapshot(): RuntimeStates {
    return structuredClone(this.states);
  }

  beginMockCheck(): RuntimeTransitionResult {
    const mock = this.states.mock;
    if (mock.phase === "checking") {
      return this.reject(mock.phase, "checking");
    }
    return this.commit({
      ...this.states,
      mock: { phase: "checking", lastCheck: mock.lastCheck },
    });
  }

  completeMockCheck(ok: boolean, message?: string): RuntimeTransitionResult {
    const mock = this.states.mock;
    if (mock.phase !== "checking") {
      return this.reject(mock.phase, ok ? "connected" : "failed");
    }
    const lastCheck: MockRuntimeState["lastCheck"] = {
      at: this.now(),
      ok,
      ...(message !== undefined ? { message } : {}),
    };
    return this.commit({
      ...this.states,
      mock: { phase: ok ? "connected" : "failed", lastCheck },
    });
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
