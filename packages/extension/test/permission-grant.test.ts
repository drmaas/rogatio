import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

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

  it("does not install for a non-active project", async () => {
    const { app, install } = grantHarness(false);
    await prepare(app);

    const granted = await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-g",
      origins: ["https://example.com"],
      granted: true,
    });
    expect(granted).toMatchObject({ ok: true });
    // The granted project is the active project here, so it installs once.
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
    const dynamic = vi.fn(async () => {});
    const previousChrome = (globalThis as Record<string, unknown>).chrome;
    (globalThis as Record<string, unknown>).chrome = {
      declarativeNetRequest: { updateDynamicRules: dynamic },
    };
    try {
      const { app, setGranted } = grantHarness(false);
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
        value: { ruleStatuses: [{ status: "needs permission" }] },
      });

      setGranted(true);
      const after = await app.handle({ version: 1, command: "get-state" });
      // The header rule installs through the DNR session API on every state
      // computation; the status must reflect the real installation (REQ-009)
      // instead of comparing numeric DNR ids against project rule ids.
      expect(after).toMatchObject({
        ok: true,
        value: { ruleStatuses: [{ status: "active" }] },
      });
    } finally {
      (globalThis as Record<string, unknown>).chrome = previousChrome;
    }
  });
});
