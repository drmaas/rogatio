import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";
import { project } from "./fixtures.js";

const queryProject = structuredClone(project);
queryProject.groups[0].rules[0].type = "query";
queryProject.groups[0].rules[0].action = {
  type: "query",
  params: [{ name: "utm_source", value: "rogatio" }],
};

function harnessOptions() {
  let stored: unknown;
  let installedOps: RogatioOperation[] = [];
  const install = vi.fn(async (operations: readonly RogatioOperation[]) => {
    installedOps = [...operations];
    return { ok: true as const };
  });
  const request = vi.fn(async () => true);
  const options = {
    storage: {
      read: async () => stored,
      compareAndSwap: async (previous: unknown, next: unknown) => {
        if (stored !== previous) return false;
        stored = next;
        return true;
      },
    },
    permissions: {
      contains: async () => false,
      request,
      remove: async () => true,
    },
    installer: {
      current: async () => installedOps,
      install,
    },
    generateId: () => "project-a",
    now: () => 1,
  };
  return { options, install, request, getStored: () => stored };
}

function harness() {
  const { options, ...rest } = harnessOptions();
  return { app: createExtensionApplication(options), ...rest };
}

describe("F7 extension application", () => {
  it("keeps selection separate from active project and never installs actionless matchers", async () => {
    const { app, install } = harness();
    const created = await app.handle({
      version: 1,
      command: "create-project",
      data: project,
    });
    expect(created.ok).toBe(true);

    const selected = await app.handle({
      version: 1,
      command: "select-project",
      projectId: "project-a",
    });
    expect(selected).toMatchObject({ ok: true });
    expect(install).not.toHaveBeenCalled();

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: { activeProjectId: "project-a" },
    });
  });

  it("rejects undeclared permission requests and keeps permission APIs untouched", async () => {
    const { app, request } = harness();
    await app.handle({ version: 1, command: "create-project", data: project });
    const result = await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-a",
      origins: ["https://other.example"],
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.invalid-origin" },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps group activation separate from permission requests", async () => {
    const { app, request, getStored } = harness();
    await app.handle({ version: 1, command: "create-project", data: project });
    const result = await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-a",
      groupId: "group-a",
      enabled: true,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { enabledGroupIds: ["group-a"] },
    });
    expect(request).not.toHaveBeenCalled();
    expect(getStored()).toMatchObject({
      projects: { "project-a": { enabledGroupIds: ["group-a"] } },
    });
  });

  it("reports enabled actionless rules as unsupported in state", async () => {
    const { options } = harnessOptions();
    const app = createExtensionApplication({
      ...options,
      permissions: {
        ...options.permissions,
        contains: async () => true,
      },
    });
    await app.handle({ version: 1, command: "create-project", data: project });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-a",
      groupId: "group-a",
      enabled: true,
    });
    const result = await app.handle({ version: 1, command: "get-state" });

    expect(result).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "unsupported" }] },
    });
  });

  it("installs enabled query rules after permissions are granted (F10/F18)", async () => {
    const { options, install } = harnessOptions();
    const app = createExtensionApplication({
      ...options,
      permissions: {
        ...options.permissions,
        contains: async () => true,
      },
    });
    await app.handle({
      version: 1,
      command: "create-project",
      data: queryProject,
    });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-a",
      groupId: "group-a",
      enabled: true,
    });
    await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-a",
      origins: ["https://example.com"],
    });
    const result = await app.handle({ version: 1, command: "get-state" });

    expect(result.ok).toBe(true);
    const value = result.ok ? result.value : undefined;
    expect(value).toBeDefined();
    const ruleStatuses = (value as { ruleStatuses: unknown[] }).ruleStatuses;
    expect(ruleStatuses).toBeDefined();
    expect(Array.isArray(ruleStatuses)).toBe(true);
    expect(ruleStatuses.length).toBeGreaterThan(0);
    expect((ruleStatuses[0] as { status: string }).status).toBe("active");
    expect(install).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ kind: "query" })]),
    );
  });

  it("returns statuses and clears the badge when the last project is removed", async () => {
    const { options } = harnessOptions();
    const badge = vi.fn(async () => {});
    const app = createExtensionApplication({ ...options, badge });
    await app.handle({ version: 1, command: "create-project", data: project });
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "disabled" }],
        badge: { text: "0", attention: false },
      },
    });

    await app.handle({
      version: 1,
      command: "remove-project",
      projectId: "project-a",
      confirm: true,
    });
    expect(badge).toHaveBeenLastCalledWith({ text: "", attention: false });
  });

  it("preserves committed state in conflict responses", async () => {
    const { options } = harnessOptions();
    const app = createExtensionApplication(options);
    await app.handle({ version: 1, command: "create-project", data: project });
    const result = await app.handle({
      version: 1,
      command: "save-project",
      projectId: "project-a",
      expectedRevision: 0,
      data: project,
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "conflict",
      diagnostic: { code: "extension.conflict" },
      current: { id: "project-a", revision: 1 },
    });
  });
});
