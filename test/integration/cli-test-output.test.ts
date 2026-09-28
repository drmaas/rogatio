import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCommand } from "../../packages/cli/src/commands/test.js";

const project = {
  version: 2,
  name: "CLI output project",
  groups: [
    {
      id: "group-ads",
      name: "Ad servers",
      rules: [
        {
          id: "rule-ads",
          name: "Block ad server",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://ads\\.example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 100,
        },
        {
          id: "rule-other",
          name: "Block tracker",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://tracker\\.example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 100,
        },
      ],
    },
  ],
};

const urls = "https://ads.example.com/a,https://tracker.example.com/b";

let dir = "";
let file = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rogatio-test-output-"));
  file = join(dir, "project.rogatio.json");
  await writeFile(file, `${JSON.stringify(project, null, 2)}\n`, "utf8");
});

afterAll(async () => {
  if (dir.length > 0) await rm(dir, { recursive: true, force: true });
});

describe("rogatio test output identifies rules by name", () => {
  it("prints a name-based rule line in human mode", async () => {
    const output = await testCommand([file, "--urls", urls], undefined, true);
    const text = String(output);
    expect(text).toContain("Block ad server: MATCHED");
    expect(text).toContain("Block tracker: MATCHED");
    // Ids are internal: the human line must not print them.
    expect(text).not.toContain("group-ads/rule-ads");
    expect(text).not.toContain("rule-ads:");
    expect(text).not.toContain("rule-other:");
  });

  it("keeps the JSON payload byte-identical to a pinned digest", async () => {
    const output = await testCommand(
      [file, "--urls", urls, "--json"],
      undefined,
      true,
    );
    // REQ-021 says the serialized payload did not change, so this pins a digest
    // of the exact bytes rather than checking a shape. Ids stay; no name field
    // was added; key order and formatting are unchanged.
    expect(createHash("sha256").update(String(output)).digest("hex")).toBe(
      // Recorded before the human-output change, from the same input.
      "b295bcc7b2569c1abd3d67ad5b166223b5aad054eec76d676be91305cc2f5750",
    );
  });

  it("keeps the JSON payload carrying ids and adds no name field", async () => {
    const output = await testCommand(
      [file, "--urls", urls, "--json"],
      undefined,
      true,
    );
    const parsed = JSON.parse(String(output)) as {
      results: Array<{ rules: Array<Record<string, unknown>> }>;
    };
    const rows = parsed.results.flatMap((result) => result.rules);
    const ids = rows.map((row) => `${row.groupId}/${row.ruleId}`);
    expect(ids).toContain("group-ads/rule-ads");
    expect(ids).toContain("group-ads/rule-other");
    expect(Object.keys(rows[0] ?? {})).not.toContain("name");
  });
});
