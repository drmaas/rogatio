import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const summary = "Mock 201 (inline body)";
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

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "rogatio-mock-preview-cli-"));
});

afterAll(async () => {
  if (directory.length > 0) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("built CLI mock preview", () => {
  it("prints the same summary rogatio test shares with dry-run", async () => {
    const file = join(directory, "project.rogatio.json");
    await writeFile(file, JSON.stringify(project));
    const cli = resolve(process.cwd(), "packages/cli/dist/node/index.js");
    const result = await execFileAsync(process.execPath, [
      cli,
      "test",
      file,
      "--urls",
      "https://example.com/",
    ]);
    expect(result.stdout).toContain(summary);
  });
});
