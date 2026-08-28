import { describe, expect, it } from "vitest";
import { createNativeRuntimeController } from "../src/lifecycle.js";

describe("createNativeRuntimeController", () => {
  it("does not auto-start; begins idle", () => {
    const controller = createNativeRuntimeController();
    expect(controller.status().state).toBe("idle");
  });

  it("starts and stops with a capable capability detector", async () => {
    const controller = createNativeRuntimeController({
      detectCapabilities: () => ({ supported: true, reasons: [] }),
    });
    const started = await controller.start();
    expect(started.state).toBe("running");
    expect(started.activation?.state).toBe("running");

    const stopped = await controller.stop();
    expect(stopped.state).toBe("stopped");
    expect(controller.status().state).toBe("stopped");
  });

  it("reports unsupported when capabilities are absent", async () => {
    const controller = createNativeRuntimeController();
    const started = await controller.start();
    expect(started.state).toBe("unsupported");
    expect(started.reasons).toContain("no-capability-provider");
  });

  it("stop is idempotent", async () => {
    const controller = createNativeRuntimeController({
      detectCapabilities: () => ({ supported: true, reasons: [] }),
    });
    await controller.start();
    await controller.stop();
    const again = await controller.stop();
    expect(again.state).toBe("stopped");
  });

  it("re-detects on start after an unsupported result", async () => {
    let capable = false;
    const controller = createNativeRuntimeController({
      detectCapabilities: () => ({
        supported: capable,
        reasons: capable ? [] : ["deferred"],
      }),
    });
    expect((await controller.start()).state).toBe("unsupported");
    capable = true;
    expect((await controller.start()).state).toBe("running");
  });

  it("ignores repeated start while already running", async () => {
    const controller = createNativeRuntimeController({
      detectCapabilities: () => ({ supported: true, reasons: [] }),
    });
    await controller.start();
    const second = await controller.start();
    expect(second.state).toBe("running");
  });
});
