import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editCommand } from "../src/commands/edit.js";
import { readProject, writeProject } from "../src/utils/file.js";

describe("edit command", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rogatio-edit-test-"));
    testFile = join(testDir, ".rogatio.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const validProject = {
    version: 1,
    name: "Test Project",
    groups: [],
  };

  it("creates new project file if not exists", async () => {
    const { exitCode, shutdown } = await editCommand([testFile], {
      launchBrowser: vi.fn().mockResolvedValue(false),
    });
    shutdown(); // Trigger shutdown immediately for test
    const code = await exitCode;
    expect(code).toBe(0);

    // File should be created with empty project
    const project = await readProject(testFile);
    expect(project).toEqual({
      version: 1,
      name: "",
      description: undefined,
      groups: [],
    });
  });

  it("reads existing project file", async () => {
    await writeProject(testFile, validProject);
    const { exitCode, shutdown } = await editCommand([testFile], {
      launchBrowser: vi.fn().mockResolvedValue(false),
    });
    shutdown();
    const code = await exitCode;
    expect(code).toBe(0);
  });

  it("rejects directory path", async () => {
    const { exitCode } = await editCommand([testDir], {
      launchBrowser: vi.fn().mockResolvedValue(false),
    });
    const code = await exitCode;
    expect(code).toBe(2);
  });

  it("uses cwd/.rogatio.json by default", async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      // Ensure default .rogatio.json exists for default cwd behavior
      await writeProject(join(testDir, ".rogatio.json"), validProject);
      const { exitCode, shutdown } = await editCommand([], {
        launchBrowser: vi.fn().mockResolvedValue(false),
      });
      shutdown();
      const code = await exitCode;
      expect(code).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("serves the editor page and @rogatio/editor bundle over HTTP", async () => {
    const fetched: { html: string; js: string } = { html: "", js: "" };
    const result = await editCommand([testFile], {
      launchBrowser: async (url) => {
        const serverUrl = url.replace("/editor.html", "");
        const htmlRes = await fetch(`${serverUrl}/editor.html`);
        fetched.html = await htmlRes.text();
        const jsRes = await fetch(`${serverUrl}/vendor/editor.js`);
        fetched.js = await jsRes.text();
        return true;
      },
    });

    expect(fetched.html).toContain('id="editor-root"');
    expect(fetched.html).toContain('type="importmap"');
    expect(fetched.html).toContain('"/vendor/editor.js"');
    expect(fetched.js).toContain("createEditor");

    result.shutdown();
    const code = await result.exitCode;
    expect(code).toBe(0);
  });
});
