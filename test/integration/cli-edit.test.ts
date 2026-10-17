import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { editCommand } from "../../packages/cli/src/commands/edit.js";
import { readProject } from "../../packages/cli/src/utils/file.js";

const validProject = {
  version: 2,
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
      const origin = new URL(serverUrl).origin;
      const csrf = serverUrl.match(/\/e\/([0-9a-f]{32})$/u)?.[1] ?? "";
      expect(csrf).toMatch(/^[0-9a-f]{32}$/u);
      const sessionHeaders = {
        "content-type": "application/json",
        origin,
        "x-csrf-token": csrf,
      };

      for (const path of ["/editor.html", "/api/project", "/api/mock-root"]) {
        const unscoped = await fetch(`${origin}${path}`);
        expect(unscoped.status).toBe(404);
        const body = await unscoped.text();
        expect(body).toBe("");
        expect(body).not.toContain(csrf);
      }

      const editor = await fetch(`${serverUrl}/editor.html`);
      expect(editor.status).toBe(200);
      expect(editor.headers.get("referrer-policy")).toBe("no-referrer");
      const html = await editor.text();
      expect(html).toContain('id="editor-root"');
      expect(html).not.toContain(csrf);
      expect(html).toContain("./vendor/editor.js");
      expect(html).toContain('href="vendor/editor.css"');
      const bundle = await (
        await fetch(`${serverUrl}/vendor/editor.js`)
      ).text();
      expect(bundle).toContain("createEditor");

      const css = await (await fetch(`${serverUrl}/vendor/editor.css`)).text();
      expect(css).toContain(".rogatio-editor");
      expect(css).toContain("@font-face");
      const font = await fetch(
        `${serverUrl}/vendor/fonts/hanken-grotesk-400.woff2`,
      );
      expect(font.status).toBe(200);
      expect(font.headers.get("content-type")).toContain("font/woff2");

      const projectResponse = await fetch(`${serverUrl}/api/project`);
      expect(projectResponse.status).toBe(200);
      expect(await projectResponse.json()).toEqual(validProject);

      const denied = await fetch(`${serverUrl}/api/save`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(validProject),
      });
      expect(denied.status).toBe(403);
      expect(await readProject(projectPath)).toEqual(validProject);

      const missingOrigin = await fetch(`${serverUrl}/api/save`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ ...validProject, name: "Missing origin" }),
      });
      expect(missingOrigin.status).toBe(403);
      expect(await readProject(projectPath)).toEqual(validProject);

      const changed = { ...validProject, name: "Saved by" };
      const validation = await fetch(`${serverUrl}/api/validate`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify(changed),
      });
      expect(validation.status).toBe(200);
      expect((await validation.json()).diagnostics).toEqual([]);

      const dryRun = await fetch(`${serverUrl}/api/dry-run`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          project: changed,
          cases: [
            {
              url: "https://example.com/",
              method: "GET",
              resourceType: "main_frame",
            },
          ],
        }),
      });
      expect(dryRun.status).toBe(200);
      const dryRunBody = (await dryRun.json()) as { results?: unknown[] };
      expect(Array.isArray(dryRunBody.results)).toBe(true);

      const saved = await fetch(`${serverUrl}/api/save`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify(changed),
      });
      expect(saved.status).toBe(200);
      expect(await readProject(projectPath)).toEqual(changed);

      const cancelled = await fetch(`${serverUrl}/api/cancel`, {
        method: "POST",
        headers: sessionHeaders,
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
