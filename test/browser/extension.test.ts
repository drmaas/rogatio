import { expect, test } from "./fixtures.js";

test("keeps project selection separate from explicit switch", async ({
  page,
}) => {
  await page.addInitScript(() => {
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
        "project-b": {
          id: "project-b",
          name: "Project B",
          data: { version: 1, name: "Project B", groups: [] },
          revision: 1,
          enabledGroupIds: [],
          grantedOrigins: [],
        },
      },
      activeProjectId: "project-a",
    };
    const listeners: Array<
      (message: unknown, sendResponse: (value: unknown) => void) => void
    > = [];
    const runtime = {
      lastError: undefined,
      sendMessage(
        message: { command?: string; projectId?: string },
        callback: (value: unknown) => void,
      ) {
        if (message.command === "refresh" || message.command === "get-state")
          callback({ ok: true, value: state });
        else if (message.command === "switch-project") {
          if (message.projectId === undefined)
            throw new Error("missing project id");
          state.activeProjectId = message.projectId;
          callback({ ok: true, value: state });
        } else callback({ ok: true, value: state });
      },
      onMessage: {
        addListener(
          listener: (
            message: unknown,
            sendResponse: (value: unknown) => void,
          ) => void,
        ) {
          listeners.push(listener);
        },
      },
    };
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
        runtime,
      },
    });
  });
  await page.goto("/extension/index.html");
  await expect(page.getByRole("heading", { name: "Rogatio" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  const selector = page.getByLabel("Project to switch");
  await selector.selectOption("project-b");
  await expect(page.getByText("Selected Project B.")).toBeVisible();
  expect(await selector.inputValue()).toBe("project-b");
  await page.getByRole("button", { name: "Switch project" }).click();
  await expect(page.getByText("Project switched.")).toBeVisible();
});

test("reports an actionable message and failed status when the native host is missing", async ({
  page,
}) => {
  await page.addInitScript(() => {
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
      nativeRuntimeState: undefined as { phase: string } | undefined,
      nativeRuntimeError: undefined as string | undefined,
    };
    const runtime = {
      lastError: undefined,
      id: "a".repeat(32),
      sendMessage(
        message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        if (message.command === "start-native-runtime") {
          state.nativeRuntimeState = { phase: "failed" };
          state.nativeRuntimeError = "Native host manifest was not found";
          callback({
            ok: false,
            diagnostic: {
              code: "extension.native-host-missing",
              params: { reason: "Native host manifest was not found" },
            },
          });
        } else if (message.command === "diagnose-native-runtime") {
          callback({
            ok: true,
            value: {
              phase: "failed",
              extensionId: "a".repeat(32),
              hostName: "com.rogatio.runtime",
              chromeError: null,
              runtimeError: "Native host manifest was not found",
              connectNativeAvailable: true,
              timestamp: Date.now(),
            },
          });
        } else callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator("[data-ai-status]")).toContainText(
    "AI: needs runtime",
  );
  await expect(
    page.getByRole("button", { name: "Start runtime" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Stop runtime" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Start runtime" }).click();
  await expect(page.locator("[data-runtime-install-command]")).toHaveText(
    /rogatio runtime install --extension-id/,
  );
  // The page fills in its own browser-assigned extension ID, so the user
  // never has to hunt for it in chrome://extensions.
  await expect(page.locator("[data-runtime-install-command]")).toHaveText(
    `rogatio runtime install --extension-id ${"a".repeat(32)}`,
  );
  await expect(page.locator("[data-extension-id]")).toContainText(
    `Extension ID: ${"a".repeat(32)}`,
  );
  const copyInstallButton = page
    .locator("[data-runtime-guidance]")
    .getByRole("button", { name: "Copy install command" });
  await expect(copyInstallButton).toHaveText("⧉");
  await expect(copyInstallButton).toHaveAttribute(
    "title",
    "Copy install command",
  );
  await expect(
    page.locator(".rogatio-install-command").filter({
      has: page.locator("[data-runtime-install-command]"),
      hasText: "⧉",
    }),
  ).toHaveCount(1);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyInstallButton.click();
  await expect(page.locator(".rogatio-status")).toContainText(
    "Install command copied",
  );
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(
    `rogatio runtime install --extension-id ${"a".repeat(32)}`,
  );
  await expect(page.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: failed to start",
  );
  await expect(
    page.getByRole("button", { name: "Start runtime" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Stop runtime" }),
  ).toBeDisabled();
  await expect(page.locator("[data-runtime-guidance]")).toContainText(
    "Native host manifest was not found",
  );
  await page.getByRole("button", { name: "Copy extension ID" }).click();
  await expect(page.locator(".rogatio-status")).toContainText(
    "Extension ID copied",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "a".repeat(32),
  );
  await page.getByRole("button", { name: "Show diagnostics" }).click();
  await expect(
    page.getByRole("heading", { name: "Runtime Diagnostics" }),
  ).toBeVisible();
  await expect(
    page.locator(".rogatio-diag-value").filter({
      hasText: "Native host manifest was not found",
    }),
  ).toBeVisible();
});

test("shows AI needs runtime before start and ready after a successful start", async ({
  page,
}) => {
  await page.addInitScript(() => {
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
      nativeRuntimeState: undefined as { phase: string } | undefined,
    };
    const runtime = {
      lastError: undefined,
      id: "b".repeat(32),
      sendMessage(
        message: { command?: string; type?: string },
        callback: (value: unknown) => void,
      ) {
        if (message.command === "start-native-runtime") {
          state.nativeRuntimeState = { phase: "started" };
          callback({ ok: true, value: state });
        } else if (message.type === "ai.complete") {
          callback({
            protocol: "v1",
            type: "ai.complete",
            timestamp: Date.now(),
            metadata: { content: "{}" },
          });
        } else callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator("[data-ai-status]")).toHaveText(
    "AI: needs runtime",
  );
  await expect(
    page.getByRole("button", { name: "Stop runtime" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Start runtime" }).click();
  await expect(page.locator("[data-ai-status]")).toHaveText("AI: Ready");
  await expect(
    page.getByRole("button", { name: "Start runtime" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Stop runtime" }),
  ).toBeEnabled();
});

test("keeps the platform-unavailable wording and truthful unsupported status", async ({
  page,
}) => {
  await page.addInitScript(() => {
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
      nativeRuntimeState: { phase: "unsupported" },
    };
    const runtime = {
      lastError: undefined,
      sendMessage(
        message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        if (message.command === "start-native-runtime")
          callback({
            ok: false,
            diagnostic: { code: "extension.native-runtime-unavailable" },
          });
        else callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Start runtime" }).click();
  await expect(
    page.getByText("Runtime action unavailable on this platform."),
  ).toBeVisible();
  await expect(page.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: unavailable on this platform",
  );
});

test("derives the attention reason from the actual rule statuses", async ({
  page,
}) => {
  await page.addInitScript(() => {
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
      badge: { text: "0", attention: true },
      ruleStatuses: [
        {
          groupId: "group-a",
          ruleId: "rule-redirect",
          status: "needs permission",
        },
      ],
    };
    let refreshes = 0;
    const runtime = {
      lastError: undefined,
      sendMessage(
        message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        if (message.command === "refresh") {
          refreshes += 1;
          if (refreshes > 1) {
            // After granting access with the runtime stopped, the real blocker
            // is the proxy runtime, not permissions.
            state.ruleStatuses = [
              {
                groupId: "group-a",
                ruleId: "rule-redirect",
                status: "unsupported",
              },
            ];
          }
        }
        callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  const badge = page.locator("[data-badge-state]");
  await expect(badge).toContainText("needs permission: grant declared access");
  await expect(page.locator(".rogatio-attention-note")).toContainText(
    "Grant declared access",
  );

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(badge).toContainText("attention needed");
  await expect(badge).not.toContainText("needs permission");
  await expect(page.locator(".rogatio-attention-note")).toContainText(
    "unsupported in this browser",
  );
});

test("reports the highest-precedence blocking status as the attention reason", async ({
  page,
}) => {
  await page.addInitScript(() => {
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
      badge: { text: "0", attention: true },
      ruleStatuses: [
        {
          groupId: "group-a",
          ruleId: "rule-response-body",
          status: "unsupported",
        },
        {
          groupId: "group-a",
          ruleId: "rule-redirect",
          status: "error",
        },
      ],
    };
    const runtime = {
      lastError: undefined,
      sendMessage(
        _message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator("[data-badge-state]")).toContainText(
    "rules failed to install",
  );
  await expect(page.locator(".rogatio-attention-note")).toContainText(
    "failed to install",
  );
});

const RULE_ERROR_REASON_FALLBACK = "The rule failed to install.";
const DNR_ERROR_MESSAGE = "The declarativeNetRequest operation failed.";

async function installExtensionChromeMock(
  page: import("./page.js").Page,
  initialState: Record<string, unknown>,
) {
  await page.addInitScript((seed) => {
    const state = structuredClone(seed);
    const runtime = {
      lastError: undefined,
      sendMessage(
        _message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  }, initialState);
}

const errorSurfaceProject = {
  version: 1,
  projects: {
    "project-a": {
      id: "project-a",
      name: "Project A",
      data: {
        version: 1,
        name: "Project A",
        groups: [
          {
            id: "group-a",
            name: "Group A",
            origins: ["https://example.com"],
            rules: [
              {
                id: "rule-one",
                name: "Rule one",
                urlRegex: "^https://example\\.com/",
                origins: [],
                resourceTypes: ["main_frame"],
                priority: 100,
                type: "redirect",
                redirectUrl: "https://example.com/next",
              },
            ],
          },
        ],
      },
      revision: 1,
      enabledGroupIds: ["group-a"],
      grantedOrigins: ["https://example.com"],
    },
  },
  activeProjectId: "project-a",
  badge: { text: "1", attention: true },
};

async function openWorkspace(page: import("./page.js").Page) {
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
}

test("renders the DNR error reason in the rule error card", async ({
  page,
}) => {
  await installExtensionChromeMock(page, {
    ...errorSurfaceProject,
    ruleStatuses: [
      {
        groupId: "group-a",
        ruleId: "rule-one",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: {
              ruleId: "rule-one",
              reason: "Rule with id 2000001 cannot have an empty list",
            },
          },
        ],
      },
    ],
  });
  await openWorkspace(page);
  const card = page.locator("[data-rule-error-card]");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("group-a/rule-one");
  await expect(card).toContainText(
    "Rule with id 2000001 cannot have an empty list",
  );
  await expect(
    page.getByRole("button", {
      name: "Show error details for group-a/rule-one",
    }),
  ).toBeVisible();
  await expect(page.locator("[data-rule-statuses] li")).toHaveText(
    "group-a/rule-one: error",
  );
});

test("falls back to the stable diagnostic message when params.reason is absent", async ({
  page,
}) => {
  await installExtensionChromeMock(page, {
    ...errorSurfaceProject,
    ruleStatuses: [
      {
        groupId: "group-a",
        ruleId: "rule-one",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-one" },
          },
        ],
      },
    ],
  });
  await openWorkspace(page);
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    DNR_ERROR_MESSAGE,
  );
});

test("falls back to the page-owned constant when diagnostics are absent", async ({
  page,
}) => {
  await installExtensionChromeMock(page, {
    ...errorSurfaceProject,
    ruleStatuses: [
      {
        groupId: "group-a",
        ruleId: "rule-one",
        status: "error",
      },
    ],
  });
  await openWorkspace(page);
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    RULE_ERROR_REASON_FALLBACK,
  );
});

test("renders markup in the reason as literal text without creating elements", async ({
  page,
}) => {
  const markup = '<img src=x onerror="alert(1)">';
  await installExtensionChromeMock(page, {
    ...errorSurfaceProject,
    ruleStatuses: [
      {
        groupId: "group-a",
        ruleId: "rule-one",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-one", reason: markup },
          },
        ],
      },
    ],
  });
  await openWorkspace(page);
  const card = page.locator("[data-rule-error-card]");
  await expect(card).toContainText(markup);
  await expect(card.locator("img")).toHaveCount(0);
});

test("tolerates malformed, inherited, and throwing diagnostic payloads", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const inheritedReason = "inherited reason must not run";
    const proto = {
      code: "extension.dnr-error",
      message: inheritedReason,
      get params() {
        throw new Error("prototype params accessor");
      },
    };
    const inheritedDiagnostic = Object.create(proto);
    inheritedDiagnostic.params = {
      reason: inheritedReason,
    };
    const throwingDiagnostic: Record<string, unknown> = {};
    Object.defineProperty(throwingDiagnostic, "code", {
      enumerable: true,
      get() {
        throw new Error("throwing code accessor");
      },
    });
    const throwingParamsDiagnostic: Record<string, unknown> = {
      code: "extension.rule-install-failed",
      message: "throwing params message",
    };
    Object.defineProperty(throwingParamsDiagnostic, "params", {
      enumerable: true,
      get() {
        throw new Error("throwing params accessor");
      },
    });
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
      badge: { text: "0", attention: true },
      ruleStatuses: [
        {
          groupId: "group-a",
          ruleId: "rule-safe",
          status: "error",
          diagnostics: [
            "not-an-object",
            inheritedDiagnostic,
            throwingDiagnostic,
            throwingParamsDiagnostic,
            {
              code: "extension.dnr-error",
              message: "The declarativeNetRequest operation failed.",
              params: { ruleId: "rule-safe", reason: "safe own reason" },
            },
          ],
        },
      ],
    };
    const runtime = {
      lastError: undefined,
      sendMessage(
        _message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await openWorkspace(page);
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "safe own reason",
  );
  await expect(page.locator("[data-rule-error-card]")).not.toContainText(
    "inherited reason must not run",
  );
  expect(pageErrors).toEqual([]);
});

test("ignores an inherited params record when resolving the reason", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const proto = { params: { reason: "inherited reason must not run" } };
    const diagnostic = Object.create(proto);
    diagnostic.code = "extension.dnr-error";
    diagnostic.message = "The declarativeNetRequest operation failed.";
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
      badge: { text: "0", attention: true },
      ruleStatuses: [
        {
          groupId: "group-a",
          ruleId: "rule-one",
          status: "error",
          diagnostics: [diagnostic],
        },
      ],
    };
    const runtime = {
      lastError: undefined,
      sendMessage(
        _message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        callback({ ok: true, value: state });
      },
      onMessage: { addListener() {} },
    };
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
        runtime,
      },
    });
  });
  await openWorkspace(page);
  const card = page.locator("[data-rule-error-card]");
  await expect(card).toContainText(DNR_ERROR_MESSAGE);
  await expect(card).not.toContainText("inherited reason must not run");
});

test("keys the error card by group and rule id instead of merging equal reasons", async ({
  page,
}) => {
  const sharedReason = "Batch install failed for every header rule";
  await installExtensionChromeMock(page, {
    ...errorSurfaceProject,
    ruleStatuses: [
      {
        groupId: "group-a",
        ruleId: "rule-one",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-one", reason: sharedReason },
          },
        ],
      },
      {
        groupId: "group-b",
        ruleId: "rule-one",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-one", reason: sharedReason },
          },
        ],
      },
    ],
  });
  await openWorkspace(page);
  await expect(page.locator("[data-rule-error-card]")).toHaveCount(1);
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-a/rule-one",
  );
  await expect(page.locator("[data-rule-error-card]")).not.toContainText(
    "group-b/rule-one",
  );
  await expect(page.locator("[data-rule-statuses] li")).toHaveText([
    "group-a/rule-one: error",
    "group-b/rule-one: error",
  ]);
});

test("reconciles stale error selection after refresh and removes the card when errors clear", async ({
  page,
}) => {
  await page.addInitScript(
    (seed) => {
      const state = structuredClone(seed) as {
        ruleStatuses: Array<Record<string, unknown>>;
      };
      let refreshes = 0;
      const runtime = {
        lastError: undefined,
        sendMessage(
          message: { command?: string },
          callback: (value: unknown) => void,
        ) {
          if (message.command === "refresh") {
            refreshes += 1;
            if (refreshes > 1 && refreshes === 2) {
              state.ruleStatuses = [
                {
                  groupId: "group-b",
                  ruleId: "rule-two",
                  status: "error",
                  diagnostics: [
                    {
                      code: "extension.dnr-error",
                      message: "The declarativeNetRequest operation failed.",
                      params: { ruleId: "rule-two", reason: "second failure" },
                    },
                  ],
                },
              ];
            } else if (refreshes > 2) {
              state.ruleStatuses = [];
            }
          }
          callback({ ok: true, value: state });
        },
        onMessage: { addListener() {} },
      };
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          storage: {
            local: {
              get: async () => ({ rogatio: state }),
              set: async () => {},
            },
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
          runtime,
        },
      });
    },
    {
      ...errorSurfaceProject,
      ruleStatuses: [
        {
          groupId: "group-a",
          ruleId: "rule-one",
          status: "error",
          diagnostics: [
            {
              code: "extension.dnr-error",
              message: DNR_ERROR_MESSAGE,
              params: { ruleId: "rule-one", reason: "first failure" },
            },
          ],
        },
        {
          groupId: "group-b",
          ruleId: "rule-two",
          status: "error",
          diagnostics: [
            {
              code: "extension.dnr-error",
              message: DNR_ERROR_MESSAGE,
              params: { ruleId: "rule-two", reason: "second failure" },
            },
          ],
        },
      ],
    },
  );
  await openWorkspace(page);
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-a/rule-one",
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-b/rule-two",
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("[data-rule-error-card]")).toHaveCount(0);
});

const navigationErrorProject = {
  ...errorSurfaceProject,
  projects: {
    "project-a": {
      id: "project-a",
      name: "Project A",
      data: {
        version: 1,
        name: "Project A",
        groups: [
          {
            id: "group-a",
            name: "Group A",
            origins: ["https://example.com"],
            rules: [
              {
                id: "rule-one",
                name: "Rule one",
                urlRegex: "^https://example\\.com/a",
                origins: [],
                resourceTypes: ["main_frame"],
                priority: 100,
              },
            ],
          },
          {
            id: "group-b",
            name: "Group B",
            origins: ["https://example.com"],
            rules: [
              {
                id: "rule-two",
                name: "Rule two",
                urlRegex: "^https://example\\.com/b",
                origins: [],
                resourceTypes: ["main_frame"],
                priority: 100,
              },
            ],
          },
        ],
      },
      revision: 1,
      enabledGroupIds: ["group-a", "group-b"],
      grantedOrigins: ["https://example.com"],
    },
  },
};

test("activates the error link by keyboard and focuses the failing rule card", async ({
  page,
}) => {
  const reason = "Header batch install rejected";
  await installExtensionChromeMock(page, {
    ...navigationErrorProject,
    ruleStatuses: [
      {
        groupId: "group-b",
        ruleId: "rule-two",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-two", reason },
          },
        ],
      },
    ],
  });
  await openWorkspace(page);
  await expect(
    page.locator("[data-editor-root] [data-rogatio-editor]"),
  ).toBeVisible();
  const errorLink = page.getByRole("button", {
    name: "Show error details for group-b/rule-two",
  });
  await errorLink.focus();
  await expect(errorLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.locator('[data-editor-key="route:group:group-b"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#rogatio-rule-group-b-rule-two")).toBeFocused();
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-b/rule-two",
  );
  await expect(page.locator("[data-rule-error-card]")).toContainText(reason);
});

test("updates the error card without throwing when the rule card is missing", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const missingRuleReason =
    "Install failed for a rule no longer in the project";
  const missingGroupReason = "Install failed for an unknown group";
  await installExtensionChromeMock(page, {
    ...navigationErrorProject,
    ruleStatuses: [
      {
        groupId: "group-a",
        ruleId: "rule-missing",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-missing", reason: missingRuleReason },
          },
        ],
      },
      {
        groupId: "group-z",
        ruleId: "rule-one",
        status: "error",
        diagnostics: [
          {
            code: "extension.dnr-error",
            message: DNR_ERROR_MESSAGE,
            params: { ruleId: "rule-one", reason: missingGroupReason },
          },
        ],
      },
    ],
  });
  await openWorkspace(page);
  await page
    .getByRole("button", {
      name: "Show error details for group-a/rule-missing",
    })
    .click();
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-a/rule-missing",
  );
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    missingRuleReason,
  );
  expect(pageErrors).toEqual([]);
  await page
    .getByRole("button", {
      name: "Show error details for group-z/rule-one",
    })
    .click();
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    "group-z/rule-one",
  );
  await expect(page.locator("[data-rule-error-card]")).toContainText(
    missingGroupReason,
  );
  expect(pageErrors).toEqual([]);
});
