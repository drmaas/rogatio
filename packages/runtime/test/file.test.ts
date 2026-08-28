import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeExact,
  isConfinedFileSupported,
  normalizeRuntimePreset,
  readConfinedFile,
} from "../src/index.js";
import { makeGrant, makeMatcher, makePresetInput } from "./helpers.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "rogatio-"));
  temporaryRoots.push(root);
  return root;
}

function fileOperation(target: string) {
  const grant = makeGrant({ kind: "confined-file", target });
  const normalized = normalizeRuntimePreset(
    makePresetInput({
      matchers: [makeMatcher()],
      grants: [grant],
    }),
  );
  expect(normalized.ok).toBe(true);
  if (!normalized.ok) throw new Error("Expected a valid file grant");
  const authorized = authorizeExact(normalized.value, grant);
  expect(authorized.ok).toBe(true);
  if (!authorized.ok) throw new Error("Expected an authorized file operation");
  return authorized.value;
}

describe("F6 confined file reader", () => {
  it("reads an approved regular file from the configured root", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "approved.txt"), "approved");

    const result = await readConfinedFile(fileOperation("approved.txt"), root);

    if (isConfinedFileSupported()) {
      expect(result).toEqual({
        ok: true,
        value: new TextEncoder().encode("approved"),
      });
    } else {
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
    }
  });

  it("rejects traversal, absolute, alternate-separator, and encoded paths", () => {
    for (const target of [
      "",
      ".",
      "..",
      "../outside",
      "/etc/passwd",
      "dir\\outside",
      "a%2fb",
      "C:secret",
      "\\\\server\\share",
      "*",
    ]) {
      const normalized = normalizeRuntimePreset(
        makePresetInput({
          grants: [makeGrant({ kind: "confined-file", target })],
        }),
      );
      expect(normalized.ok, target).toBe(false);
    }
  });

  it("rejects final and intermediate symlinks and never reads outside root", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "secret.txt"), "secret");
    await mkdir(join(root, "nested"));
    await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
    await symlink(outside, join(root, "nested", "link-dir"));

    for (const target of ["link.txt", "nested/link-dir/secret.txt"]) {
      const result = await readConfinedFile(fileOperation(target), root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const allowed = [
          "runtime.file-denied",
          "runtime.file-race-rejected",
          ...(isConfinedFileSupported()
            ? []
            : ["runtime.platform-unsupported"]),
        ];
        expect(allowed).toContain(result.error.code);
        expect(JSON.stringify(result)).not.toContain(outside);
      }
    }
  });

  it("rejects directories and files over the fixed bound", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "directory"));
    await writeFile(join(root, "large.txt"), new Uint8Array(4_194_305));

    const directoryResult = await readConfinedFile(
      fileOperation("directory"),
      root,
    );
    const largeResult = await readConfinedFile(
      fileOperation("large.txt"),
      root,
    );

    if (isConfinedFileSupported()) {
      expect(directoryResult.ok).toBe(false);
      expect(largeResult).toEqual({
        ok: false,
        error: { code: "runtime.size-limit" },
      });
    } else {
      expect(directoryResult).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
      expect(largeResult).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
    }
  });

  it("keeps the read descriptor stable and returns no absolute path in errors", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "approved.txt"), "content");
    const result = await readConfinedFile(fileOperation("approved.txt"), root);

    expect(JSON.stringify(result)).not.toContain(root);
    if (result.ok) {
      expect(await readFile(join(root, "approved.txt"), "utf8")).toBe(
        "content",
      );
      expect(result.value).toEqual(new TextEncoder().encode("content"));
    }
  });
});
