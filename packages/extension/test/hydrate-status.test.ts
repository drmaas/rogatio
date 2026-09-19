import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import { createDnrInstaller } from "../src/dnr.js";
import { createExtensionApplication } from "../src/service-worker.js";
import { chromeHeldInstaller, HEADER_BAND_ID } from "./dnr-harness.js";

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

describe("P3a projectState hydrate headers", () => {
  const headerProject: RogatioProject = {
    version: 1,
    name: "P3a header hydrate project",
    groups: [
      {
        id: "group-a",
        name: "Group A",
        origins: ["https://example.com"],
        rules: [
          {
            id: "rule-header-set",
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
            headerValue: "test",
          },
        ],
      },
    ],
  };

  it("reports header active after cold installer restart without reinstall", async () => {
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
      generateId: () => "project-header-hydrate",
      now: () => 1,
    });

    expect(
      (
        await warmApp.handle({
          version: 1,
          command: "create-project",
          data: headerProject,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await warmApp.handle({
          version: 1,
          command: "select-project",
          projectId: "project-header-hydrate",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await warmApp.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-header-hydrate",
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
        ruleStatuses: [{ ruleId: "rule-header-set", status: "active" }],
      },
    });
    expect(harness.chromeIds()).toEqual([2_000_001]);

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
      generateId: () => "project-header-hydrate",
      now: () => 1,
    });

    const coldState = await coldApp.handle({
      version: 1,
      command: "get-state",
    });
    expect(coldState).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ ruleId: "rule-header-set", status: "active" }],
      },
    });
    expect(installSpy).not.toHaveBeenCalled();
  });
});

describe("P3a body stays native overlay", () => {
  const mixedProject: RogatioProject = {
    version: 1,
    name: "P3a mixed project",
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
            headerValue: "test",
          },
          {
            id: "rule-response-body",
            name: "Body rule",
            urlRegex: "^https://example\\.com/data$",
            origins: [],
            resourceTypes: ["xmlhttprequest"],
            priority: 100,
            method: "GET",
            type: "response-body",
            responseBody: {
              replacements: [{ pattern: "old", replacement: "new" }],
            },
          },
        ],
      },
    ],
  };

  it("installs headers via DNR installer and keeps body as needs runtime", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
    const installSpy = vi.spyOn(installer, "install");
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
      installer,
      nativeRuntime: {
        start: vi.fn(async () => ({ state: "stopped" as const })),
        stop: vi.fn(async () => ({ state: "stopped" as const })),
        status: vi.fn(async () => ({ state: "stopped" as const })),
        sendPolicy: vi.fn(async () => {}),
      },
      extensionId: "test-extension-id",
      generateId: () => "project-mixed",
      now: () => 1,
    });

    expect(
      (
        await app.handle({
          version: 1,
          command: "create-project",
          data: mixedProject,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "select-project",
          projectId: "project-mixed",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-mixed",
          groupId: "group-a",
          enabled: true,
        })
      ).ok,
    ).toBe(true);

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({ ok: true });
    const statuses =
      state.ok === true
        ? (
            state.value as {
              ruleStatuses: Array<{ ruleId: string; status: string }>;
            }
          ).ruleStatuses
        : [];
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "rule-header",
          status: "active",
        }),
        expect.objectContaining({
          ruleId: "rule-response-body",
          status: "needs runtime",
        }),
      ]),
    );
    for (const call of installSpy.mock.calls) {
      expect(
        (call[0] as readonly { kind: string }[]).every(
          (op) => op.kind !== "response-body" && op.kind !== "request-body",
        ),
      ).toBe(true);
    }
  });
});

describe("P3a set-group-enabled uses full desired DNR set", () => {
  const twoGroupProject: RogatioProject = {
    version: 1,
    name: "P3a two-group project",
    groups: [
      {
        id: "group-headers",
        name: "Headers",
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
            headerValue: "test",
          },
        ],
      },
      {
        id: "group-redirect",
        name: "Redirect",
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

  it("does not subset-install redirect-only and wipe already-installed headers", async () => {
    const harness = chromeHeldInstaller([]);
    const installer = createDnrInstaller(harness.api);
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
      installer,
      generateId: () => "project-two-group",
      now: () => 1,
    });

    expect(
      (
        await app.handle({
          version: 1,
          command: "create-project",
          data: twoGroupProject,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "select-project",
          projectId: "project-two-group",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await app.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-two-group",
          groupId: "group-headers",
          enabled: true,
        })
      ).ok,
    ).toBe(true);
    expect(harness.chromeIds()).toContain(HEADER_BAND_ID);

    const installSpy = vi.spyOn(installer, "install");
    expect(
      (
        await app.handle({
          version: 1,
          command: "set-group-enabled",
          projectId: "project-two-group",
          groupId: "group-redirect",
          enabled: true,
        })
      ).ok,
    ).toBe(true);

    expect(installSpy).toHaveBeenCalled();
    for (const call of installSpy.mock.calls) {
      const kinds = (call[0] as readonly { kind: string }[]).map(
        (operation) => operation.kind,
      );
      expect(kinds).toEqual(expect.arrayContaining(["header", "redirect"]));
    }
    expect(harness.chromeIds()).toContain(HEADER_BAND_ID);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: expect.arrayContaining([
          expect.objectContaining({
            ruleId: "rule-header",
            status: "active",
          }),
          expect.objectContaining({
            ruleId: "rule-redirect",
            status: "active",
          }),
        ]),
      },
    });
  });
});
