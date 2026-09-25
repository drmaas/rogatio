import { describe, expect, it, vi } from "vitest";
import { startNativeSession } from "../src/native-session.js";

const bodyProject = {
  version: 1,
  name: "Body project",
  groups: [
    {
      id: "group-body",
      name: "Body group",
      origins: ["http://127.0.0.1:8080"],
      rules: [
        {
          id: "rule-response-body",
          name: "Rewrite",
          urlRegex: "^http://127\\.0\\.0\\.1:8080/data\\.json$",
          origins: [],
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
          urlRegex: "^http://127\\.0\\.0\\.1:8080/submit$",
          origins: [],
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

describe("startNativeSession pacOrigins", () => {
  it("derives pacOrigins from compiled body-rule matcher origins", async () => {
    const start = vi.fn(async (config: { pacOrigins: readonly string[] }) => {
      expect(config.pacOrigins).toEqual(["http://127.0.0.1:8080"]);
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
      getGrantedOrigins: async () => ["http://127.0.0.1:8080"],
    });
    expect(result.ok).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });
});
