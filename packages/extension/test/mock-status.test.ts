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

interface MockConnection {
  readonly protocol: string;
  readonly port: number;
  readonly presetDigest: string;
  readonly mocks: readonly {
    readonly ruleId: string;
    readonly token: string;
  }[];
}

function harnessOptions(connection: MockConnection | null) {
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
    mockRuntime: {
      fetchConnection: vi.fn(async () => connection),
    },
    generateId: () => "project-a",
    now: () => 1,
  };
  return {
    options,
    install,
    fetchConnection: options.mockRuntime.fetchConnection,
  };
}

function harness(connection: MockConnection | null) {
  const { options, ...rest } = harnessOptions(connection);
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

describe("F13 mock projection", () => {
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

describe("F13 mock DNR translation", () => {
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

describe("F13 extension mock runtime status and check-and-connect", () => {
  it("reports enabled mock rules as needs proxy while the runtime is not connected", async () => {
    const { app } = harness(null);
    await prepareMockProject(app);
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "needs proxy" }],
        mockRuntimeState: { phase: "disconnected", lastCheck: null },
      },
    });
  });

  it("connects on check-mock-runtime and reports mock rules active", async () => {
    const connection: MockConnection = {
      protocol: "f13-v1",
      port: 8890,
      presetDigest: "sha256:abc",
      mocks: [{ ruleId: "rule-mock", token: "tok1" }],
    };
    const { app, install, fetchConnection } = harness(connection);
    await prepareMockProject(app);

    const result = await app.handle({
      version: 1,
      command: "check-mock-runtime",
      port: 8890,
    });
    expect(result).toMatchObject({ ok: true });
    expect(fetchConnection).toHaveBeenCalledWith(8890);
    expect(install).toHaveBeenCalled();
    const installed = install.mock.calls[0][0] as readonly RogatioOperation[];
    expect(installed.some((op) => op.kind === "mock")).toBe(true);

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "active" }],
        mockRuntimeState: {
          phase: "connected",
          lastCheck: { at: 1, ok: true },
        },
      },
    });
  });

  it("fails on an unreachable runtime, installs nothing, and keeps needs proxy", async () => {
    const { app, install } = harness(null);
    await prepareMockProject(app);

    const result = await app.handle({
      version: 1,
      command: "check-mock-runtime",
      port: 8890,
    });
    expect(result).toMatchObject({ ok: true });
    expect(install).not.toHaveBeenCalled();

    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        ruleStatuses: [{ status: "needs proxy" }],
        mockRuntimeState: {
          phase: "failed",
          lastCheck: { at: 1, ok: false },
        },
      },
    });
  });

  it("reports a stable error when connected but the runtime lacks a token for the rule", async () => {
    const connection: MockConnection = {
      protocol: "f13-v1",
      port: 8890,
      presetDigest: "sha256:abc",
      mocks: [],
    };
    const { app } = harness(connection);
    await prepareMockProject(app);

    await app.handle({ version: 1, command: "check-mock-runtime", port: 8890 });
    const state = await app.handle({ version: 1, command: "get-state" });
    expect(state).toMatchObject({
      ok: true,
      value: {
        mockRuntimeState: { phase: "connected", lastCheck: { ok: true } },
      },
    });
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
