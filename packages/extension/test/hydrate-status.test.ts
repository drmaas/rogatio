import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createDnrInstaller } from "../src/dnr.js";
import { createExtensionApplication } from "../src/service-worker.js";
import { chromeHeldInstaller } from "./dnr-harness.js";

const redirectProject: RogatioProject = {
  version: 1,
  name: "P2 hydrate project",
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
      ],
    },
  ],
};

describe("P2 projectState hydrate → installedRuleIds", () => {
  it("reports redirect active after cold installer restart without reinstall", async () => {
    const harness = chromeHeldInstaller([]);
    let envelope: unknown;

    const warm = createDnrInstaller(harness.api);
    const warmApp = createExtensionApplication({
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
      installer: warm,
      generateId: () => "project-hydrate",
      now: () => 1,
    });

    expect(
      (
        await warmApp.handle({
          version: 1,
          command: "create-project",
          data: redirectProject,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await warmApp.handle({
          version: 1,
          command: "select-project",
          projectId: "project-hydrate",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await warmApp.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-hydrate",
          groupId: "group-a",
          enabled: true,
        })
      ).ok,
    ).toBe(true);

    const warmState = await warmApp.handle({
      version: 1,
      command: "get-state",
    });
    expect(warmState).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ ruleId: "rule-redirect", status: "active" }],
      },
    });
    expect(harness.chromeIds().length).toBeGreaterThan(0);

    // New installer instance = empty tracked (MV3 SW restart). Same Chrome +
    // index storage + project envelope.
    const cold = createDnrInstaller(harness.api);
    const installSpy = vi.spyOn(cold, "install");
    const coldApp = createExtensionApplication({
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
      installer: cold,
      generateId: () => "project-hydrate",
      now: () => 1,
    });

    const coldState = await coldApp.handle({
      version: 1,
      command: "get-state",
    });
    expect(coldState).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ ruleId: "rule-redirect", status: "active" }],
      },
    });
    expect(installSpy).not.toHaveBeenCalled();
  });
});
