import { describe, expect, it } from "vitest";
import { createExtensionApplication } from "../src/service-worker.js";

const project = {
  version: 2,
  name: "Mock preview",
  groups: [
    {
      id: "group-mock",
      name: "Mocks",
      rules: [
        {
          id: "rule-mock",
          name: "Inline mock",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "mock",
          mock: { status: 201, body: "ok" },
        },
      ],
    },
  ],
};

describe("extension dry-run mock preview", () => {
  it("returns the shared mock summary", async () => {
    let stored: unknown;
    const app = createExtensionApplication({
      storage: {
        read: async () => stored,
        compareAndSwap: async (previous, next) => {
          if (stored !== previous) return false;
          stored = next;
          return true;
        },
      },
      installer: {
        current: async () => [],
        install: async () => ({ ok: true as const }),
      },
    });
    const result = await app.handle({
      version: 1,
      command: "dry-run",
      project,
      cases: [
        {
          url: "https://example.com/",
          method: "GET",
          resourceType: "main_frame",
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [
          {
            rules: [{ actionPreview: { summary: "Mock 201 (inline body)" } }],
          },
        ],
      },
    });
  });
});
