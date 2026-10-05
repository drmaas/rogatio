import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeRuntimeController } from "../src/lifecycle.js";
import {
  listMockFileErrors,
  MAX_MOCK_FILE_ERRORS,
  recordMockFileError,
} from "../src/mock-errors.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const source = {
  key: "url" as const,
  operator: "regex" as const,
  value: "^https://example\\.com/",
};

function project(file: string) {
  return {
    version: 2,
    name: "mocks",
    groups: [
      {
        id: "g1",
        name: "G",
        rules: [
          {
            id: "r1",
            name: "Mock",
            source,
            resourceTypes: ["main_frame"],
            priority: 1,
            type: "mock",
            mock: { status: 200, file },
          },
        ],
      },
    ],
  };
}

describe("mock file error map", () => {
  it("evicts the oldest rule when the cap is exceeded", () => {
    const errors = new Map<string, string>();
    for (let index = 0; index < MAX_MOCK_FILE_ERRORS + 1; index += 1) {
      recordMockFileError(errors, `rule-${index}`, "runtime.file-denied");
    }
    expect(errors.size).toBe(MAX_MOCK_FILE_ERRORS);
    expect(errors.has("rule-0")).toBe(false);
    expect(errors.has(`rule-${MAX_MOCK_FILE_ERRORS}`)).toBe(true);
    const listed = listMockFileErrors(errors);
    expect(listed[0]?.ruleId < listed[1]?.ruleId).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("/");
  });

  it("ignores a disconnect timeout", () => {
    const errors = new Map<string, string>();
    recordMockFileError(errors, "r1", "runtime.timeout");
    expect(errors.size).toBe(0);
  });
});

describe("runtime.status file errors", () => {
  it("records a file failure, clears it on a later read, and drops it on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "rogatio-mock-err-"));
    directories.push(root);
    const controller = createNativeRuntimeController({});
    const set = await controller.handleEnvelope({
      type: "runtime.project.set",
      metadata: { project: project("missing.bin"), fileRoot: root },
    });
    expect(set.metadata.ok).toBe(true);
    const connect = await controller.handleEnvelope({
      type: "mock.connect",
      metadata: {},
    });
    const token = (connect.metadata as { mocks: readonly { token: string }[] })
      .mocks[0]?.token;
    const failed = await controller.serveMock(token ?? "");
    expect(failed.ok).toBe(false);
    const status = await controller.handleEnvelope({
      type: "runtime.status",
      metadata: {},
    });
    const text = JSON.stringify(status.metadata);
    expect(text).toContain("runtime.file-denied");
    expect(text).toContain("r1");
    expect(text).not.toContain(root);
    expect(text).not.toContain("missing.bin");

    await writeFile(join(root, "missing.bin"), Uint8Array.of(1, 2, 3));
    const ok = await controller.serveMock(token ?? "");
    expect(ok.ok).toBe(true);
    const cleared = await controller.handleEnvelope({
      type: "runtime.status",
      metadata: {},
    });
    expect(cleared.metadata.mockFileErrors).toEqual([]);

    await rm(join(root, "missing.bin"));
    await controller.serveMock(token ?? "");
    const again = await controller.handleEnvelope({
      type: "runtime.status",
      metadata: {},
    });
    expect(JSON.stringify(again.metadata)).toContain("runtime.file-denied");
    await controller.stop();
    await controller.start();
    const restarted = await controller.handleEnvelope({
      type: "runtime.status",
      metadata: {},
    });
    expect(restarted.metadata.mockFileErrors).toEqual([]);
  });
});
