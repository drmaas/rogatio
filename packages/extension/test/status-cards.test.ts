import { describe, expect, it } from "vitest";
import {
  type AiCardInput,
  resolveAiCard,
  resolveAiTone,
  resolveRuntimeRecoveryText,
  resolveRuntimeStatusClass,
  resolveRuntimeStatusText,
  resolveRuntimeTone,
  shouldShowRuntimeDiagnostics,
} from "../src/status-cards.js";

function aiInput(overrides: Partial<AiCardInput> = {}): AiCardInput {
  return {
    phase: "started",
    aiSupported: false,
    aiStatusChecked: false,
    aiReported: false,
    aiProvider: null,
    ...overrides,
  };
}

describe("resolveRuntimeStatusText", () => {
  it("maps each phase to its sidebar status text", () => {
    expect(resolveRuntimeStatusText("starting")).toBe("starting");
    expect(resolveRuntimeStatusText("started")).toBe("running");
    expect(resolveRuntimeStatusText("failed")).toBe("failed to start");
    expect(resolveRuntimeStatusText("unsupported")).toBe(
      "unavailable on this platform",
    );
    expect(resolveRuntimeStatusText("error")).toBe("error");
    expect(resolveRuntimeStatusText("stopped")).toBe("stopped");
    expect(resolveRuntimeStatusText(undefined)).toBe("stopped");
  });
});

describe("resolveRuntimeTone", () => {
  it("maps each phase to its sidebar card tone", () => {
    expect(resolveRuntimeTone("started")).toBe("ok");
    expect(resolveRuntimeTone("failed")).toBe("error");
    expect(resolveRuntimeTone("error")).toBe("error");
    expect(resolveRuntimeTone("starting")).toBe("warn");
    expect(resolveRuntimeTone("stopped")).toBe("muted");
    expect(resolveRuntimeTone("unsupported")).toBe("muted");
    expect(resolveRuntimeTone(undefined)).toBe("muted");
  });
});

describe("shouldShowRuntimeDiagnostics", () => {
  it("shows diagnostics only on failed/unsupported", () => {
    expect(shouldShowRuntimeDiagnostics("failed")).toBe(true);
    expect(shouldShowRuntimeDiagnostics("unsupported")).toBe(true);
    expect(shouldShowRuntimeDiagnostics("started")).toBe(false);
    expect(shouldShowRuntimeDiagnostics("starting")).toBe(false);
    expect(shouldShowRuntimeDiagnostics("stopped")).toBe(false);
    expect(shouldShowRuntimeDiagnostics("error")).toBe(false);
    expect(shouldShowRuntimeDiagnostics(undefined)).toBe(false);
  });
});

describe("resolveRuntimeStatusClass", () => {
  it("maps each phase to its status dot class", () => {
    expect(resolveRuntimeStatusClass("started")).toBe(
      "rogatio-runtime-running",
    );
    expect(resolveRuntimeStatusClass("failed")).toBe("rogatio-runtime-failed");
    expect(resolveRuntimeStatusClass("error")).toBe("rogatio-runtime-failed");
    expect(resolveRuntimeStatusClass("starting")).toBe(
      "rogatio-runtime-starting",
    );
    expect(resolveRuntimeStatusClass("stopped")).toBe("rogatio-runtime-idle");
    expect(resolveRuntimeStatusClass("unsupported")).toBe(
      "rogatio-runtime-idle",
    );
    expect(resolveRuntimeStatusClass(undefined)).toBe("rogatio-runtime-idle");
  });
});

describe("resolveRuntimeRecoveryText", () => {
  it("picks the fix hint from the error text", () => {
    expect(
      resolveRuntimeRecoveryText("failed", "not in allowed_origins"),
    ).toContain("allowed_origins");
    expect(
      resolveRuntimeRecoveryText("failed", "native-host-missing binary"),
    ).toContain("Install the host");
    expect(resolveRuntimeRecoveryText("failed", "host gone")).toContain(
      "Re-run the install command",
    );
    expect(resolveRuntimeRecoveryText("failed", "trust the CA")).toContain(
      "trust the device-local CA",
    );
    expect(
      resolveRuntimeRecoveryText("failed", "runtime.root-invalid"),
    ).toContain("Project details");
  });

  it("covers unsupported without a concrete error", () => {
    expect(resolveRuntimeRecoveryText("unsupported", null)).toContain(
      "cannot provide the capabilities",
    );
  });

  it("falls back to the diagnostics hint", () => {
    expect(resolveRuntimeRecoveryText("failed", null)).toContain(
      "Open Show diagnostics",
    );
    expect(resolveRuntimeRecoveryText("failed", "mystery")).toContain(
      "Open Show diagnostics",
    );
  });
});

describe("resolveAiTone", () => {
  it("is ok when supported, warn when checked and reported, muted otherwise", () => {
    expect(
      resolveAiTone(aiInput({ aiSupported: true, aiStatusChecked: true })),
    ).toBe("ok");
    expect(
      resolveAiTone(aiInput({ aiStatusChecked: true, aiReported: true })),
    ).toBe("warn");
    expect(
      resolveAiTone(aiInput({ aiStatusChecked: true, aiReported: false })),
    ).toBe("muted");
    expect(resolveAiTone(aiInput())).toBe("muted");
  });
});

describe("resolveAiCard state mapping", () => {
  it("gives needs-runtime precedence over reported provider metadata", () => {
    const view = resolveAiCard(
      aiInput({
        phase: "stopped",
        aiSupported: true,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
    );
    expect(view.statusText).toBe("AI: needs runtime");
    expect(view.statusClass).toBe("rogatio-ai-needs-runtime");
    expect(view.showProviderLines).toBe(false);
    expect(view.providerUrl).toBeNull();
    expect(view.model).toBeNull();
  });

  it("renders Configured with provider/model lines when supported with metadata", () => {
    const view = resolveAiCard(
      aiInput({
        aiSupported: true,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
    );
    expect(view.statusText).toBe("AI: Configured");
    expect(view.statusClass).toBe("rogatio-ai-ready");
    expect(view.tone).toBe("ok");
    expect(view.showProviderLines).toBe(true);
    expect(view.providerUrl).toBe("https://api.example.com/v1");
    expect(view.model).toBe("m-1");
  });

  it("renders not reported when checked but the host reported nothing", () => {
    const view = resolveAiCard(
      aiInput({ aiStatusChecked: true, aiReported: false }),
    );
    expect(view.statusText).toBe("AI: not reported");
    expect(view.statusClass).toBe("rogatio-ai-not-reported");
    expect(view.showProviderLines).toBe(false);
  });

  it("renders Not configured when reported without support", () => {
    const view = resolveAiCard(
      aiInput({ aiStatusChecked: true, aiReported: true }),
    );
    expect(view.statusText).toBe("AI: Not configured");
    expect(view.statusClass).toBe("rogatio-ai-not-configured");
    expect(view.showProviderLines).toBe(false);
  });

  it("renders Not configured when the check has not run yet", () => {
    const view = resolveAiCard(aiInput());
    expect(view.statusText).toBe("AI: Not configured");
    expect(view.showProviderLines).toBe(false);
  });

  it("treats partial metadata as not reported, never half-populated", () => {
    // checkNativeAISupport maps configured-without-strings to
    // supported=false, reported=false, provider=null (spec REQ-007).
    const view = resolveAiCard(
      aiInput({ aiStatusChecked: true, aiReported: false, aiProvider: null }),
    );
    expect(view.statusText).toBe("AI: not reported");
    expect(view.showProviderLines).toBe(false);
    expect(view.providerUrl).toBeNull();
    expect(view.model).toBeNull();
  });

  it("hides provider lines when unsupported even if metadata lingers", () => {
    const view = resolveAiCard(
      aiInput({
        aiSupported: false,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
    );
    expect(view.showProviderLines).toBe(false);
    expect(view.providerUrl).toBeNull();
    expect(view.model).toBeNull();
  });

  it("never exposes the API key: the view carries only url/model strings", () => {
    const leaky = {
      ...aiInput({
        aiSupported: true,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
      apiKey: "sk-mock-secret-123",
    };
    const view = resolveAiCard(leaky);
    expect(JSON.stringify(view)).not.toContain("sk-mock-secret-123");
    expect(JSON.stringify(view)).not.toContain("apiKey");
    expect(view.providerUrl).toBe("https://api.example.com/v1");
    expect(view.model).toBe("m-1");
  });
});
