// @vitest-environment happy-dom
/**
 * Dashboard system-status surface (dashboard-runtime-ai §2, TDD).
 *
 * Covers the dashboard render contract before `renderOverview` wires it:
 * runtime phases, AI states with needs-runtime precedence, key absence,
 * shared disabled logic, textContent-only rendering, and live-region hooks.
 */
import { describe, expect, it } from "vitest";
import {
  createDashboardSystemStatus,
  type DashboardStatusInput,
} from "../src/dashboard-status.js";
import { runtimeControlDisabled } from "../src/runtime-controls.js";

function dashboardInput(
  overrides: Partial<DashboardStatusInput> = {},
): DashboardStatusInput {
  return {
    phase: "stopped",
    runtimeError: null,
    extensionId: "test-extension-id",
    aiSupported: false,
    aiStatusChecked: false,
    aiReported: false,
    aiProvider: null,
    ...overrides,
  };
}

function startButton(section: HTMLElement): HTMLButtonElement | null {
  return section.querySelector<HTMLButtonElement>(
    '[data-command="start-native-runtime"]',
  );
}

function stopButton(section: HTMLElement): HTMLButtonElement | null {
  return section.querySelector<HTMLButtonElement>(
    '[data-command="stop-native-runtime"]',
  );
}

describe("dashboard system-status section hook", () => {
  it("renders a dashboard-card section with the system-status hook above creation content", () => {
    const section = createDashboardSystemStatus(dashboardInput());
    expect(section.tagName).toBe("SECTION");
    expect(section.classList.contains("rogatio-dashboard-card")).toBe(true);
    expect(section.dataset.dashboardSection).toBe("system-status");
    expect(
      section.querySelector(".rogatio-dashboard-section-heading h3")
        ?.textContent,
    ).toBe("System status");
  });

  it("never reuses the sidebar-only data-card hooks", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "failed", runtimeError: "boom" }),
    );
    expect(section.querySelector("[data-card]")).toBeNull();
    expect(section.dataset.card).toBeUndefined();
  });

  it("keeps the runtime and AI blocks in dedicated dashboard blocks", () => {
    const section = createDashboardSystemStatus(dashboardInput());
    expect(
      section.querySelector('[data-dashboard-block="runtime"]'),
    ).not.toBeNull();
    expect(section.querySelector('[data-dashboard-block="ai"]')).not.toBeNull();
  });
});

describe("dashboard runtime phases", () => {
  it("enables Start and disables Stop when stopped", () => {
    const section = createDashboardSystemStatus(dashboardInput());
    expect(startButton(section)?.disabled).toBe(false);
    expect(stopButton(section)?.disabled).toBe(true);
    expect(
      section.querySelector("[data-native-runtime-state]")?.textContent,
    ).toBe("Runtime status: stopped");
    expect(
      section.querySelector('[data-command="show-diagnostics"]'),
    ).toBeNull();
    expect(section.querySelector("[data-runtime-error]")).toBeNull();
    expect(section.querySelector("[data-runtime-recovery]")).toBeNull();
  });

  it("treats a missing phase as stopped", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: undefined }),
    );
    expect(startButton(section)?.disabled).toBe(false);
    expect(stopButton(section)?.disabled).toBe(true);
    expect(
      section.querySelector("[data-native-runtime-state]")?.textContent,
    ).toBe("Runtime status: stopped");
  });

  it("disables Start and enables Stop when starting", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "starting" }),
    );
    expect(startButton(section)?.disabled).toBe(true);
    expect(stopButton(section)?.disabled).toBe(false);
    expect(
      section.querySelector("[data-native-runtime-state]")?.textContent,
    ).toBe("Runtime status: starting");
    expect(
      section.querySelector('[data-command="show-diagnostics"]'),
    ).toBeNull();
  });

  it("disables Start and enables Stop when started", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "started" }),
    );
    expect(startButton(section)?.disabled).toBe(true);
    expect(stopButton(section)?.disabled).toBe(false);
    expect(
      section.querySelector("[data-native-runtime-state]")?.textContent,
    ).toBe("Runtime status: running");
  });

  it("shows diagnostics, error, and recovery when failed", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "failed", runtimeError: "Native host exited." }),
    );
    expect(startButton(section)?.disabled).toBe(false);
    expect(stopButton(section)?.disabled).toBe(true);
    expect(
      section.querySelector("[data-native-runtime-state]")?.textContent,
    ).toBe("Runtime status: failed to start");
    expect(
      section.querySelector('[data-command="show-diagnostics"]'),
    ).not.toBeNull();
    expect(
      section.querySelector("[data-runtime-error]")?.textContent,
    ).toContain("Native host exited.");
    expect(section.querySelector("[data-runtime-recovery]")).not.toBeNull();
  });

  it("shows diagnostics, error, and recovery when unsupported", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "unsupported", runtimeError: "no host" }),
    );
    expect(
      section.querySelector('[data-command="show-diagnostics"]'),
    ).not.toBeNull();
    expect(section.querySelector("[data-runtime-error]")).not.toBeNull();
    expect(section.querySelector("[data-runtime-recovery]")).not.toBeNull();
  });

  it("hides diagnostics entry on error phase (failed/unsupported only)", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "error", runtimeError: "something broke" }),
    );
    expect(
      section.querySelector("[data-native-runtime-state]")?.textContent,
    ).toBe("Runtime status: error");
    expect(
      section.querySelector('[data-command="show-diagnostics"]'),
    ).toBeNull();
    expect(section.querySelector("[data-runtime-error]")).toBeNull();
    expect(section.querySelector("[data-runtime-recovery]")).toBeNull();
  });

  it("shares disabled logic with the sidebar path", () => {
    for (const phase of [
      "stopped",
      "starting",
      "started",
      "failed",
      "unsupported",
      "error",
      undefined,
    ] as const) {
      const expected = runtimeControlDisabled(phase);
      const section = createDashboardSystemStatus(dashboardInput({ phase }));
      expect(startButton(section)?.disabled).toBe(expected.start);
      expect(stopButton(section)?.disabled).toBe(expected.stop);
    }
  });

  it("always shows the extension ID row with a copy entry", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ extensionId: "abcdefghijklmnopabcdefghijklmnop" }),
    );
    expect(section.querySelector("[data-extension-id]")?.textContent).toContain(
      "abcdefghijklmnopabcdefghijklmnop",
    );
    expect(
      section.querySelector('[data-command="copy-extension-id"]'),
    ).not.toBeNull();
  });
});

describe("dashboard AI states", () => {
  it("gives needs-runtime precedence over reported provider metadata", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({
        phase: "stopped",
        aiSupported: false,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
    );
    expect(section.querySelector("[data-ai-status]")?.textContent).toBe(
      "AI: needs runtime",
    );
    expect(section.querySelector("[data-ai-provider]")).toBeNull();
    expect(section.querySelector("[data-ai-model]")).toBeNull();
  });

  it("renders Configured with provider/model lines when supported", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({
        phase: "started",
        aiSupported: true,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
    );
    expect(section.querySelector("[data-ai-status]")?.textContent).toBe(
      "AI: Configured",
    );
    expect(section.querySelector("[data-ai-provider]")?.textContent).toBe(
      "Provider: https://api.example.com/v1",
    );
    expect(section.querySelector("[data-ai-model]")?.textContent).toBe(
      "Model: m-1",
    );
  });

  it("renders not reported when checked but the host reported nothing", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({
        phase: "started",
        aiStatusChecked: true,
        aiReported: false,
      }),
    );
    expect(section.querySelector("[data-ai-status]")?.textContent).toBe(
      "AI: not reported",
    );
    expect(section.querySelector("[data-ai-provider]")).toBeNull();
  });

  it("renders Not configured when reported without support", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({
        phase: "started",
        aiStatusChecked: true,
        aiReported: true,
      }),
    );
    expect(section.querySelector("[data-ai-status]")?.textContent).toBe(
      "AI: Not configured",
    );
    expect(section.querySelector("[data-ai-provider]")).toBeNull();
  });

  it("treats partial metadata as not reported, never half-populated", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({
        phase: "started",
        aiStatusChecked: true,
        aiReported: false,
        aiProvider: null,
      }),
    );
    expect(section.querySelector("[data-ai-status]")?.textContent).toBe(
      "AI: not reported",
    );
    expect(section.querySelector("[data-ai-provider]")).toBeNull();
    expect(section.querySelector("[data-ai-model]")).toBeNull();
  });

  it("agrees with the Create using AI gate: disabled equals !aiSupported", () => {
    const configured = dashboardInput({
      phase: "started",
      aiSupported: true,
      aiStatusChecked: true,
      aiReported: true,
      aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
    });
    expect(!configured.aiSupported).toBe(false);
    expect(
      createDashboardSystemStatus(configured).querySelector("[data-ai-status]")
        ?.textContent,
    ).toBe("AI: Configured");

    const needsRuntime = dashboardInput({ phase: "stopped" });
    expect(!needsRuntime.aiSupported).toBe(true);
    expect(
      createDashboardSystemStatus(needsRuntime).querySelector(
        "[data-ai-status]",
      )?.textContent,
    ).toBe("AI: needs runtime");
  });

  it("never renders the API key even when the transport leaks it", () => {
    const leaky = {
      ...dashboardInput({
        phase: "started",
        aiSupported: true,
        aiStatusChecked: true,
        aiReported: true,
        aiProvider: { url: "https://api.example.com/v1", model: "m-1" },
      }),
      apiKey: "sk-mock-secret-123",
    };
    const section = createDashboardSystemStatus(leaky);
    expect(section.textContent).not.toContain("sk-mock-secret-123");
    expect(section.innerHTML).not.toContain("sk-mock-secret-123");
    expect(section.innerHTML).not.toContain("apiKey");
  });

  it("renders hostile provider strings as text, never as markup", () => {
    const hostile = '<img src="x" onerror="alert(1)">';
    const section = createDashboardSystemStatus(
      dashboardInput({
        phase: "failed",
        runtimeError: hostile,
        extensionId: "test-extension-id",
        aiSupported: false,
        aiStatusChecked: true,
        aiReported: false,
      }),
    );
    expect(section.querySelector("img")).toBeNull();
    expect(section.textContent).toContain(hostile);
  });
});

describe("dashboard status accessibility", () => {
  it("exposes polite live regions with status role on both status lines", () => {
    const section = createDashboardSystemStatus(
      dashboardInput({ phase: "started" }),
    );
    for (const selector of [
      "[data-native-runtime-state]",
      "[data-ai-status]",
    ] as const) {
      const line = section.querySelector(selector);
      expect(line?.getAttribute("aria-live")).toBe("polite");
      expect(line?.getAttribute("role")).toBe("status");
    }
  });
});
