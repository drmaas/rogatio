import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testCommand } from "../src/commands/test.js";

const mockPreviewProject = {
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

const MOCK_PREVIEW_SUMMARY = "Mock 201 (inline body)";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("rogatio test mock preview", () => {
  it("prints the shared mock summary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rogatio-mock-preview-"));
    directories.push(directory);
    const file = join(directory, "project.rogatio.json");
    await writeFile(file, JSON.stringify(mockPreviewProject));
    const output = await testCommand(
      [file, "--urls", "https://example.com/"],
      undefined,
      true,
    );
    expect(output).toContain(MOCK_PREVIEW_SUMMARY);
    expect(output).not.toContain("payload");
  });
});
