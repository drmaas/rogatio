import { expect, test } from "@playwright/test";

type MockEnvelope = {
  version: number;
  projects: Record<
    string,
    {
      id: string;
      name: string;
      data: {
        version: number;
        name: string;
        groups: Array<{
          id: string;
          name: string;
          origins: string[];
          rules: Array<{
            id: string;
            name: string;
            urlRegex: string;
            origins: string[];
            resourceTypes: string[];
            priority: number;
          }>;
        }>;
      };
      revision: number;
      enabledGroupIds: string[];
      grantedOrigins: string[];
    }
  >;
  activeProjectId: string | null;
};

function defaultEnvelope(): MockEnvelope {
  return {
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
              id: "group-one",
              name: "One",
              origins: ["https://one.example"],
              rules: [
                {
                  id: "rule-one",
                  name: "First rule",
                  urlRegex: "^https://one\\.example/first$",
                  origins: [],
                  resourceTypes: ["main_frame"],
                  priority: 100,
                },
              ],
            },
          ],
        },
        revision: 1,
        enabledGroupIds: ["group-one"],
        grantedOrigins: ["https://one.example"],
      },
    },
    activeProjectId: "project-a",
  };
}

type ToggleMockSeed = {
  envelope: MockEnvelope;
  enabledSeed?: unknown;
  failEnabledWrites?: boolean;
};

/** Serialized by addInitScript — must not close over module bindings. */
function installToggleChromeMock(seed: ToggleMockSeed): void {
  const { envelope, enabledSeed, failEnabledWrites } = seed;
  const ROGATIO_KEY = "rogatio";
  const MATCH_LOGGING_ENABLED_KEY = "rogatio.matchLogging.enabled";
  const MATCH_LOGGING_INDEX_KEY = "rogatio.matchLogging.index";
  const store: Record<string, unknown> = {
    [ROGATIO_KEY]: envelope,
    [MATCH_LOGGING_INDEX_KEY]: {
      "100": { ruleId: "rule-one", kind: "redirect" },
    },
  };
  if (enabledSeed !== undefined) {
    store[MATCH_LOGGING_ENABLED_KEY] = enabledSeed;
  }

  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (keys?: string | string[] | Record<string, unknown>) => {
            if (typeof keys === "string") {
              return Object.hasOwn(store, keys) ? { [keys]: store[keys] } : {};
            }
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {};
              for (const key of keys) {
                if (Object.hasOwn(store, key)) result[key] = store[key];
              }
              return result;
            }
            return { ...store };
          },
          set: async (items: Record<string, unknown>) => {
            if (
              failEnabledWrites === true &&
              Object.hasOwn(items, MATCH_LOGGING_ENABLED_KEY)
            ) {
              throw new Error("storage unavailable");
            }
            for (const [key, value] of Object.entries(items)) {
              store[key] = value;
            }
          },
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
      runtime: {
        lastError: undefined,
        sendMessage(
          message: { command?: string; projectId?: string },
          callback: (value: unknown) => void,
        ) {
          if (message.command === "refresh" || message.command === "get-state")
            callback({ ok: true, value: envelope });
          else if (message.command === "switch-project") {
            envelope.activeProjectId = message.projectId ?? null;
            callback({ ok: true, value: envelope });
          } else callback({ ok: true, value: envelope });
        },
        onMessage: { addListener() {} },
      },
    },
  });

  Object.defineProperty(window, "__rogatioToggleStore", {
    configurable: true,
    value: store,
  });
}

async function readToggleStore(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const store = (
      window as unknown as { __rogatioToggleStore?: Record<string, unknown> }
    ).__rogatioToggleStore;
    return store ?? {};
  });
}

async function expectToggleBehavior(
  page: import("@playwright/test").Page,
  openWorkspace: boolean,
): Promise<void> {
  const checkbox = page.getByRole("checkbox", { name: "Match logging" });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();

  let store = await readToggleStore(page);
  expect(store.rogatio).toBeTruthy();
  expect(store["rogatio.matchLogging.index"]).toEqual({
    "100": { ruleId: "rule-one", kind: "redirect" },
  });
  expect(store["rogatio.matchLogging.enabled"]).toBeUndefined();

  await checkbox.uncheck();
  store = await readToggleStore(page);
  expect(store["rogatio.matchLogging.enabled"]).toBe(false);
  expect(store.rogatio).toBeTruthy();
  expect(store["rogatio.matchLogging.index"]).toEqual({
    "100": { ruleId: "rule-one", kind: "redirect" },
  });
  await expect(checkbox).not.toBeChecked();

  // Keyboard operability: space on the focused checkbox persists the same key.
  await checkbox.focus();
  await checkbox.press(" ");
  await expect(checkbox).toBeChecked();
  store = await readToggleStore(page);
  expect(store["rogatio.matchLogging.enabled"]).toBe(true);
  expect(store["rogatio.matchLogging.index"]).toEqual({
    "100": { ruleId: "rule-one", kind: "redirect" },
  });

  await page.reload();
  if (openWorkspace) {
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
  }
  await expect(
    page.getByRole("checkbox", { name: "Match logging" }),
  ).toBeChecked();
}

test("management sidebar Match logging toggle persists independently", async ({
  page,
}) => {
  await page.addInitScript(installToggleChromeMock, {
    envelope: defaultEnvelope(),
  });
  await page.goto("/extension/index.html");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expectToggleBehavior(page, true);
});

test("popup Match logging toggle persists independently", async ({ page }) => {
  await page.addInitScript(installToggleChromeMock, {
    envelope: defaultEnvelope(),
  });
  await page.goto("/extension/popup.html");
  await expectToggleBehavior(page, false);
});

test("renders unchecked when the stored enabled value is not a boolean", async ({
  page,
}) => {
  await page.addInitScript(installToggleChromeMock, {
    envelope: defaultEnvelope(),
    enabledSeed: "true",
  });
  await page.goto("/extension/popup.html");
  await expect(
    page.getByRole("checkbox", { name: "Match logging" }),
  ).not.toBeChecked();
});

test("popup toggle keeps the stored value across a re-render", async ({
  page,
}) => {
  await page.addInitScript(installToggleChromeMock, {
    envelope: defaultEnvelope(),
    enabledSeed: false,
  });
  await page.goto("/extension/popup.html");
  const checkbox = page.getByRole("checkbox", { name: "Match logging" });
  await expect(checkbox).not.toBeChecked();

  // Opening the create form re-renders the popup without a storage read.
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.locator("[data-create-form]")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Match logging" }),
  ).not.toBeChecked();
});

test("toggle reverts when the enabled key cannot be persisted", async ({
  page,
}) => {
  await page.addInitScript(installToggleChromeMock, {
    envelope: defaultEnvelope(),
    failEnabledWrites: true,
  });
  await page.goto("/extension/popup.html");
  const checkbox = page.getByRole("checkbox", { name: "Match logging" });
  await expect(checkbox).toBeChecked();

  // Not `uncheck()`: the control reverts itself, so the post-click state stays
  // checked and Playwright's own state assertion would fail for the wrong reason.
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  const store = await readToggleStore(page);
  expect(store["rogatio.matchLogging.enabled"]).toBeUndefined();
});
