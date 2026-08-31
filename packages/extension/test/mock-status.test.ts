import type { MockOperation, RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import type { ChromeApi } from "../src/chrome.js";
import {
  createDnrInstaller,
  mockLoopProtectionRule,
  translateMockToDnr,
} from "../src/dnr.js";
import { projectMatchers } from "../src/projection.js";
import { createExtensionApplication } from "../src/service-worker.js";

const mockOp: MockOperation = {
  kind: "mock",
  groupId: "group-a",
  ruleId: "rule-mock",
  matcher: {
    urlRegex: { source: "^https://example\\.com/", flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame"],
    priority: 100,
  },
  mock: { status: 200, body: "hello" },
};

const mockProject = {
  version: 1,
  name: "Mock project",
  groups: [
    {
      id: "group-a",
      name: "Group A",
      origins: ["https://example.com"],
      rules: [
        {
          id: "rule-mock",
          name: "Mock rule",
          urlRegex: "^https://example\\.com/",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 100,
          type: "mock",
          mock: { status: 200, body: "hello" },
        },
      ],
    },
  ],
};

type MockConnectMetadata = {
  port?: number;
  mocks?: readonly { ruleId: string; token: string }[];
  error?: string;
};

function harnessOptions(
  mockConnect: (() => Promise<MockConnectMetadata>) | null,
) {
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
      contains: async () => true,
      request,
      remove: async () => true,
    },
    installer: {
      current: async () => installedOps,
      install,
    },
    nativeRuntime: {
      start: vi.fn(async () => ({ state: "started" as const })),
      stop: vi.fn(async () => ({ state: "stopped" as const })),
      status: vi.fn(async () => ({ state: "stopped" as const })),
      sendPolicy: vi.fn(async (_frames: Uint8Array[]) => {}),
      send:
        mockConnect === null
          ? undefined
          : vi.fn(async () => ({
              protocol: "v1" as const,
              type: "mock.connect",
              timestamp: 1,
              metadata: await mockConnect(),
            })),
    },
    extensionId: "test-extension-id",
    generateId: () => "project-a",
    now: () => 1,
  };
  return { options, install };
}

function harness(mockConnect: (() => Promise<MockConnectMetadata>) | null) {
  const { options, ...rest } = harnessOptions(mockConnect);
  return { app: createExtensionApplication(options), ...rest };
}

async function prepareMockProject(app: {
  handle(value: unknown): Promise<unknown>;
}) {
  await app.handle({
    version: 1,
    command: "create-project",
    data: mockProject,
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
}

describe(" mock projection", () => {
  it("projects a mock operation as installable with the matcher preserved", () => {
    const result = projectMatchers([mockOp]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1000001,
      groupId: "group-a",
      ruleId: "rule-mock",
      installable: true,
      matcher: mockOp.matcher,
    });
    expect(result[0]).not.toHaveProperty("dnrRule");
  });
});

describe(" mock DNR translation", () => {
  it("translates a mock operation to a DNR redirect rule at the mock URL", () => {
    const rule = translateMockToDnr(
      mockOp,
      42,
      "http://127.0.0.1:8890/mock/tok1",
    );
    expect(rule).toEqual({
      id: 42,
      priority: 100,
      action: {
        type: "redirect",
        redirect: { url: "http://127.0.0.1:8890/mock/tok1" },
      },
      condition: {
        regexFilter: "^https://example\\.com/",
        resourceTypes: ["main_frame"],
        initiatorDomains: ["example.com"],
      },
    });
  });

  it("builds a high-priority loop-protection allow rule for the mock URL substring", () => {
    const rule = mockLoopProtectionRule(8890);
    expect(rule).toMatchObject({
      action: { type: "allow" },
      condition: { urlFilter: "127.0.0.1:8890/mock/" },
    });
    expect(rule.priority).toBeGreaterThan(1_000_000);
  });

  it("installs mock DNR rules plus the allow rule through the installer", async () => {
    const updateDynamicRules = vi.fn(
      async (_payload: { removeRuleIds: number[]; addRules: unknown[] }) => {},
    );
    let storedIds: number[] = [];
    const getDynamicRules = vi.fn(async () => storedIds.map((id) => ({ id })));
    const api = {
      declarativeNetRequest: { updateDynamicRules, getDynamicRules },
    } as unknown as ChromeApi;
    const resolver = vi.fn(
      (operation: RogatioOperation) =>
        `http://127.0.0.1:8890/mock/${operation.ruleId === "rule-mock" ? "tok1" : "tok2"}`,
    );
    const installer = createDnrInstaller(api, { mockUrlResolver: resolver });

    const result = await installer.install([mockOp]);
    expect(result).toEqual({ ok: true });
    const payload = updateDynamicRules.mock.calls[0][0] as {
      removeRuleIds: number[];
      addRules: unknown[];
    };
    expect(payload.addRules).toHaveLength(2);
    const redirectRule = payload.addRules.find(
      (rule) =>
        (rule as { action: { type: string } }).action.type === "redirect",
    ) as { id: number; action: { redirect: { url: string } } };
    const allowRule = payload.addRules.find(
      (rule) => (rule as { action: { type: string } }).action.type === "allow",
    ) as { id: number; action: { type: string } };
    expect(redirectRule.action.redirect.url).toBe(
      "http://127.0.0.1:8890/mock/tok1",
    );
    expect(allowRule.action.type).toBe("allow");

    storedIds = payload.addRules.map((rule) => (rule as { id: number }).id);
    const current = await installer.current();
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(mockOp);
  });
});

describe(" extension mock rules under the unified native runtime", () => {
  it("reports enabled mock rules as needs proxy while the unified runtime is not started", async () => {
    const { app } = harness(null);
    await prepareMockProject(app);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "needs proxy" }],
        nativeRuntimeState: { phase: "stopped" },
      },
    });
  });

  it("starts the unified runtime and reports mock rules active", async () => {
    const { app } = harness(async () => ({
      port: 8890,
      mocks: [{ ruleId: "rule-mock", token: "tok1" }],
    }));
    await prepareMockProject(app);

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: { nativeRuntimeState: { phase: "started" } },
    });

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "active" }],
        nativeRuntimeState: { phase: "started" },
      },
    });
  });

  it("keeps mock rules needing the runtime when the host does not answer mock.connect", async () => {
    const { app } = harness(async () => {
      throw new Error("host disconnected");
    });
    await prepareMockProject(app);

    const started = await app.handle({
      version: 1,
      command: "start-native-runtime",
    });
    expect(started).toMatchObject({
      ok: true,
      value: { nativeRuntimeState: { phase: "started" } },
    });

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "needs proxy" }],
        nativeRuntimeState: { phase: "started" },
      },
    });
  });

  it("reports a stable mock-token error when the host has no token for the rule", async () => {
    const { app } = harness(async () => ({ port: 8890, mocks: [] }));
    await prepareMockProject(app);

    await app.handle({ version: 1, command: "start-native-runtime" });
    const state = await app.handle({ version: 1, command: "get-state" });
    const value = (state as { value: { ruleStatuses: unknown[] } }).value;
    const status = value.ruleStatuses[0] as {
      status: string;
      diagnostics?: readonly { code: string }[];
    };
    expect(status.status).toBe("error");
    expect(
      status.diagnostics?.some(
        (d) => d.code === "extension.mock-token-missing",
      ),
    ).toBe(true);
  });
});
