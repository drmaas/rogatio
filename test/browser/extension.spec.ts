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
