import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import { createDnrInstaller } from "../src/dnr.js";
import { createExtensionApplication } from "../src/service-worker.js";
import { chromeHeldInstaller } from "./dnr-harness.js";

const mixedProject = {
  version: 1,
  name: "Grant flow project",
  groups: [
    {
      id: "group-a",
      name: "Group A",
      origins: ["https://example.com"],
      rules: [
        {
          id: "rule-redirect",
          name: "Redirect rule",
          urlRegex: "^https://example\\.com/(.*)$",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 100,
          type: "redirect",
          redirect: { destination: "https://other.com/\\1" },
        },
        {
          id: "rule-query",
          name: "Query rule",
          urlRegex: "^https://example\\.com/(.*)$",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 100,
          type: "query",
          action: {
            type: "query",
            params: [{ name: "marker", value: "1" }],
          },
        },
      ],
    },
  ],
} as const;

type StoredValue = {
  version: number;
  projects: Record<string, unknown>;
  activeProjectId: string | null;
};

function grantHarness(granted: boolean) {
  let containsGranted = granted;
  // Empty storage is `undefined`, matching the real chrome.storage.local read.
  const storageValue: { current: StoredValue | undefined } = {
    current: undefined,
  };
  const installedOps: RogatioOperation[] = [];
  const install = vi.fn(async (operations: readonly RogatioOperation[]) => {
    installedOps.length = 0;
    installedOps.push(...operations);
    return { ok: true as const };
  });
  const options = {
    storage: {
      read: async () => storageValue.current,
      compareAndSwap: async (previous: unknown, next: unknown) => {
        if (storageValue.current !== previous) return false;
        storageValue.current = next as StoredValue;
        return true;
      },
    },
    permissions: {
      contains: async () => containsGranted,
      request: vi.fn(async () => true),
      remove: async () => true,
    },
    installer: {
      current: async () => [...installedOps],
      install,
    },
    generateId: () => "project-g",
    now: () => 1,
  };
  const app = createExtensionApplication(options);
  return {
    app,
    install,
    installedOps,
    setGranted(value: boolean) {
      containsGranted = value;
    },
  };
}

async function prepare(app: ReturnType<typeof createExtensionApplication>) {
  const created = await app.handle({
    version: 1,
    command: "create-project",
    data: mixedProject,
  });
  expect(created).toMatchObject({ ok: true });
  const enabled = await app.handle({
    version: 1,
    command: "set-group-enabled",
    projectId: "project-g",
    groupId: "group-a",
    enabled: true,
  });
  expect(enabled).toMatchObject({ ok: true });
}

describe("grant moves installed rules and statuses with it", () => {
  it("installs no rules when the group activates before access is granted", async () => {
    const { app, install } = grantHarness(false);
    await prepare(app);

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          { ruleId: "rule-redirect", status: "needs permission" },
          { ruleId: "rule-query", status: "needs permission" },
        ],
      },
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("installs permitted rules immediately after granting declared access", async () => {
    const { app, install, installedOps, setGranted } = grantHarness(false);
    await prepare(app);

    // The page performs the real chrome.permissions.request first; the worker
    // then re-derives the actual grant state through permissions.contains.
    setGranted(true);
    const granted = await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-g",
      origins: ["https://example.com"],
      granted: true,
    });
    expect(granted).toMatchObject({ ok: true, value: { granted: true } });

    expect(install).toHaveBeenCalledTimes(1);
    expect(installedOps.map((operation) => operation.kind)).toEqual([
      "redirect",
      "query",
    ]);

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          { ruleId: "rule-redirect", status: "active" },
          { ruleId: "rule-query", status: "active" },
        ],
      },
    });
  });

  it("stops serving rules after revoking declared access", async () => {
    const { app, installedOps, setGranted } = grantHarness(false);
    await prepare(app);
    setGranted(true);
    await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-g",
      origins: ["https://example.com"],
      granted: true,
    });
    expect(installedOps.length).toBe(2);

    setGranted(false);
    const revoked = await app.handle({
      version: 1,
      command: "revoke-permission",
      projectId: "project-g",
      origins: ["https://example.com"],
    });
    expect(revoked).toMatchObject({ ok: true, value: { granted: false } });

    expect(installedOps.length).toBe(0);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          { ruleId: "rule-redirect", status: "needs permission" },
          { ruleId: "rule-query", status: "needs permission" },
        ],
      },
    });
  });

  it("installs when granting access on the active project", async () => {
    const { app, install, setGranted } = grantHarness(false);
    await prepare(app);

    setGranted(true);
    const granted = await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-g",
      origins: ["https://example.com"],
      granted: true,
    });
    expect(granted).toMatchObject({ ok: true });
    // Grant reconciles through state() → projectState (full desired set).
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("recognizes installed header rules through their project rule ids", async () => {
    const headerProject = {
      version: 1,
      name: "Header grant project",
      groups: [
        {
          id: "group-a",
          name: "Group A",
          origins: ["https://example.com"],
          rules: [
            {
              id: "rule-header",
              name: "Header rule",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              method: "GET",
              type: "header",
              headerDirection: "request",
              headerOperation: "set",
              headerName: "X-Custom-Header",
              headerValue: "test-value",
            },
            {
              id: "rule-header-remove",
              name: "Remove response header",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 101,
              method: "GET",
              type: "header",
              headerDirection: "response",
              headerOperation: "remove",
              headerName: "X-Test-Header",
            },
          ],
        },
      ],
    } as const;
    const harness = chromeHeldInstaller([]);
    let containsGranted = false;
    let envelope: unknown;
    const app = createExtensionApplication({
      storage: {
        read: async () => envelope,
        compareAndSwap: async (_expected: unknown, next: unknown) => {
          envelope = next;
          return true;
        },
      },
      permissions: {
        contains: async () => containsGranted,
        request: vi.fn(async () => true),
        remove: async () => true,
      },
      installer: createDnrInstaller(harness.api),
      generateId: () => "project-g",
      now: () => 1,
    });

    const created = await app.handle({
      version: 1,
      command: "create-project",
      data: headerProject,
    });
    expect(created).toMatchObject({ ok: true });
    const enabled = await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-g",
      groupId: "group-a",
      enabled: true,
    });
    expect(enabled).toMatchObject({ ok: true });

    const before = await app.handle({ version: 1, command: "get-state" });
    expect(before).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          { ruleId: "rule-header", status: "needs permission" },
          { ruleId: "rule-header-remove", status: "needs permission" },
        ],
      },
    });

    containsGranted = true;
    harness.updateDynamicRules.mockClear();
    const after = await app.handle({ version: 1, command: "get-state" });
    const addCalls = harness.updateDynamicRules.mock.calls.filter(
      (call) =>
        ((call[0] as { addRules: unknown[] }).addRules?.length ?? 0) > 0,
    );
    expect(addCalls.length).toBeGreaterThanOrEqual(2);
    const addedRules = addCalls.flatMap(
      (call) =>
        (
          call[0] as unknown as {
            addRules: Array<{
              action: {
                type: string;
                requestHeaders?: Array<{
                  operation: string;
                  value?: string;
                  header: string;
                }>;
                responseHeaders?: Array<{
                  operation: string;
                  value?: string;
                  header: string;
                }>;
              };
              condition: { requestMethods?: string[]; regexFilter?: string };
            }>;
          }
        ).addRules,
    );
    expect(addedRules).toHaveLength(2);
    expect(addedRules[0]?.condition).toMatchObject({
      requestMethods: ["get"],
      regexFilter: "^https://example\\.com/",
    });
    expect(addedRules[0]?.action.requestHeaders?.[0]).toMatchObject({
      operation: "set",
      value: "test-value",
    });
    // Chrome rejects an empty modify-header list, so the opposite direction's
    // list must be absent rather than empty on the rules actually submitted.
    expect(addedRules[0]?.action).not.toHaveProperty("responseHeaders");
    expect(addedRules[1]?.action).not.toHaveProperty("requestHeaders");
    // A remove action must omit value entirely; Chrome rejects an undefined
    // value in a modifyHeaders rule and rejects the whole atomic update.
    expect(addedRules[1]?.action.responseHeaders?.[0]).toEqual({
      header: "X-Test-Header",
      operation: "remove",
    });
    // Headers share the unified DNR installer; statuses use project rule ids.
    expect(after).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          { ruleId: "rule-header", status: "active" },
          { ruleId: "rule-header-remove", status: "active" },
        ],
      },
    });
  });

  it("marks failed header installs as error with extension.dnr-error reason", async () => {
    const headerProject = {
      version: 1,
      name: "Header error project",
      groups: [
        {
          id: "group-a",
          name: "Group A",
          origins: ["https://example.com"],
          rules: [
            {
              id: "rule-header-fail",
              name: "Header rule",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              method: "GET",
              type: "header",
              headerDirection: "request",
              headerOperation: "set",
              headerName: "X-Custom-Header",
              headerValue: "test-value",
            },
          ],
        },
      ],
    } as const;
    const harness = chromeHeldInstaller([]);
    harness.updateDynamicRules.mockImplementation(async () => {
      throw new Error("Rule with id 2000001 cannot have an empty list");
    });
    let envelope: unknown;
    const app = createExtensionApplication({
      storage: {
        read: async () => envelope,
        compareAndSwap: async (_expected: unknown, next: unknown) => {
          envelope = next;
          return true;
        },
      },
      permissions: {
        contains: async () => true,
        request: vi.fn(async () => true),
        remove: async () => true,
      },
      installer: createDnrInstaller(harness.api),
      generateId: () => "project-g",
      now: () => 1,
    });
    await app.handle({
      version: 1,
      command: "create-project",
      data: headerProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-g",
      groupId: "group-a",
      enabled: true,
    });

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          {
            ruleId: "rule-header-fail",
            status: "error",
            diagnostics: [
              {
                code: "extension.dnr-error",
                params: {
                  ruleId: "rule-header-fail",
                  reason: "Rule with id 2000001 cannot have an empty list",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("marks non-Error header install rejections as error with extension.dnr-error reason", async () => {
    const headerProject = {
      version: 1,
      name: "Header non-error project",
      groups: [
        {
          id: "group-a",
          name: "Group A",
          origins: ["https://example.com"],
          rules: [
            {
              id: "rule-header-fail",
              name: "Header rule",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              method: "GET",
              type: "header",
              headerDirection: "request",
              headerOperation: "set",
              headerName: "X-Custom-Header",
              headerValue: "test-value",
            },
          ],
        },
      ],
    } as const;
    const harness = chromeHeldInstaller([]);
    harness.updateDynamicRules.mockImplementation(async () => {
      throw "not-an-error";
    });
    let envelope: unknown;
    const app = createExtensionApplication({
      storage: {
        read: async () => envelope,
        compareAndSwap: async (_expected: unknown, next: unknown) => {
          envelope = next;
          return true;
        },
      },
      permissions: {
        contains: async () => true,
        request: vi.fn(async () => true),
        remove: async () => true,
      },
      installer: createDnrInstaller(harness.api),
      generateId: () => "project-g",
      now: () => 1,
    });
    await app.handle({
      version: 1,
      command: "create-project",
      data: headerProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-g",
      groupId: "group-a",
      enabled: true,
    });

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [
          {
            ruleId: "rule-header-fail",
            status: "error",
            diagnostics: [
              {
                code: "extension.dnr-error",
                params: {
                  ruleId: "rule-header-fail",
                  reason: "not-an-error",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("overlays extension.dnr-error on failed redirect sibling after partial success", async () => {
    const partialProject = {
      version: 1,
      name: "Partial DNR project",
      groups: [
        {
          id: "group-a",
          name: "Group A",
          origins: ["https://example.com"],
          rules: [
            {
              id: "rule-ok",
              name: "Redirect ok",
              urlRegex: "^https://example\\.com/(.*)$",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "redirect",
              redirect: { destination: "https://other.com/\\1" },
            },
            {
              id: "rule-fail",
              name: "Query fail",
              urlRegex: "^https://example\\.com/(.*)$",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "query",
              action: {
                type: "query",
                params: [{ name: "marker", value: "1" }],
              },
            },
          ],
        },
      ],
    } as const;
    const harness = chromeHeldInstaller([]);
    let adds = 0;
    harness.updateDynamicRules.mockImplementation(
      async (payload: {
        removeRuleIds: number[];
        addRules: Array<{ id: number }>;
      }) => {
        if ((payload.addRules?.length ?? 0) > 0) {
          adds += 1;
          if (adds > 1) {
            throw new Error("Chrome rejected query rule");
          }
        }
        const remove = new Set(payload.removeRuleIds);
        let chromeIds = harness.chromeIds().filter((id) => !remove.has(id));
        for (const rule of payload.addRules) {
          chromeIds = [...chromeIds, rule.id];
        }
        harness.setChromeIds(chromeIds);
      },
    );
    let envelope: unknown;
    const app = createExtensionApplication({
      storage: {
        read: async () => envelope,
        compareAndSwap: async (_expected: unknown, next: unknown) => {
          envelope = next;
          return true;
        },
      },
      permissions: {
        contains: async () => true,
        request: vi.fn(async () => true),
        remove: async () => true,
      },
      installer: createDnrInstaller(harness.api),
      generateId: () => "project-partial",
      now: () => 1,
    });
    await app.handle({
      version: 1,
      command: "create-project",
      data: partialProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-partial",
      groupId: "group-a",
      enabled: true,
    });

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const statuses = (
      state.value as { ruleStatuses: Record<string, unknown>[] }
    ).ruleStatuses;
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "rule-ok", status: "active" }),
        expect.objectContaining({
          ruleId: "rule-fail",
          status: "error",
          diagnostics: [
            expect.objectContaining({
              code: "extension.dnr-error",
              params: {
                ruleId: "rule-fail",
                reason: "Chrome rejected query rule",
              },
            }),
          ],
        }),
      ]),
    );
  });
});
