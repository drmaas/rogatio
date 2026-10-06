import { describe, expect, it, vi } from "vitest";
import { startNativeSession } from "../src/native-session.js";

const bodyProject = {
  version: 2,
  name: "Body project",
  groups: [
    {
      id: "group-body",
      name: "Body group",
      rules: [
        {
          id: "rule-response-body",
          name: "Rewrite",
          source: {
            key: "host",
            operator: "regex",
            value: "^127\\.0\\.0\\.1$",
          },
          resourceTypes: ["main_frame"],
          priority: 50,
          type: "response-body",
          responseBody: {
            replacements: [{ pattern: "old", replacement: "new" }],
          },
        },
        {
          id: "rule-request-body",
          name: "Replace",
          source: {
            key: "url",
            operator: "regex",
            value: "^http://127\\.0\\.0\\.1:8080/submit$",
          },
          resourceTypes: ["xmlhttprequest"],
          priority: 60,
          method: "POST",
          type: "request-body",
          requestBody: { mode: "replace", body: '{"replaced":true}' },
        },
        {
          id: "rule-response-prefix",
          name: "Rewrite capture path",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/data\\.json/([^/]+)",
          },
          resourceTypes: ["main_frame"],
          priority: 70,
          type: "response-body",
          responseBody: {
            replacements: [{ pattern: "old", replacement: "new" }],
          },
        },
      ],
    },
  ],
};

describe("startNativeSession pacRoutes", () => {
  it("steers request-body hosts and omits response-body rules", async () => {
    const start = vi.fn(async (config: { pacRoutes: readonly string[] }) => {
      expect(config.pacRoutes).toEqual(["steer:http://127.0.0.1:8080"]);
      return { state: "started" as const };
    });
    const result = await startNativeSession({
      extensionId: "ext",
      nativeRuntime: {
        start,
        stop: async () => ({ state: "stopped" }),
        status: async () => ({ state: "stopped" }),
        sendPolicy: async () => undefined,
        send: async (envelope) => {
          if (envelope.type === "runtime.project.set") {
            return {
              protocol: "v1",
              type: "runtime.project.set",
              timestamp: Date.now(),
              metadata: { ok: true, presetDigest: "sha256:x" },
            };
          }
          return {
            protocol: "v1",
            type: envelope.type,
            timestamp: Date.now(),
            metadata: { ok: true },
          };
        },
      },
      getProject: async () => ({
        data: bodyProject,
        enabledGroupIds: ["group-body"],
      }),
    });
    expect(result.ok).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });

  it("starts the listener for an enabled mock and installs one redirect plus the guard", async () => {
    const added: Array<{ id: number; action?: { type: string } }> = [];
    const start = vi.fn(
      async (config: {
        contentListener: boolean;
        pacRoutes: readonly string[];
      }) => {
        expect(config.contentListener).toBe(true);
        expect(config.pacRoutes).toEqual([]);
        return {
          state: "started" as const,
          proxy: { host: "127.0.0.1", port: 9 },
        };
      },
    );
    const result = await startNativeSession({
      extensionId: "ext",
      nativeRuntime: {
        start,
        stop: async () => ({ state: "stopped" }),
        status: async () => ({ state: "stopped" }),
        sendPolicy: async () => undefined,
        send: async (envelope) => {
          if (envelope.type === "mock.connect") {
            return {
              protocol: "v1",
              type: "mock.connect",
              timestamp: Date.now(),
              metadata: { mocks: [{ ruleId: "rule-mock", token: "abc" }] },
            };
          }
          return {
            protocol: "v1",
            type: envelope.type,
            timestamp: Date.now(),
            metadata: { ok: true, presetDigest: "sha256:abc" },
          };
        },
      },
      getProject: async () => ({
        data: {
          version: 2,
          name: "Mocks",
          groups: [
            {
              id: "g1",
              name: "G",
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
        },
        enabledGroupIds: ["g1"],
      }),
      bodyMarkers: {
        api: {
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined,
            },
          },
          declarativeNetRequest: {
            getSessionRules: async () => [],
            updateSessionRules: async (payload: {
              addRules?: Array<{ id: number; action?: { type: string } }>;
            }) => {
              added.push(...(payload.addRules ?? []));
            },
          },
        } as never,
        runtimeStripPathAvailable: false,
      },
    });
    expect(result.ok).toBe(true);
    expect(added.map((rule) => rule.action?.type).sort()).toEqual([
      "allow",
      "redirect",
    ]);
  });
});
