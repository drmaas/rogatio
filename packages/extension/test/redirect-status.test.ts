import { compileProject } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";
import { project as matcherProject } from "./fixtures.js";

const redirectProject: RogatioProject = {
  version: 1,
  name: "F9 redirect project",
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

function redirectHarness() {
  const compiled = compileProject(redirectProject);
  if (!compiled.ok) throw new Error("fixture compile failed");
  const installedOp = compiled.operations[0];
  const install = vi.fn(async () => ({ ok: true as const }));
  let stored: unknown;
  const options = {
    storage: {
      read: async () => stored,
      compareAndSwap: async (_expected: unknown, next: unknown) => {
        stored = next;
        return true;
      },
    },
    permissions: {
      contains: async () => true,
      request: vi.fn(async () => true),
      remove: async () => true,
    },
    installer: {
      current: async () => [installedOp],
      install,
    },
    generateId: () => "project-r",
    now: () => 1,
  };
  return { app: createExtensionApplication(options), options, install };
}

describe("F9 redirect status", () => {
  it("reports installed redirect rules as active", async () => {
    const { app } = redirectHarness();
    expect(
      (
        await app.handle({
          version: 1,
          command: "create-project",
          data: redirectProject,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "select-project",
          projectId: "project-r",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-r",
          groupId: "group-a",
          enabled: true,
        })
      ).ok,
    ).toBe(true);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "active" }] },
    });
  });

  it("reports enabled actionless rules as unsupported", async () => {
    let stored: unknown;
    const options = {
      storage: {
        read: async () => stored,
        compareAndSwap: async (_expected: unknown, next: unknown) => {
          stored = next;
          return true;
        },
      },
      permissions: {
        contains: async () => true,
        request: vi.fn(async () => true),
        remove: async () => true,
      },
      installer: {
        current: async () => [],
        install: vi.fn(async () => ({ ok: true as const })),
      },
      generateId: () => "project-a",
      now: () => 1,
    };
    const app = createExtensionApplication(options);
    expect(
      (
        await app.handle({
          version: 1,
          command: "create-project",
          data: matcherProject,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "select-project",
          projectId: "project-a",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-a",
          groupId: "group-a",
          enabled: true,
        })
      ).ok,
    ).toBe(true);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: { ruleStatuses: [{ status: "unsupported" }] },
    });
  });
});
