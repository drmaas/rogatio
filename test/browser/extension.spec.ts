import { expect, test } from "@playwright/test";

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
    };
    const runtime = {
      lastError: undefined,
      sendMessage(
        message: { command?: string },
        callback: (value: unknown) => void,
      ) {
        if (message.command === "start-native-runtime") {
          state.nativeRuntimeState = { phase: "failed" };
          callback({
            ok: false,
            diagnostic: { code: "extension.native-host-missing" },
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
  await expect(
    page.getByRole("button", { name: "Start runtime" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start runtime" }).click();
  await expect(
    page.getByText(/rogatio runtime install --extension-id/),
  ).toBeVisible();
  await expect(page.locator("[data-native-runtime-state]")).toContainText(
    "Runtime status: failed to start",
  );
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
                ruleId: "rule-mock",
                status: "needs proxy",
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
  const badge = page.locator("[data-badge-state]");
  await expect(badge).toContainText("needs permission: grant declared access");
  await expect(page.locator(".rogatio-attention-note")).toContainText(
    "Grant declared access",
  );

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(badge).toContainText("needs proxy: start runtime");
  await expect(badge).not.toContainText("needs permission");
  await expect(page.locator(".rogatio-attention-note")).toContainText(
    "Start runtime",
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
          ruleId: "rule-mock",
          status: "needs proxy",
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
  await expect(page.locator("[data-badge-state]")).toContainText(
    "rules failed to install",
  );
  await expect(page.locator(".rogatio-attention-note")).toContainText(
    "failed to install",
  );
});
