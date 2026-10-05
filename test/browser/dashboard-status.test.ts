/**
 * Dashboard system-status surface (dashboard-runtime-ai §3).
 *
 * Covers the acceptance checks against `data-dashboard-section="system-status"`
 * hooks: placement above Start a project, Start/Stop flow, diagnostics +
 * error/recovery on failed/unsupported, AI states (needs-runtime → configured
 * enable flow, not-reported, not-configured, configured + provider/model),
 * Create-using-AI gate agreement, key absence, focus restore, and 360px
 * usability. Sidebar selectors are untouched: the dashboard card never uses
 * `data-card`.
 */
import { expect, test } from "./fixtures.js";

type AiCheck = {
  supported: boolean;
  reported: boolean;
  providerUrl?: string;
  model?: string;
  /**
   * Simulates a leaky transport. The real host never sends the key; the page
   * must never render it even if it arrives.
   */
  apiKey?: string;
};

type DashboardSeed = {
  nativeRuntimeState?: { phase: string };
  nativeRuntimeError?: string;
  aiCheck?: AiCheck;
  extensionId?: string;
  startFailure?: { code: string; reason: string };
};

function dashboardSeed(overrides: Partial<DashboardSeed> = {}): DashboardSeed {
  return {
    extensionId: "c".repeat(32),
    ...overrides,
  };
}

/**
 * Serialized by addInitScript, so it must not close over module bindings.
 */
function installDashboardMock(seed: DashboardSeed): void {
  const state = {
    version: 1,
    projects: {
      "project-a": {
        id: "project-a",
        name: "Project A",
        data: { version: 1, name: "Project A", groups: [] },
        revision: 1,
        enabledGroupIds: [],
        grantedOrigins: [],
      },
    },
    activeProjectId: "project-a",
    nativeRuntimeState: seed.nativeRuntimeState as
      | { phase: string }
      | undefined,
    nativeRuntimeError: seed.nativeRuntimeError as string | undefined,
    aiCheck: seed.aiCheck as AiCheck | undefined,
  };
  const extensionId = seed.extensionId ?? "";
  const startFailure = seed.startFailure as
    | { code: string; reason: string }
    | undefined;
  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: { get: async () => ({ rogatio: state }), set: async () => {} },
      },
      permissions: {
        contains: async () => false,
        request: async () => true,
        remove: async () => true,
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      runtime: {
        lastError: undefined,
        id: extensionId,
        sendMessage(
          message: { command?: string },
          callback: (value: unknown) => void,
        ) {
          if (message.command === "start-native-runtime") {
            if (startFailure) {
              state.nativeRuntimeState = { phase: "failed" };
              state.nativeRuntimeError = startFailure.reason;
              callback({
                ok: false,
                diagnostic: {
                  code: startFailure.code,
                  params: { reason: startFailure.reason },
                },
              });
              return;
            }
            state.nativeRuntimeState = { phase: "started" };
            state.nativeRuntimeError = undefined;
            callback({ ok: true, value: state });
            return;
          }
          if (message.command === "stop-native-runtime") {
            state.nativeRuntimeState = { phase: "stopped" };
            state.nativeRuntimeError = undefined;
            callback({ ok: true, value: state });
            return;
          }
          if (message.command === "check-ai-support") {
            callback({
              ok: true,
              value: state.aiCheck ?? { supported: false, reported: false },
            });
            return;
          }
          if (message.command === "diagnose-native-runtime") {
            callback({
              ok: true,
              value: {
                phase: state.nativeRuntimeState?.phase ?? "stopped",
                extensionId,
                hostName: "com.rogatio.runtime",
                chromeError: null,
                runtimeError: state.nativeRuntimeError ?? null,
                connectNativeAvailable: true,
                timestamp: Date.now(),
              },
            });
            return;
          }
          callback({ ok: true, value: state });
        },
        onMessage: { addListener() {} },
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    },
  });
}

async function openDashboard(page: import("./page.js").Page) {
  // Dashboard is the default tab: no Workspace click.
  await page.goto("/extension/index.html");
}

function systemStatus(page: import("./page.js").Page) {
  return page.locator('[data-dashboard-section="system-status"]');
}

function dashboardRuntime(page: import("./page.js").Page) {
  return systemStatus(page).locator('[data-dashboard-block="runtime"]');
}

function dashboardAi(page: import("./page.js").Page) {
  return systemStatus(page).locator('[data-dashboard-block="ai"]');
}

function createUsingAi(page: import("./page.js").Page) {
  return page.locator('[data-command="ai-generate"]');
}

test("dashboard shows System status above Start a project (AC1)", async ({
  page,
}) => {
  await page.addInitScript(installDashboardMock, dashboardSeed());
  await openDashboard(page);

  const status = systemStatus(page);
  await expect(status).toBeVisible();
  await expect(dashboardRuntime(page)).toBeVisible();
  await expect(dashboardAi(page)).toBeVisible();

  const placement = await page.evaluate(() => {
    const statusEl = document.querySelector(
      '[data-dashboard-section="system-status"]',
    );
    const createEl = document.querySelector(
      '[data-dashboard-section="create"]',
    );
    const projectsEl = document.querySelector(
      '[data-dashboard-section="projects"]',
    );
    if (!statusEl || !createEl || !projectsEl) return null;
    return {
      statusClass: statusEl.className,
      statusBeforeCreate:
        (statusEl.compareDocumentPosition(createEl) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
      createBeforeProjects:
        (createEl.compareDocumentPosition(projectsEl) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
      // The `data-card` hook is sidebar-only; the dashboard must not reuse it.
      sidebarHooks: statusEl.querySelectorAll("[data-card]").length,
    };
  });
  expect(placement).not.toBeNull();
  expect(placement?.statusClass).toContain("rogatio-dashboard-card");
  expect(placement?.statusBeforeCreate).toBe(true);
  expect(placement?.createBeforeProjects).toBe(true);
  expect(placement?.sidebarHooks).toBe(0);
});

test("dashboard Start/Stop flow updates status and stays on Dashboard (AC4)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
      },
    }),
  );
  await openDashboard(page);

  const runtime = dashboardRuntime(page);
  await expect(runtime.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: stopped",
  );
  const start = runtime.locator('[data-command="start-native-runtime"]');
  const stop = runtime.locator('[data-command="stop-native-runtime"]');
  await expect(start).toBeEnabled();
  await expect(stop).toBeDisabled();

  await start.click();
  await expect(runtime.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: running",
  );
  await expect(start).toBeDisabled();
  await expect(stop).toBeEnabled();

  await stop.click();
  await expect(runtime.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: stopped",
  );
  await expect(start).toBeEnabled();
  await expect(stop).toBeDisabled();

  // The refresh behind Start/Stop must not switch the view.
  const view = await page.evaluate(() =>
    document.querySelector(".rogatio-layout")?.getAttribute("data-view"),
  );
  expect(view).toBe("dashboard");
  await expect(systemStatus(page)).toBeVisible();
});

test("dashboard AI goes needs-runtime to Configured and gates Create using AI (AC2/AC3)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
      },
    }),
  );
  await openDashboard(page);

  const ai = dashboardAi(page);
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: needs runtime");
  await expect(createUsingAi(page)).toBeDisabled();

  await dashboardRuntime(page)
    .locator('[data-command="start-native-runtime"]')
    .click();

  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: Configured");
  await expect(ai.locator("[data-ai-provider]")).toHaveText(
    "Provider: https://api.example.com/v1",
  );
  await expect(ai.locator("[data-ai-model]")).toHaveText(
    "Model: example-model-1",
  );
  await expect(createUsingAi(page)).toBeEnabled();
});

test("dashboard AI shows not reported without provider lines (AC2)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      nativeRuntimeState: { phase: "started" },
      aiCheck: { supported: false, reported: false },
    }),
  );
  await openDashboard(page);

  const ai = dashboardAi(page);
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: not reported");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
  await expect(ai.locator("[data-ai-model]")).toHaveCount(0);
  await expect(createUsingAi(page)).toBeDisabled();
});

test("dashboard AI shows Not configured without provider lines (AC2)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      nativeRuntimeState: { phase: "started" },
      aiCheck: { supported: false, reported: true },
    }),
  );
  await openDashboard(page);

  const ai = dashboardAi(page);
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: Not configured");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
  await expect(ai.locator("[data-ai-model]")).toHaveCount(0);
  await expect(createUsingAi(page)).toBeDisabled();
});

test("dashboard AI renders partial metadata as not reported (AC2)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      nativeRuntimeState: { phase: "started" },
      // Supported but missing the model: non-conforming, never half-populated.
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
      },
    }),
  );
  await openDashboard(page);

  const ai = dashboardAi(page);
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: not reported");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
  await expect(ai.locator("[data-ai-model]")).toHaveCount(0);
  await expect(createUsingAi(page)).toBeDisabled();
});

test("dashboard AI keeps needs-runtime precedence over reported metadata (AC2)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
      },
    }),
  );
  await openDashboard(page);

  const ai = dashboardAi(page);
  await expect(ai.locator("[data-ai-status]")).toHaveText("AI: needs runtime");
  await expect(ai.locator("[data-ai-provider]")).toHaveCount(0);
  await expect(createUsingAi(page)).toBeDisabled();
});

test("dashboard never renders the API key (AC1)", async ({ page }) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      nativeRuntimeState: { phase: "started" },
      aiCheck: {
        supported: true,
        reported: true,
        providerUrl: "https://api.example.com/v1",
        model: "example-model-1",
        apiKey: "sk-dashboard-secret-456",
      },
    }),
  );
  await openDashboard(page);

  await expect(dashboardAi(page).locator("[data-ai-status]")).toHaveText(
    "AI: Configured",
  );
  await expect(page.locator("body")).not.toContainText(
    "sk-dashboard-secret-456",
  );
});

test("dashboard failed runtime shows diagnostics, error, and recovery (AC4)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      nativeRuntimeState: { phase: "failed" },
      nativeRuntimeError: "Native host has exited.",
    }),
  );
  await openDashboard(page);

  const runtime = dashboardRuntime(page);
  await expect(
    runtime.locator('[data-command="show-diagnostics"]'),
  ).toHaveCount(1);
  await expect(runtime.locator("[data-runtime-error]")).toContainText(
    "Native host has exited.",
  );
  await expect(runtime.locator("[data-runtime-recovery]")).toContainText(
    "install command",
  );
  // Failed is retryable: Start stays enabled, Stop stays disabled.
  await expect(
    runtime.locator('[data-command="start-native-runtime"]'),
  ).toBeEnabled();
  await expect(
    runtime.locator('[data-command="stop-native-runtime"]'),
  ).toBeDisabled();

  await runtime.locator('[data-command="show-diagnostics"]').click();
  await expect(
    page.getByRole("heading", { name: "Runtime Diagnostics" }),
  ).toBeVisible();
  await expect(
    page.locator(".rogatio-diag-value").filter({
      hasText: "Native host has exited.",
    }),
  ).toHaveCount(1);
});

test("dashboard failed start reports the error and offers recovery (AC4)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({
      startFailure: {
        code: "extension.native-host-missing",
        reason: "Native host manifest was not found",
      },
    }),
  );
  await openDashboard(page);

  await dashboardRuntime(page)
    .locator('[data-command="start-native-runtime"]')
    .click();

  const runtime = dashboardRuntime(page);
  await expect(runtime.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: failed to start",
  );
  await expect(runtime.locator("[data-runtime-error]")).toContainText(
    "Native host manifest was not found",
  );
  await expect(runtime.locator("[data-runtime-recovery]")).toBeVisible();
  await expect(
    runtime.locator('[data-command="show-diagnostics"]'),
  ).toHaveCount(1);
  const view = await page.evaluate(() =>
    document.querySelector(".rogatio-layout")?.getAttribute("data-view"),
  );
  expect(view).toBe("dashboard");
});

test("dashboard unsupported runtime shows diagnostics and recovery (AC4)", async ({
  page,
}) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({ nativeRuntimeState: { phase: "unsupported" } }),
  );
  await openDashboard(page);

  const runtime = dashboardRuntime(page);
  await expect(runtime.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: unavailable on this platform",
  );
  await expect(
    runtime.locator('[data-command="show-diagnostics"]'),
  ).toHaveCount(1);
  await expect(runtime.locator("[data-runtime-error]")).toHaveCount(0);
  await expect(runtime.locator("[data-runtime-recovery]")).toContainText(
    "cannot provide the capabilities",
  );
});

test("dashboard copies the extension ID through the shared handler (AC4)", async ({
  page,
}) => {
  await page.addInitScript(installDashboardMock, dashboardSeed());
  await openDashboard(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  const runtime = dashboardRuntime(page);
  await expect(runtime.locator("[data-extension-id]")).toContainText(
    `Extension ID: ${"c".repeat(32)}`,
  );
  await runtime.locator('[data-command="copy-extension-id"]').click();
  await expect(page.locator(".rogatio-status")).toContainText(
    "Extension ID copied",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "c".repeat(32),
  );
});

test("dashboard status lines are live regions (AC5)", async ({ page }) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({ nativeRuntimeState: { phase: "started" } }),
  );
  await openDashboard(page);

  const live = await page.evaluate(() => {
    const pick = (selector: string) => {
      const section = document.querySelector(
        '[data-dashboard-section="system-status"]',
      );
      const node = section?.querySelector(selector);
      if (!node) return null;
      return {
        live: node.getAttribute("aria-live"),
        role: node.getAttribute("role"),
      };
    };
    return {
      runtime: pick("[data-native-runtime-state]"),
      ai: pick("[data-ai-status]"),
    };
  });
  expect(live).toEqual({
    runtime: { live: "polite", role: "status" },
    ai: { live: "polite", role: "status" },
  });
});

test("dashboard focus returns to the dashboard control after re-render (AC5)", async ({
  page,
}) => {
  await page.addInitScript(installDashboardMock, dashboardSeed());
  await openDashboard(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  // Copy rebuilds the shell without changing phase, so the same control must
  // regain focus instead of focus falling to <body>. Poll the live
  // activeElement: the re-render replaces the node mid-assertion.
  const copy = dashboardRuntime(page).locator(
    '[data-command="copy-extension-id"]',
  );
  await copy.focus();
  await expect(copy).toBeFocused();
  await copy.click();
  await page.waitForCondition(async () =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-command") ===
        "copy-extension-id",
    ),
  );
});

test("dashboard stays usable at a 360px viewport (AC5)", async ({ page }) => {
  await page.addInitScript(
    installDashboardMock,
    dashboardSeed({ nativeRuntimeState: { phase: "started" } }),
  );
  await page.setViewportSize({ width: 360, height: 900 });
  await openDashboard(page);

  const overflow = await page.evaluate(() => {
    const status = document.querySelector(
      '[data-dashboard-section="system-status"]',
    );
    if (!status) return null;
    return {
      scrollWidth: status.scrollWidth,
      clientWidth: status.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });
  expect(overflow).not.toBeNull();
  if (overflow) {
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(
      overflow.docClientWidth + 1,
    );
  }
  await expect(systemStatus(page)).toBeVisible();
  await expect(
    dashboardRuntime(page).locator('[data-command="start-native-runtime"]'),
  ).toBeVisible();
});
