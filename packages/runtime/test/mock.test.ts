import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIMITS } from "@rogatio/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_LIMITS } from "../src/limits.js";
import { renderMockResponse } from "../src/mock.js";
import { readMockFile } from "../src/mock-file.js";
import * as platformFile from "../src/platform-file.js";
import { isConfinedFileSupported } from "../src/platform-file.js";
import type {
  PresetDigest,
  RuntimeMockConfig,
  RuntimeResult,
} from "../src/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rogatio-mock-"));
  temporaryRoots.push(root);
  return root;
}

function assertRedacted(
  result: RuntimeResult<unknown>,
  forbidden: readonly string[],
): void {
  const serialized = JSON.stringify(result);
  for (const fragment of forbidden) {
    expect(serialized).not.toContain(fragment);
  }
  if (!result.ok) {
    expect(Object.keys(result.error)).toEqual(["code"]);
  }
}

describe("mock confined file reads (phase 7A)", () => {
  it("loads the macOS confinement library", () => {
    if (process.platform !== "darwin") return;
    expect(isConfinedFileSupported()).toBe(true);
  });

  it("returns exact non-UTF-8 bytes without decoding", async () => {
    const root = await makeRoot();
    const bytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x81]);
    await writeFile(join(root, "payload.bin"), bytes);

    const result = await readMockFile(root, "payload.bin");

    if (isConfinedFileSupported()) {
      expect(result).toEqual({ ok: true, value: bytes });
    } else {
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
    }
    assertRedacted(result, [root, "payload.bin"]);
  });

  it("rejects a final symlink (leaf escape)", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "secret.bin"), Uint8Array.from([0x01]));
    await symlink(join(outside, "secret.bin"), join(root, "leaf-link"));

    const result = await readMockFile(root, "leaf-link");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const allowed = [
        "runtime.file-denied",
        "runtime.file-race-rejected",
        ...(isConfinedFileSupported() ? [] : ["runtime.platform-unsupported"]),
      ];
      expect(allowed).toContain(result.error.code);
    }
    assertRedacted(result, [root, outside, "secret.bin", "leaf-link"]);
  });

  it("rejects an intermediate symlink directory component", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "secret.bin"), Uint8Array.from([0x02]));
    await mkdir(join(root, "nested"));
    await symlink(outside, join(root, "nested", "escape"));

    const result = await readMockFile(root, "nested/escape/secret.bin");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const allowed = [
        "runtime.file-denied",
        "runtime.file-race-rejected",
        ...(isConfinedFileSupported() ? [] : ["runtime.platform-unsupported"]),
      ];
      expect(allowed).toContain(result.error.code);
    }
    assertRedacted(result, [root, outside, "secret.bin"]);
  });

  it("rejects intermediate symlink replacement during concurrent opens", async () => {
    if (!isConfinedFileSupported()) {
      const result = await readMockFile("/unused", "gate/safe.bin");
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
      return;
    }

    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "leak.bin"), Uint8Array.from([0xde, 0xad]));
    await mkdir(join(root, "gate"));
    await writeFile(
      join(root, "gate", "safe.bin"),
      Uint8Array.from([0xbe, 0xef]),
    );

    let sawOutsideBytes = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const reads = Array.from({ length: 8 }, () =>
        readMockFile(root, "gate/safe.bin"),
      );
      if (attempt % 2 === 1) {
        await rm(join(root, "gate"), { recursive: true, force: true });
        await symlink(outside, join(root, "gate"));
      } else {
        await rm(join(root, "gate"), { recursive: true, force: true });
        await mkdir(join(root, "gate"));
        await writeFile(
          join(root, "gate", "safe.bin"),
          Uint8Array.from([0xbe, 0xef]),
        );
      }
      const results = await Promise.all(reads);
      for (const result of results) {
        assertRedacted(result, [root, outside, "leak.bin", "safe.bin"]);
        if (result.ok) {
          if (result.value[0] === 0xde) sawOutsideBytes = true;
          expect(result.value).toEqual(Uint8Array.from([0xbe, 0xef]));
        } else {
          expect([
            "runtime.file-denied",
            "runtime.file-race-rejected",
          ]).toContain(result.error.code);
        }
      }
    }
    expect(sawOutsideBytes).toBe(false);
  });

  it("rejects hard links", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "primary.bin"), "x");
    await link(join(root, "primary.bin"), join(root, "alias.bin"));

    const result = await readMockFile(root, "alias.bin");

    if (isConfinedFileSupported()) {
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.file-race-rejected" },
      });
    } else {
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
    }
    assertRedacted(result, [root, "alias.bin"]);
  });

  it("rejects a missing file", async () => {
    const root = await makeRoot();
    const result = await readMockFile(root, "missing.bin");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        isConfinedFileSupported()
          ? "runtime.file-denied"
          : "runtime.platform-unsupported",
      );
    }
    assertRedacted(result, [root, "missing.bin"]);
  });

  it("reads a file at maxFileBytes and rejects one byte over", async () => {
    const root = await makeRoot();
    const atLimit = new Uint8Array(RUNTIME_LIMITS.maxFileBytes);
    atLimit[0] = 0x7f;
    atLimit[atLimit.length - 1] = 0x7f;
    await writeFile(join(root, "at-limit.bin"), atLimit);
    await writeFile(
      join(root, "over-limit.bin"),
      new Uint8Array(RUNTIME_LIMITS.maxFileBytes + 1),
    );

    const atResult = await readMockFile(root, "at-limit.bin");
    const overResult = await readMockFile(root, "over-limit.bin");

    if (isConfinedFileSupported()) {
      expect(atResult).toEqual({ ok: true, value: atLimit });
      expect(overResult).toEqual({
        ok: false,
        error: { code: "runtime.size-limit" },
      });
    } else {
      expect(atResult).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
      expect(overResult).toEqual({
        ok: false,
        error: { code: "runtime.platform-unsupported" },
      });
    }
    assertRedacted(atResult, [root]);
    assertRedacted(overResult, [root]);
  }, 120_000);

  it("rejects logical paths that escape the confined root", async () => {
    const root = await makeRoot();
    for (const logicalPath of ["../outside", "..", "a/../outside"]) {
      const result = await readMockFile(root, logicalPath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("runtime.file-denied");
      }
      assertRedacted(result, [root, logicalPath]);
    }
  });

  it("reports platform-unsupported when confinement cannot be proved", async () => {
    vi.spyOn(platformFile, "isConfinedFileSupported").mockReturnValue(false);
    const root = await makeRoot();
    await writeFile(join(root, "file.bin"), "x");

    const result = await readMockFile(root, "file.bin");

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.platform-unsupported" },
    });
    assertRedacted(result, [root]);
  });

  it("honors abort while reading", async () => {
    if (!isConfinedFileSupported()) return;
    const root = await makeRoot();
    const payload = new Uint8Array(256 * 1024);
    await writeFile(join(root, "slow.bin"), payload);
    const controller = new AbortController();
    controller.abort();

    const result = await readMockFile(root, "slow.bin", controller.signal);

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.timeout" },
    });
    assertRedacted(result, [root]);
  });

  it("detects replacement growth after open via post-read stat", async () => {
    if (!isConfinedFileSupported()) return;
    const root = await makeRoot();
    const path = join(root, "grow.bin");
    await writeFile(path, new Uint8Array(8));
    const first = await readMockFile(root, "grow.bin");
    expect(first.ok).toBe(true);

    await writeFile(path, new Uint8Array(RUNTIME_LIMITS.maxFileBytes + 8));
    const second = await readMockFile(root, "grow.bin");
    expect(second).toEqual({
      ok: false,
      error: { code: "runtime.size-limit" },
    });
    assertRedacted(second, [root, path]);
  });

  it("does not block on a FIFO leaf and rejects it", async () => {
    if (!isConfinedFileSupported()) return;
    const root = await makeRoot();
    execFileSync("mkfifo", [join(root, "pipe.bin")]);

    const result = await readMockFile(root, "pipe.bin");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["runtime.file-denied", "runtime.file-race-rejected"]).toContain(
        result.error.code,
      );
    }
    assertRedacted(result, [root, "pipe.bin"]);
  }, 5_000);

  it("does not leak descriptors on any error path", async () => {
    if (!isConfinedFileSupported()) return;
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "x.bin"), "x");
    await writeFile(join(root, "primary.bin"), "x");
    await link(join(root, "primary.bin"), join(root, "alias.bin"));
    await mkdir(join(root, "dir"));
    await symlink(outside, join(root, "link-out"));
    await symlink(join(outside, "x.bin"), join(root, "leaf-link"));
    await writeFile(
      join(root, "big.bin"),
      new Uint8Array(RUNTIME_LIMITS.maxFileBytes + 1),
    );
    const paths = [
      "missing.bin",
      "alias.bin",
      "dir",
      "link-out/x.bin",
      "leaf-link",
      "big.bin",
      "dir/missing.bin",
    ];

    const descriptorDir =
      process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd";
    if (!existsSync(descriptorDir)) return;

    const before = readdirSync(descriptorDir).length;
    for (let round = 0; round < 20; round += 1) {
      for (const path of paths) {
        const result = await readMockFile(root, path);
        expect(result.ok).toBe(false);
      }
    }
    const after = readdirSync(descriptorDir).length;

    expect(after).toBeLessThanOrEqual(before + 1);
  }, 60_000);

  it("rejects a descriptor whose kernel path leaves the root", async () => {
    const root = await makeRoot();
    const result = await platformFile.openConfinedUsing(root, "payload.bin", {
      async openRelative() {
        return {
          fd: -1,
          read: () => Promise.resolve({ bytesRead: 0 }),
          stat: () => Promise.reject(new Error("stat")),
          close: () => Promise.resolve(),
        };
      },
      pathOf: () => Promise.resolve("/outside/secret"),
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.file-race-rejected" },
    });
    assertRedacted(result, [root, "/outside/secret", "payload.bin"]);
  });

  it("never includes logical or absolute paths in errors", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "x.bin"), "x");
    await symlink(outside, join(root, "link-out"));

    const cases = [
      readMockFile(root, "missing.bin"),
      readMockFile(root, "link-out/x.bin"),
      readMockFile(root, "../escape"),
    ];
    const results = await Promise.all(cases);
    for (const result of results) {
      assertRedacted(result, [
        root,
        outside,
        "missing.bin",
        "link-out",
        "../escape",
      ]);
    }
  });
});

const PRESET_DIGEST: PresetDigest =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

function mockConfig(
  overrides: Partial<RuntimeMockConfig> &
    Pick<RuntimeMockConfig, "body" | "file">,
): RuntimeMockConfig {
  return { ruleId: "rule-1", status: 200, ...overrides };
}

function render(
  mock: RuntimeMockConfig,
  extras?: {
    readonly fileRoot?: string;
    readonly method?: string;
    readonly signal?: AbortSignal;
  },
) {
  return renderMockResponse({
    mock,
    fileRoot: extras?.fileRoot,
    presetDigest: PRESET_DIGEST,
    ...(extras?.method !== undefined ? { method: extras.method } : {}),
    ...(extras?.signal !== undefined ? { signal: extras.signal } : {}),
  });
}

describe("mock response rendering (phase 7B)", () => {
  it("returns exact inline bytes and default headers", async () => {
    const result = await render(mockConfig({ body: "é" }));

    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        headers: [
          ["Content-Type", "application/octet-stream"],
          ["Content-Length", "2"],
          ["Cache-Control", "no-store"],
        ],
        bodyBytes: new TextEncoder().encode("é"),
      },
    });
  });

  it("returns exact file bytes", async () => {
    const root = await makeRoot();
    const bytes = Uint8Array.from([0x00, 0xff, 0xfe]);
    await writeFile(join(root, "payload.bin"), bytes);

    const result = await render(mockConfig({ file: "payload.bin" }), {
      fileRoot: root,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        headers: [
          ["Content-Type", "application/octet-stream"],
          ["Content-Length", "3"],
          ["Cache-Control", "no-store"],
        ],
        bodyBytes: bytes,
      },
    });
    assertRedacted(result, [root, "payload.bin"]);
  });

  it("keeps configured headers in order and does not duplicate reserved ones", async () => {
    const result = await render(
      mockConfig({
        body: "x",
        headers: [
          { name: "X-One", value: "1" },
          { name: "content-type", value: "image/png" },
          { name: "Cache-Control", value: "max-age=5" },
          { name: "Content-Length", value: "999" },
          { name: "X-Two", value: "2" },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.headers).toEqual([
        ["X-One", "1"],
        ["content-type", "image/png"],
        ["Cache-Control", "max-age=5"],
        ["X-Two", "2"],
        ["Content-Length", "1"],
      ]);
    }
  });

  it("propagates each file failure without collapsing the code", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "secret.bin"), Uint8Array.from([1]));
    await writeFile(join(root, "primary.bin"), "x");
    await link(join(root, "primary.bin"), join(root, "alias.bin"));
    await writeFile(
      join(root, "big.bin"),
      new Uint8Array(RUNTIME_LIMITS.maxFileBytes + 1),
    );

    const missing = await render(mockConfig({ file: "missing.bin" }), {
      fileRoot: root,
    });
    const linked = await render(mockConfig({ file: "alias.bin" }), {
      fileRoot: root,
    });
    const oversized = await render(mockConfig({ file: "big.bin" }), {
      fileRoot: root,
    });
    const noRoot = await render(mockConfig({ file: "primary.bin" }));
    const neither = await render({ ruleId: "rule-1", status: 200 });

    expect(missing).toEqual({
      ok: false,
      error: { code: "runtime.file-denied" },
    });
    expect(linked).toEqual({
      ok: false,
      error: { code: "runtime.file-race-rejected" },
    });
    expect(oversized).toEqual({
      ok: false,
      error: { code: "runtime.size-limit" },
    });
    expect(noRoot).toEqual({
      ok: false,
      error: { code: "runtime.file-denied" },
    });
    expect(neither).toEqual({
      ok: false,
      error: { code: "runtime.file-denied" },
    });
    for (const result of [missing, linked, oversized, noRoot, neither]) {
      assertRedacted(result, [
        root,
        outside,
        "missing.bin",
        "alias.bin",
        "big.bin",
      ]);
    }
  });

  it("reports platform-unsupported when confinement cannot be proved", async () => {
    vi.spyOn(platformFile, "isConfinedFileSupported").mockReturnValue(false);
    const root = await makeRoot();
    const result = await render(mockConfig({ file: "payload.bin" }), {
      fileRoot: root,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime.platform-unsupported" },
    });
    assertRedacted(result, [root, "payload.bin"]);
  });

  it("waits the full delay, including zero and the maximum", async () => {
    vi.useFakeTimers();
    const zero = render(mockConfig({ body: "z", delayMs: 0 }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(zero).resolves.toMatchObject({ ok: true });

    let settled = false;
    const pending = render(
      mockConfig({ body: "z", delayMs: LIMITS.maxMockDelayMs }),
    ).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(LIMITS.maxMockDelayMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("cancels a delay when the request is aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let settled = false;
    const pending = render(mockConfig({ body: "z", delayMs: 1_000 }), {
      signal: controller.signal,
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: "runtime.timeout" },
    });

    const already = new AbortController();
    already.abort();
    await expect(
      render(mockConfig({ body: "z", delayMs: LIMITS.maxMockDelayMs }), {
        signal: already.signal,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "runtime.timeout" },
    });
  });

  it("serves HEAD with an empty body and the full content length", async () => {
    const root = await makeRoot();
    const bytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80]);
    await writeFile(join(root, "payload.bin"), bytes);

    const result = await render(
      mockConfig({ file: "payload.bin", delayMs: 0 }),
      {
        fileRoot: root,
        method: "HEAD",
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        headers: [
          ["Content-Type", "application/octet-stream"],
          ["Content-Length", "4"],
          ["Cache-Control", "no-store"],
        ],
        bodyBytes: new Uint8Array(),
      },
    });
  });

  it("still reads the file and applies the delay for HEAD", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    let settled = false;
    const pending = render(mockConfig({ file: "missing.bin", delayMs: 500 }), {
      fileRoot: root,
      method: "HEAD",
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: "runtime.file-denied" },
    });
    assertRedacted(await pending, [root, "missing.bin"]);
  });
});
