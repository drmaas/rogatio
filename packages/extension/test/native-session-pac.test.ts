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
      ],
    },
  ],
};

describe("startNativeSession pacRoutes", () => {
  it("derives pacRoutes from literal-host body-rule sources only", async () => {
    const start = vi.fn(async (config: { pacRoutes: readonly string[] }) => {
      expect(config.pacRoutes).toEqual(["127.0.0.1"]);
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
});
