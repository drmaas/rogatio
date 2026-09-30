import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importCommand } from "../src/commands/import.js";
import { cli } from "../src/index.js";

const exportJson = JSON.stringify([
  {
    objectType: "rule",
    id: "Redirect_home",
    name: "Search redirect",
    ruleType: "Redirect",
    status: "Active",
    pairs: [
      {
        source: {
          key: "Url",
          operator: "Equals",
          value: "https://www.google.com/",
        },
        destination: "https://www.bing.com/",
      },
    ],
  },
  {
    objectType: "rule",
    id: "Cancel_trackers",
    name: "Block trackers",
    ruleType: "Cancel",
    pairs: [
      {
        source: { key: "Url", operator: "Contains", value: "tracker.example" },
      },
    ],
  },
]);

describe("import requestly", () => {
  let testDir: string;
  let exportFile: string;
  let outFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-import-test-"));
    exportFile = join(testDir, "requestly.json");
    outFile = join(testDir, "project.rogatio.json");
    await writeFile(exportFile, exportJson);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes a verified project and lists the skipped rule", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCommand([
      "requestly",
      exportFile,
      "--out",
      outFile,
    ]);
    expect(code).toBe(0);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Imported 1, changed 0, skipped 1.");
    expect(output).toContain("Block trackers");
    expect(output).toContain(outFile);
    const written = JSON.parse(await readFile(outFile, "utf8")) as {
      version: number;
      groups: { rules: { name: string }[] }[];
    };
    expect(written.version).toBe(2);
    expect(written.groups[0]?.rules.map((rule) => rule.name)).toEqual([
      "Search redirect",
    ]);
    log.mockRestore();
  });

  it("refuses to overwrite an existing file without --merge", async () => {
    await importCommand(["requestly", exportFile, "--out", outFile]);
    const before = await readFile(outFile, "utf8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await importCommand([
      "requestly",
      exportFile,
      "--out",
      outFile,
    ]);
    expect(code).toBe(2);
    expect(error.mock.calls.join("\n")).toContain("--merge");
    expect(await readFile(outFile, "utf8")).toBe(before);
    error.mockRestore();
  });

  it("merges imported groups onto an existing project", async () => {
    await writeFile(
      outFile,
      JSON.stringify({
        version: 2,
        name: "Already here",
        description: "Keep me",
        groups: [
          {
            id: "local",
            name: "Local",
            rules: [
              {
                id: "local-rule",
                name: "Local rule",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/$",
                },
                resourceTypes: ["main_frame"],
                priority: 1,
                type: "redirect",
                redirect: { destination: "https://example.com/stay" },
              },
            ],
          },
        ],
      }),
    );
    const code = await importCommand([
      "requestly",
      exportFile,
      "--out",
      outFile,
      "--merge",
    ]);
    expect(code).toBe(0);
    const written = JSON.parse(await readFile(outFile, "utf8")) as {
      name: string;
      description: string;
      groups: { name: string; rules: { name: string }[] }[];
    };
    expect(written.name).toBe("Already here");
    expect(written.description).toBe("Keep me");
    expect(written.groups.map((group) => group.name)).toEqual([
      "Local",
      "Ungrouped",
    ]);
    expect(written.groups[0]?.rules[0]?.name).toBe("Local rule");
    expect(written.groups[1]?.rules[0]?.name).toBe("Search redirect");
  });

  it("prints a JSON report with the output path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCommand([
      "requestly",
      exportFile,
      "--out",
      outFile,
      "--json",
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      imported: number;
      skipped: number;
      outputPath: string;
    };
    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.outputPath).toBe(outFile);
    log.mockRestore();
  });

  it("exits 2 when the export cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await importCommand([
      "requestly",
      join(testDir, "missing.json"),
      "--out",
      outFile,
    ]);
    expect(code).toBe(2);
    expect(await readFile(outFile, "utf8").catch(() => "")).toBe("");
    error.mockRestore();
  });
});

describe("import help", () => {
  it("shows import help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await cli(["import", "--help"]);
    expect(code).toBe(0);
    expect(log.mock.calls.join("\n")).toContain("rogatio import requestly");
    log.mockRestore();
  });
});
