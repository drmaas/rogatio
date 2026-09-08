import { describe, expect, it } from "vitest";
import type { RuntimeTransitionResult } from "../src/index.js";
import { initialRuntimeStates, RuntimeStateController } from "../src/index.js";

function expectFailure(
  result: RuntimeTransitionResult,
): asserts result is Extract<RuntimeTransitionResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected transition to fail");
}

describe("initialRuntimeStates", () => {
  it("starts with native stopped", () => {
    expect(initialRuntimeStates()).toEqual({
      native: { phase: "stopped" },
    });
  });

  it("returns a fresh object on every call", () => {
    expect(initialRuntimeStates()).not.toBe(initialRuntimeStates());
  });
});

describe("RuntimeStateController native transitions", () => {
  it("performs native transition cycles", () => {
    const controller = new RuntimeStateController();

    const started = controller.startNative();
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.value.native.phase).toBe("starting");

    const running = controller.markNativeStarted();
    expect(running.ok).toBe(true);
    if (running.ok) expect(running.value.native.phase).toBe("started");

    const stopped = controller.stopNative();
    expect(stopped.ok).toBe(true);
    if (stopped.ok) expect(stopped.value.native.phase).toBe("stopped");

    const restarted = controller.startNative();
    expect(restarted.ok).toBe(true);
    if (restarted.ok) expect(restarted.value.native.phase).toBe("starting");
  });

  it("records failure with a stable message and allows restart", () => {
    const controller = new RuntimeStateController();
    controller.startNative();
    const failed = controller.failNative("certificate missing");

    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.native.phase).toBe("failed");
      expect(failed.value.native.lastError).toBe("certificate missing");
    }
    expect(controller.startNative().ok).toBe(true);
  });

  it("stops from failed and treats stop while stopped as a no-op", () => {
    const controller = new RuntimeStateController();
    controller.startNative();
    controller.failNative("boom");

    const stopped = controller.stopNative();
    expect(stopped.ok).toBe(true);
    if (stopped.ok) expect(stopped.value.native.phase).toBe("stopped");

    expect(controller.stopNative().ok).toBe(true);
  });

  it("rejects invalid native transitions", () => {
    const controller = new RuntimeStateController();
    controller.startNative();
    controller.markNativeStarted();

    const doubleStart = controller.startNative();
    expectFailure(doubleStart);
    expect(doubleStart.diagnostics[0]?.code).toBe("core.runtime-transition");

    const premature = new RuntimeStateController();
    const earlyFail = premature.failNative("never started");
    expectFailure(earlyFail);
    const earlyMark = premature.markNativeStarted();
    expectFailure(earlyMark);
  });
});

describe("RuntimeStateController snapshots", () => {
  it("returns detached snapshots", () => {
    const controller = new RuntimeStateController();
    controller.startNative();

    const snapshot = controller.snapshot();
    expect(snapshot.native.phase).toBe("starting");
  });

  it("reports the current state after each transition", () => {
    const controller = new RuntimeStateController();
    controller.startNative();
    controller.markNativeStarted();

    const snapshot = controller.snapshot();
    expect(snapshot.native.phase).toBe("started");
  });
});
