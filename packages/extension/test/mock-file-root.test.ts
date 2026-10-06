// @vitest-environment happy-dom
import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it, vi } from "vitest";
import {
  mockFileRootCommandValue,
  mockFileRootFieldError,
  renderMockFileRootControl,
} from "../src/mock-file-root-control.js";
import { createExtensionApplication } from "../src/service-worker.js";

const project: RogatioProject = {
  version: 2,
  name: "Mock project",
  groups: [
    {
      id: "group-mock",
      name: "Mock group",
      rules: [
        {
          id: "rule-mock",
          name: "Mock",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "mock",
          mock: { status: 200, body: "" },
        },
      ],
    },
  ],
};

describe("mock file root control", () => {
  it("shows the saved root and returns set and clear values", () => {
    const section = renderMockFileRootControl(document, {
      saved: "/var/mocks",
    });
    expect(
      section.querySelector("[data-mock-file-root-value]")?.textContent,
    ).toBe("/var/mocks");
    expect(
      section.querySelector("[data-command='pick-mock-file-root']"),
    ).toBeInstanceOf(HTMLButtonElement);
    const input = section.querySelector("[data-mock-file-root-input]");
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (input instanceof HTMLInputElement) input.value = "/var/other";
    expect(mockFileRootCommandValue(section, "set-mock-file-root")).toBe(
      "/var/other",
    );
    expect(mockFileRootCommandValue(section, "clear-mock-file-root")).toBe(
      null,
    );
    const choose = section.querySelector(
      "[data-command='pick-mock-file-root']",
    );
    const save = section.querySelector("[data-command='set-mock-file-root']");
    expect(choose?.nextElementSibling).not.toBe(input);
    expect(save?.parentElement).not.toBe(input?.parentElement);
  });

  it("shows an empty state when no root is saved", () => {
    const section = renderMockFileRootControl(document, {});
    expect(
      section.querySelector("[data-mock-file-root-value]")?.textContent,
    ).toBe("No folder set");
    const clear = section.querySelector(
      "[data-command='clear-mock-file-root']",
    );
    expect(clear).toBeInstanceOf(HTMLButtonElement);
    if (clear instanceof HTMLButtonElement) expect(clear.disabled).toBe(true);
  });

  it("rejects a relative path next to the field", () => {
    expect(mockFileRootFieldError("samples/basic")).toMatch(/full path/);
    expect(mockFileRootFieldError("/var/mocks")).toBeNull();
    const section = renderMockFileRootControl(document, {
      draft: "samples/basic",
      error: mockFileRootFieldError("samples/basic") ?? "",
    });
    expect(
      section.querySelector("[data-mock-file-root-error]")?.textContent,
    ).toMatch(/full path/);
  });
});

describe("mock file root storage", () => {
  it("round-trips the root, keeps it out of exports, and sends it to the host", async () => {
    let stored: unknown;
    const sent: Array<{ type: string; metadata: Record<string, unknown> }> = [];
    const app = createExtensionApplication({
      storage: {
        read: async () => stored,
        compareAndSwap: async (previous: unknown, next: unknown) => {
          if (stored !== previous) return false;
          stored = next;
          return true;
        },
      },
      installer: {
        current: async () => [],
        install: async () => ({ ok: true as const }),
      },
      nativeRuntime: {
        start: vi.fn(async () => ({
          state: "started" as const,
          proxy: { host: "127.0.0.1", port: 9 },
        })),
        stop: async () => ({ state: "stopped" as const }),
        status: async () => ({ state: "stopped" as const }),
        sendPolicy: async () => undefined,
        send: async (envelope) => {
          sent.push({ type: envelope.type, metadata: envelope.metadata });
          if (envelope.type === "mock.connect") {
            return {
              protocol: "v1" as const,
              type: "mock.connect",
              timestamp: 1,
              metadata: { mocks: [{ ruleId: "rule-mock", token: "tok" }] },
            };
          }
          return {
            protocol: "v1" as const,
            type: envelope.type,
            timestamp: 1,
            metadata: { ok: true, presetDigest: "sha256:abc" },
          };
        },
      },
      extensionId: "test-extension-id",
      chromeApi: {
        storage: {
          local: { get: async () => ({}), set: async () => undefined },
        },
        declarativeNetRequest: {
          getSessionRules: async () => [],
          updateSessionRules: async () => undefined,
        },
      } as never,
      generateId: () => "mock-project",
      now: () => 1,
    });

    await app.handle({ version: 1, command: "create-project", data: project });
    await app.handle({
      version: 1,
      command: "set-group-enabled",
      projectId: "mock-project",
      groupId: "group-mock",
      enabled: true,
    });
    const saved = await app.handle({
      version: 1,
      command: "set-mock-file-root",
      projectId: "mock-project",
      root: "/var/mocks",
    });
    expect(saved).toMatchObject({
      ok: true,
      value: { mockFileRoot: "/var/mocks" },
    });

    const exported = await app.handle({
      version: 1,
      command: "export-project",
      projectId: "mock-project",
    });
    expect(exported.ok).toBe(true);
    expect(JSON.stringify(exported)).not.toContain("/var/mocks");

    const importedProject = structuredClone(project);
    importedProject.name = "Imported project";
    const imported = await app.handle({
      version: 1,
      command: "import-project",
      data: importedProject,
      projectId: "imported-project",
    });
    expect(imported).toMatchObject({
      ok: true,
      value: { id: "imported-project" },
    });
    if (imported.ok && imported.value && typeof imported.value === "object") {
      expect(imported.value).not.toHaveProperty("mockFileRoot");
    }

    await app.handle({ version: 1, command: "start-native-runtime" });
    const projectSet = sent.find(
      (entry) => entry.type === "runtime.project.set",
    );
    expect(projectSet?.metadata.fileRoot).toBe("/var/mocks");

    const cleared = await app.handle({
      version: 1,
      command: "set-mock-file-root",
      projectId: "mock-project",
      root: null,
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok && cleared.value && typeof cleared.value === "object") {
      expect(cleared.value).not.toHaveProperty("mockFileRoot");
    }

    const relative = await app.handle({
      version: 1,
      command: "set-mock-file-root",
      projectId: "mock-project",
      root: "samples/basic",
    });
    expect(relative).toMatchObject({
      ok: false,
      diagnostic: {
        code: "extension.invalid-message",
        params: { reason: "relative" },
      },
    });
  });

  it("returns a folder chosen by the host without starting the runtime", async () => {
    const app = createExtensionApplication({
      storage: {
        read: async () => undefined,
        compareAndSwap: async () => true,
      },
      installer: {
        current: async () => [],
        install: async () => ({ ok: true as const }),
      },
      nativeRuntime: {
        start: vi.fn(async () => ({ state: "started" as const })),
        stop: async () => ({ state: "stopped" as const }),
        status: async () => ({ state: "stopped" as const }),
        sendPolicy: async () => undefined,
        send: async (envelope) => ({
          protocol: "v1" as const,
          type: envelope.type,
          timestamp: 1,
          metadata:
            envelope.type === "runtime.pick-directory"
              ? { ok: true, path: "/var/mocks" }
              : { ok: true },
        }),
      },
      extensionId: "test-extension-id",
      now: () => 1,
    });
    const picked = await app.handle({
      version: 1,
      command: "pick-mock-file-root",
    });
    expect(picked).toMatchObject({
      ok: true,
      value: { path: "/var/mocks" },
    });
    expect(app).toBeDefined();
  });
});
