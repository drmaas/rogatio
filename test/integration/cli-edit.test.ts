import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { editCommand } from "../../packages/cli/src/commands/edit.js";
import { readProject } from "../../packages/cli/src/utils/file.js";

const validProject = {
  version: 1,
  name: " edit project",
  groups: [],
};

describe(" real CLI edit server", () => {
  let temp: string | undefined;

  afterEach(async () => {
    if (temp) await rm(temp, { recursive: true, force: true });
    temp = undefined;
  });

  it("serves, validates, saves, and cancels over real HTTP", async () => {
    temp = await mkdtemp(join(tmpdir(), "rogatio-edit-"));
    const projectPath = join(temp, ".rogatio.json");
    await writeFile(projectPath, JSON.stringify(validProject));

    let serverUrl = "";
    const result = await editCommand([projectPath], {
      launchBrowser: async (url) => {
        serverUrl = url.replace(/\/editor\.html$/u, "");
        return false;
      },
    });

    try {
      const html = await (await fetch(`${serverUrl}/editor.html`)).text();
      expect(html).toContain('id="editor-root"');
      expect(html).toContain("/vendor/editor.js");
      const bundle = await (
        await fetch(`${serverUrl}/vendor/editor.js`)
      ).text();
      expect(bundle).toContain("createEditor");

      const projectResponse = await fetch(`${serverUrl}/api/project`);
      expect(projectResponse.status).toBe(200);
      expect(await projectResponse.json()).toEqual(validProject);

      const csrfMatch = html.match(/const csrfToken = '([^']+)'/u);
      expect(csrfMatch?.[1]).toBeTruthy();
      const csrf = csrfMatch?.[1] ?? "";

      const denied = await fetch(`${serverUrl}/api/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validProject),
      });
      expect(denied.status).toBe(403);

      const changed = { ...validProject, name: "Saved by" };
      const validation = await fetch(`${serverUrl}/api/validate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(changed),
      });
      expect(validation.status).toBe(200);
      expect((await validation.json()).diagnostics).toEqual([]);

      const saved = await fetch(`${serverUrl}/api/save`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(changed),
      });
      expect(saved.status).toBe(200);
      expect(await readProject(projectPath)).toEqual(changed);

      const cancelled = await fetch(`${serverUrl}/api/cancel`, {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        body: "{}",
      });
      expect(cancelled.status).toBe(200);
      await expect(result.exitCode).resolves.toBe(0);
      expect(await readFile(projectPath, "utf8")).toContain("Saved by");
    } finally {
      result.shutdown();
      await result.exitCode;
    }
  }, 30_000);
});
