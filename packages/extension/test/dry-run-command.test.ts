import type { RogatioOperation } from "@rogatio/compiler";
import { describe, expect, it, vi } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const redirectProject = {
  version: 2,
  name: "Preview",
  groups: [
    {
      id: "ads",
      name: "Ads",
      rules: [
        {
          id: "old-path",
          name: "Old path",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/old/(.*)$",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
          method: "GET",
          type: "redirect",
          redirect: { destination: "https://example.com/new/$1" },
        },
      ],
    },
  ],
};

function harness() {
  let stored: unknown;
  let installedOps: RogatioOperation[] = [];
  const install = vi.fn(async (operations: readonly RogatioOperation[]) => {
    installedOps = [...operations];
    return { ok: true as const };
  });
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
      current: async () => installedOps,
      install,
    },
    generateId: () => "project-a",
    now: () => 1,
  });
  return { app, install };
}

describe("extension dry-run command", () => {
  it("returns a preview for the draft and does not install rules", async () => {
    const { app, install } = harness();
    const response = await app.handle({
      version: 1,
      command: "dry-run",
      project: redirectProject,
      cases: [
        {
          url: "https://example.com/old/path",
          method: "GET",
          resourceType: "main_frame",
        },
      ],
    });
    expect(install).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: true,
      value: {
        results: [
          {
            url: "https://example.com/old/path",
            matchedRuleCount: 1,
            rules: [
              {
                groupId: "ads",
                ruleId: "old-path",
                matched: true,
                actionPreview: {
                  kind: "redirect",
                  summary: "https://example.com/new/path",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("returns field diagnostics for an invalid draft", async () => {
    const { app } = harness();
    const response = await app.handle({
      version: 1,
      command: "dry-run",
      project: { version: 2, name: "", groups: [] },
      cases: [{ url: "https://example.com/" }],
    });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.diagnostic.code).toBe("extension.project-invalid");
    expect(response.diagnostics?.length).toBeGreaterThan(0);
    expect(response.diagnostics?.[0]).toMatchObject({
      severity: "error",
      path: expect.any(String),
      message: expect.any(String),
    });
  });

  it("rejects a payload that is not a project and cases", async () => {
    const { app } = harness();
    const response = await app.handle({
      version: 1,
      command: "dry-run",
      project: null,
      cases: "https://example.com/",
    });
    expect(response).toMatchObject({
      ok: false,
      diagnostic: { code: "extension.invalid-message" },
    });
  });
});
