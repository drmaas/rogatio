import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const tar = process.platform === "win32" ? "tar.exe" : "tar";

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: { ...process.env, npm_config_offline: "true" },
      maxBuffer: 4 * 1024 * 1024,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}

// Retry rm with a small backoff to absorb Windows file-handle-release
// latency after the rogatio edit child process exits. If the temp dir is
// still locked after every attempt we leave it for the OS to clean up
// rather than masking the test's pass/fail status with a thrown error.
async function rmWithRetry(path: string): Promise<void> {
  for (const delay of [0, 200, 500, 1000]) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "ENOTEMPTY" && code !== "EPERM") {
        return;
      }
    }
  }
}

// Tear down the edit server and await the child so vitest doesn't catch it
// as an unhandled error. On Windows, `process.kill(pid)` does not propagate
// to descendants; use the child handle's own `.kill()` which Node routes
// through the Job Object so the whole process tree is signaled.
async function stopEditServer(
  editServer: ReturnType<typeof execFileAsync> | undefined,
): Promise<void> {
  if (!editServer || editServer.child.pid === undefined) return;
  try {
    editServer.child.kill("SIGTERM");
  } catch {
    // already gone
  }
  const exited = await Promise.race([
    editServer.then(
      () => true,
      () => true,
    ),
    new Promise<false>((r) => setTimeout(() => r(false), 2000)),
  ]);
  if (exited) return;
  try {
    editServer.child.kill("SIGKILL");
  } catch {
    // already gone
  }
  await Promise.race([
    editServer.then(
      () => undefined,
      () => undefined,
    ),
    new Promise((r) => setTimeout(r, 1000)),
  ]);
}

describe("publishable CLI tarball", () => {
  it("packs a tarball free of workspace:* and @rogatio/* dependencies with bundled dist/editor", async () => {
    const build = await run(pnpm, ["build"], root);
    expect(build.code, build.stderr).toBe(0);

    const temp = await mkdtemp(join(tmpdir(), "rogatio-publishable-"));
    const tarballDir = join(temp, "tarballs");
    const tarball = join(tarballDir, "rogatio-cli-0.0.0.tgz");
    let editServer: ReturnType<typeof execFileAsync> | undefined;
    try {
      const pack = await run(
        pnpm,
        ["pack", "--pack-destination", tarballDir],
        join(root, "packages", "cli"),
      );
      expect(pack.code, pack.stderr).toBe(0);

      // Stream the embedded package.json out of the tarball — no extraction needed.
      const pkgRaw = await run(
        tar,
        ["-xOf", tarball, "package/package.json"],
        temp,
      );
      expect(pkgRaw.code, pkgRaw.stderr).toBe(0);
      const pkg = JSON.parse(pkgRaw.stdout);

      const deps = pkg.dependencies ?? {};
      const rogatioKeys = Object.keys(deps).filter((k) =>
        k.startsWith("@rogatio/"),
      );
      expect(
        rogatioKeys,
        `cli tarball must not publish @rogatio/* dependencies; saw: ${rogatioKeys.join(", ")}`,
      ).toEqual([]);
      expect(
        pkgRaw.stdout,
        "cli tarball package.json must not contain any workspace: protocol",
      ).not.toContain("workspace:");
      expect(deps.ajv, "cli tarball must declare ajv as a real dep").toBe(
        "8.18.0",
      );
      expect(pkg.files, 'cli tarball files manifest must be ["dist"]').toEqual([
        "dist",
      ]);

      const listing = await run(tar, ["-tzf", tarball], temp);
      expect(listing.code, listing.stderr).toBe(0);
      // tar on Windows can emit paths with a leading "./" and "\\" separators;
      // normalize so the assertions below are platform-independent.
      const entries = listing.stdout
        .split("\n")
        .map((e) => e.replace(/\\\\/g, "/").replace(/^\.\//, "").trim())
        .filter(Boolean);

      for (const path of [
        "package/dist/node/index.js",
        "package/dist/editor/index.js",
        "package/dist/editor/index.css",
      ]) {
        expect(entries, `tarball must contain ${path}`).toContain(path);
      }

      expect(
        entries.some(
          (e) =>
            e.startsWith("package/dist/editor/fonts/") && e.endsWith(".woff2"),
        ),
        "tarball must contain at least one .woff2 font under dist/editor/fonts/",
      ).toBe(true);

      const bundle = await run(
        tar,
        ["-xOf", tarball, "package/dist/node/index.js"],
        temp,
      );
      expect(bundle.code, bundle.stderr).toBe(0);
      expect(
        bundle.stdout,
        "bundled cli must not import any @rogatio/* package at runtime",
      ).not.toContain('from "@rogatio/');

      // End-to-end: extract the tarball, copy the workspace ajv into a
      // node_modules next to it, boot `rogatio edit`, and GET the /vendor/*
      // editor assets. Proves the published layout's path-relative editor
      // lookup actually resolves.
      const consumer = join(temp, "consumer");
      const project = join(consumer, "project.json");
      const installedDir = join(consumer, "node_modules", "@rogatio", "cli");
      await mkdir(installedDir, { recursive: true });
      const extract = await run(
        tar,
        ["-xzf", tarball, "-C", installedDir, "--strip-components=1"],
        temp,
      );
      expect(extract.code, extract.stderr).toBe(0);
      await writeFile(
        project,
        JSON.stringify({ version: 1, name: "publishable", groups: [] }),
      );
      const ajvSource = dirname(require.resolve("ajv/package.json"));
      await cp(ajvSource, join(consumer, "node_modules", "ajv"), {
        recursive: true,
      });

      const bin = join(installedDir, "dist", "node", "index.js");
      const port = 18991;
      editServer = execFileAsync(
        process.execPath,
        [bin, "edit", project, "--port", String(port)],
        { cwd: consumer },
      );

      // Poll for the server to come up (max 5s).
      const deadline = Date.now() + 5000;
      let editor = { status: 0, body: "" };
      let css = { status: 0, body: "" };
      let font = { status: 0, body: "" };
      while (Date.now() < deadline) {
        try {
          editor = await get(`http://127.0.0.1:${port}/vendor/editor.js`);
          css = await get(`http://127.0.0.1:${port}/vendor/editor.css`);
          font = await get(
            `http://127.0.0.1:${port}/vendor/fonts/hanken-grotesk-400.woff2`,
          );
          if (
            editor.status === 200 &&
            css.status === 200 &&
            font.status === 200
          ) {
            break;
          }
        } catch {
          // not ready yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(
        editor.status,
        "editor.js must be served from the published cli",
      ).toBe(200);
      expect(
        editor.body.length,
        "editor.js body must be non-empty",
      ).toBeGreaterThan(0);
      expect(
        css.status,
        "editor.css must be served from the published cli",
      ).toBe(200);
      expect(
        css.body,
        "editor.css must contain @font-face declarations",
      ).toContain("@font-face");
      expect(
        font.status,
        "editor font must be served from the published cli",
      ).toBe(200);
      expect(
        font.body.length,
        "editor font body must be non-empty",
      ).toBeGreaterThan(0);
    } finally {
      // Tear the server down before the temp dir, so the OS has a chance to
      // release file handles before the rm runs. Both are safe to retry /
      // no-op on failure so a transient lock does not fail the test.
      await stopEditServer(editServer);
      await rmWithRetry(temp);
    }
  }, 90_000);
});
