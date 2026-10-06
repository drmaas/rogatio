import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSavedMockRoot,
  writeSavedMockRoot,
} from "../src/mock-root-config.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("device-local mock file root", () => {
  it("round-trips a root outside the project file and clears it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rogatio-mock-root-"));
    directories.push(directory);
    const projectPath = join(directory, "app.rogatio.json");
    await writeFile(projectPath, "{}\n");
    const env = { ROGATIO_CONFIG_DIR: join(directory, "config") };
    expect(await readSavedMockRoot(projectPath, env)).toBeUndefined();
    await writeSavedMockRoot(projectPath, join(directory, "mocks"), env);
    expect(await readSavedMockRoot(projectPath, env)).toBe(
      join(directory, "mocks"),
    );
    const projectText = await import("node:fs/promises").then((fs) =>
      fs.readFile(projectPath, "utf8"),
    );
    expect(projectText).not.toContain("mocks");
    await writeSavedMockRoot(projectPath, null, env);
    expect(await readSavedMockRoot(projectPath, env)).toBeUndefined();
  });

  it("ignores a hand-edited relative root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rogatio-mock-root-"));
    directories.push(directory);
    const projectPath = join(directory, "app.rogatio.json");
    await writeFile(projectPath, "{}\n");
    const configDir = join(directory, "config");
    await import("node:fs/promises").then(async (fs) => {
      await fs.mkdir(configDir);
      await fs.writeFile(
        join(configDir, "mock-roots.json"),
        JSON.stringify({ projects: { [projectPath]: "relative/mocks" } }),
      );
    });
    expect(
      await readSavedMockRoot(projectPath, { ROGATIO_CONFIG_DIR: configDir }),
    ).toBeUndefined();
  });

  it("ignores a hostile config file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rogatio-mock-root-"));
    directories.push(directory);
    const projectPath = join(directory, "app.rogatio.json");
    await writeFile(projectPath, "{}\n");
    const configDir = join(directory, "config");
    await import("node:fs/promises").then(async (fs) => {
      await fs.mkdir(configDir);
      await fs.writeFile(
        join(configDir, "mock-roots.json"),
        JSON.stringify({ projects: { [projectPath]: { path: "/tmp" } } }),
      );
    });
    expect(
      await readSavedMockRoot(projectPath, { ROGATIO_CONFIG_DIR: configDir }),
    ).toBeUndefined();
  });
});
