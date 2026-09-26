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
  const options = {
    storage: {
      read: async () => stored,
      compareAndSwap: async (previous: unknown, next: unknown) => {
        if (stored !== previous) return false;
        stored = next;
        return true;
      },
    },
    installer: {
      current: async () => installedOps,
      install,
    },
    generateId: () => "project-a",
    now: () => 1,
  };
  return { options, install, getStored: () => stored };
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

  it("rejects removed grant-permissions command", async () => {
    const { app } = harness();
    await app.handle({ version: 1, command: "create-project", data: project });
    const result = await app.handle({
      version: 1,
      command: "grant-permissions",
      projectId: "project-a",
      origins: ["https://other.example"],
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.invalid-message" },
    });
  });

  it("activates groups without permission requests", async () => {
    const { app, getStored } = harness();
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
    expect(getStored()).toMatchObject({
      projects: { "project-a": { enabledGroupIds: ["group-a"] } },
    });
  });

  it("reports enabled actionless rules as unsupported in state", async () => {
    const { app } = harness();
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

  it("installs enabled query rules with install-time host grant only", async () => {
    const { options, install } = harnessOptions();
    const application = createExtensionApplication(options);
    await application.handle({
      version: 1,
      command: "create-project",
      data: queryProject,
    });
    await application.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-a",
      groupId: "group-a",
      enabled: true,
    });
    const result = await application.handle({
      version: 1,
      command: "get-state",
    });

    expect(result.ok).toBe(true);
    expect(install).toHaveBeenCalled();
    const value = result.ok ? result.value : undefined;
    expect(value).toBeDefined();
    const statuses = (value as { ruleStatuses?: Array<{ status: string }> })
      .ruleStatuses;
    expect(statuses?.[0]?.status).toBe("active");
  });

  it("reports error for unprojectable host source", async () => {
    const badProject = structuredClone(queryProject);
    badProject.groups[0].rules[0].source = {
      key: "host",
      operator: "regex",
      value: "^.*\\.example\\.com$",
    };
    const { app } = harness();
    await app.handle({
      version: 1,
      command: "create-project",
      data: badProject,
    });
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
      value: {
        ruleStatuses: [
          expect.objectContaining({
            status: "error",
            diagnostics: [
              expect.objectContaining({
                code: "extension.source-unprojectable",
              }),
            ],
          }),
        ],
      },
    });
  });

  it("returns invalid-message for unknown commands", async () => {
    const { app } = harness();
    const result = await app.handle({
      version: 1,
      command: "review-permissions",
      projectId: "project-a",
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.invalid-message" },
    });
  });
});
