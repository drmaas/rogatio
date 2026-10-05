import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeRuntimeController } from "../src/lifecycle.js";

const source = {
  key: "url" as const,
  operator: "regex" as const,
  value: "^https://example\\.com/",
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rogatio-root-"));
  temporaryDirectories.push(directory);
  return directory;
}

function mockRule(id: string, mock: Record<string, unknown>) {
  return {
    id,
    name: id,
    source,
    resourceTypes: ["main_frame"],
    priority: 1,
    type: "mock",
    mock,
  };
}

function project() {
  return {
    version: 2,
    name: "mocks",
    groups: [
      {
        id: "g1",
        name: "Enabled",
        rules: [mockRule("r1", { status: 200, body: "from-rule" })],
      },
      {
        id: "g2",
        name: "Disabled",
        rules: [
          mockRule("r2", { status: 200, file: "payload.bin" }),
          mockRule("r3", { status: 200, body: "hidden" }),
        ],
      },
    ],
  };
}

async function setProject(
  metadata: Record<string, unknown> = {},
  projectData: unknown = project(),
) {
  const controller = createNativeRuntimeController({});
  const reply = await controller.handleEnvelope({
    type: "runtime.project.set",
    metadata: { project: projectData, ...metadata },
  });
  return { controller, reply };
}

async function tokens(controller: {
  handleEnvelope: (input: {
    type: "mock.connect";
    metadata: Record<string, unknown>;
  }) => Promise<{
    metadata: { mocks?: readonly { ruleId: string; token: string }[] };
  }>;
}) {
  const connect = await controller.handleEnvelope({
    type: "mock.connect",
    metadata: {},
  });
  return connect.metadata.mocks ?? [];
}

describe("runtime.project.set mock presets", () => {
  it("builds mocks for every group when enablement is omitted", async () => {
    const first = await setProject();
    const second = await setProject();
    expect(first.reply.metadata.ok).toBe(true);
    expect(second.reply.metadata.presetDigest).toBe(
      first.reply.metadata.presetDigest,
    );
    const firstTokens = await tokens(first.controller);
    const secondTokens = await tokens(second.controller);
    expect(firstTokens.map((mock) => mock.ruleId).sort()).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(firstTokens.map((mock) => mock.token)).not.toEqual(
      secondTokens.map((mock) => mock.token),
    );
    expect(first.reply.metadata.presetDigest).toBe(
      second.reply.metadata.presetDigest,
    );
  });

  it("gives a disabled group no token", async () => {
    const { controller, reply } = await setProject({
      enabledGroupIds: ["g1"],
    });
    expect(reply.metadata.ok).toBe(true);
    const issued = await tokens(controller);
    expect(issued.map((mock) => mock.ruleId)).toEqual(["r1"]);
  });

  it("rejects unknown, duplicate, and malformed group ids", async () => {
    const cases = [["g1", "g1"], ["missing"], [1], "g1", ["g1", "g1", "g1"]];
    for (const enabledGroupIds of cases) {
      const { reply } = await setProject({ enabledGroupIds });
      expect(reply.metadata).toMatchObject({
        ok: false,
        error: "runtime.groups-invalid",
      });
    }
  });

  it("rejects a relative, missing, or non-directory root", async () => {
    const directory = await makeDirectory();
    const filePath = join(directory, "not-a-directory");
    await writeFile(filePath, "x");
    const cases = ["relative/dir", join(directory, "missing"), filePath];
    for (const fileRoot of cases) {
      const { reply } = await setProject({ fileRoot });
      expect(reply.metadata).toMatchObject({
        ok: false,
        error: "runtime.root-invalid",
      });
    }
  });

  it("does not read a file from the process working directory when no root is set", async () => {
    const previous = process.cwd();
    const directory = await makeDirectory();
    process.chdir(directory);
    try {
      await writeFile(join(directory, "payload.bin"), "from-cwd");
      const { controller, reply } = await setProject({
        enabledGroupIds: ["g2"],
      });
      expect(reply.metadata.ok).toBe(true);
      const issued = await tokens(controller);
      const fileToken = issued.find((mock) => mock.ruleId === "r2")?.token;
      expect(fileToken).toBeDefined();
      const rendered = await controller.serveMock(fileToken ?? "");
      expect(rendered).toEqual({
        ok: false,
        error: { code: "runtime.file-denied" },
      });
      expect(JSON.stringify(rendered)).not.toContain("from-cwd");
      expect(JSON.stringify(rendered)).not.toContain(directory);
    } finally {
      process.chdir(previous);
    }
  });

  it("serves a file from the resolved root and not the working directory", async () => {
    const previous = process.cwd();
    const work = await makeDirectory();
    const root = await makeDirectory();
    const linked = join(work, "linked-root");
    await symlink(root, linked);
    process.chdir(work);
    try {
      await writeFile(join(work, "payload.bin"), "from-cwd");
      await writeFile(join(root, "payload.bin"), Uint8Array.from([0x00, 0xff]));
      const { controller } = await setProject({
        enabledGroupIds: ["g2"],
        fileRoot: linked,
      });
      const issued = await tokens(controller);
      const fileToken = issued.find((mock) => mock.ruleId === "r2")?.token;
      const rendered = await controller.serveMock(fileToken ?? "");
      expect(rendered.ok).toBe(true);
      if (rendered.ok) {
        expect(rendered.value.bodyBytes).toEqual(Uint8Array.from([0x00, 0xff]));
      }
    } finally {
      process.chdir(previous);
    }
  });

  it("rejects an unreadable root", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const directory = await makeDirectory();
    await chmod(directory, 0o000);
    const { reply } = await setProject({ fileRoot: directory });
    expect(reply.metadata).toMatchObject({
      ok: false,
      error: "runtime.root-invalid",
    });
  });
});
