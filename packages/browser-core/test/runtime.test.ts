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
  it("starts disconnected with no last check and native stopped", () => {
    expect(initialRuntimeStates()).toEqual({
      mock: { phase: "disconnected", lastCheck: null },
      native: { phase: "stopped" },
    });
  });

  it("returns a fresh object on every call", () => {
    expect(initialRuntimeStates()).not.toBe(initialRuntimeStates());
  });
});

describe("RuntimeStateController mock transitions", () => {
  it("performs a check-and-connect cycle and records the last check", () => {
    let time = 100;
    const controller = new RuntimeStateController(undefined, () => time);

    const began = controller.beginMockCheck();
    expect(began.ok).toBe(true);
    if (began.ok) {
      expect(began.value.mock.phase).toBe("checking");
      expect(began.value.mock.lastCheck).toBeNull();
    }

    time = 105;
    const completed = controller.completeMockCheck(true);
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.value.mock.phase).toBe("connected");
      expect(completed.value.mock.lastCheck).toEqual({
        at: 105,
        ok: true,
      });
    }
  });

  it("records failed checks with a stable message", () => {
    const controller = new RuntimeStateController();
    controller.beginMockCheck();
    const failed = controller.completeMockCheck(false, "no runtime");

    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.mock.phase).toBe("failed");
      expect(failed.value.mock.lastCheck).toMatchObject({
        ok: false,
        message: "no runtime",
      });
    }
  });

  it("keeps the last completed check while a new check is in flight", () => {
    const controller = new RuntimeStateController();
    controller.beginMockCheck();
    controller.completeMockCheck(true);
    const recheck = controller.beginMockCheck();

    expect(recheck.ok).toBe(true);
    if (recheck.ok) {
      expect(recheck.value.mock.phase).toBe("checking");
      expect(recheck.value.mock.lastCheck?.ok).toBe(true);
    }
  });

  it("allows re-checking from connected or failed states", () => {
    const controller = new RuntimeStateController();
    controller.beginMockCheck();
    controller.completeMockCheck(false, "boom");
    expect(controller.beginMockCheck().ok).toBe(true);
  });

  it("rejects transitions out of order", () => {
    const controller = new RuntimeStateController();

    const duplicate = controller.beginMockCheck();
    expect(duplicate.ok).toBe(true);
    const inFlight = controller.beginMockCheck();
    expectFailure(inFlight);
    expect(inFlight.diagnostics[0]?.code).toBe("core.runtime-transition");

    const premature = new RuntimeStateController();
    const earlyComplete = premature.completeMockCheck(true);
    expectFailure(earlyComplete);
    expect(earlyComplete.diagnostics[0]?.code).toBe("core.runtime-transition");
  });
});

describe("RuntimeStateController native transitions", () => {
  it("walks start, started, stop, and restart cycles", () => {
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
    controller.beginMockCheck();

    const snapshot = controller.snapshot() as unknown as {
      mock: { phase: string; lastCheck: unknown };
    };
    snapshot.mock.phase = "hacked";
    snapshot.mock.lastCheck = { at: 0, ok: false };

    const fresh = controller.snapshot();
    expect(fresh.mock.phase).toBe("checking");
    expect(fresh.mock.lastCheck).toBeNull();
    expect(fresh).not.toBe(snapshot);
  });

  it("reports the current state after each transition", () => {
    const controller = new RuntimeStateController();
    controller.startNative();
    controller.markNativeStarted();

    const snapshot = controller.snapshot();
    expect(snapshot.native.phase).toBe("started");
    expect(snapshot.mock.phase).toBe("disconnected");
  });
});
