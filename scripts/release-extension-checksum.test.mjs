import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256sumLine } from "./release-extension-plugin.mjs";

const emptyHash =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sha256sumLine", () => {
  it("writes a GNU sha256sum text-mode line", () => {
    expect(sha256sumLine(Buffer.alloc(0), "rogatio-extension.zip")).toBe(
      `${emptyHash}  rogatio-extension.zip\n`,
    );
  });

  it("rejects a filename that would break the checksum line", () => {
    expect(() => sha256sumLine(Buffer.alloc(0), "a\nb")).toThrow(/single line/);
    expect(() => sha256sumLine(Buffer.alloc(0), "")).toThrow(/single line/);
  });

  const hasSha256sum =
    spawnSync("sha256sum", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!hasSha256sum)("matches sha256sum -c", () => {
    const dir = mkdtempSync(join(tmpdir(), "rogatio-zip-"));
    const name = "rogatio-extension.zip";
    const bytes = Buffer.from("rogatio-extension");
    writeFileSync(join(dir, name), bytes);
    writeFileSync(join(dir, `${name}.sha256`), sha256sumLine(bytes, name));
    execFileSync("sha256sum", ["-c", `${name}.sha256`], { cwd: dir });
  });
});
