import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";
import { project } from "./fixtures.js";

function harness() {
  let stored: unknown;
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
      request: vi.fn(async () => true),
      remove: async () => true,
    },
    installer: {
      current: async () => [] as RogatioOperation[],
      install: vi.fn(async () => ({ ok: true as const })),
    },
    generateId: () => "project-a",
    now: () => 1,
  };
  return { app: createExtensionApplication(options), options };
}

describe("F21 popup data source (get-state envelope)", () => {
  it("exposes active project groups, enabled group ids, and per-rule statuses", async () => {
    const { app } = harness();
    await app.handle({ version: 1, command: "create-project", data: project });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-a",
      groupId: "group-a",
      enabled: true,
    });
    const state = await app.handle({ version: 1, command: "get-state" });

    expect(state.ok).toBe(true);
    const value = state.ok ? state.value : undefined;
    expect(value).toBeDefined();
    const envelope = value as {
      projects: Record<
        string,
        { data: { groups: unknown[] }; enabledGroupIds: string[] }
      >;
      activeProjectId: string;
      ruleStatuses: unknown[];
    };
    expect(envelope.activeProjectId).toBe("project-a");
    expect(Array.isArray(envelope.projects["project-a"].data.groups)).toBe(
      true,
    );
    expect(envelope.projects["project-a"].data.groups[0]).toMatchObject({
      id: "group-a",
      name: "Group A",
      rules: [expect.objectContaining({ id: "rule-a" })],
    });
    expect(envelope.projects["project-a"].enabledGroupIds).toEqual(["group-a"]);
    expect(Array.isArray(envelope.ruleStatuses)).toBe(true);
  });
});
