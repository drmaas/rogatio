import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRequestBodyTrustController,
  defaultTrustInstallRoot,
  detectTrustCapabilities,
  generateNativeMessagingManifest,
  TRUST_LIMITS,
  TrustError,
} from "../src/index.js";

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";
const ORIGIN_B = "chrome-extension://abcdefghijklmnopponmlkjihgfedcba/";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rogatio-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function capable(): { manifest: true; caTrust: true; reasons: string[] } {
  return { manifest: true, caTrust: true, reasons: [] };
}

describe(" manifest generation", () => {
  it("returns the fixed shape with sorted, de-duplicated origins", () => {
    const manifest = generateNativeMessagingManifest(
      join(root, "runtime-host"),
      "com.rogatio.runtime",
      [ORIGIN, ORIGIN, ORIGIN_B],
      root,
    );
    expect(manifest).toEqual({
      name: "com.rogatio.runtime",
      description: "Rogatio request-body native runtime host",
      path: join(root, "runtime-host"),
      type: "stdio",
      allowed_origins: [ORIGIN, ORIGIN_B],
    });
  });

  it("is deterministic for identical inputs regardless of order", () => {
    const a = JSON.stringify(
      generateNativeMessagingManifest(
        join(root, "host"),
        "com.rogatio.runtime",
        [ORIGIN],
        root,
      ),
    );
    const b = JSON.stringify(
      generateNativeMessagingManifest(
        join(root, "host"),
        "com.rogatio.runtime",
        [ORIGIN],
        root,
      ),
    );
    expect(a).toBe(b);
  });

  it("rejects a host path outside the install root", () => {
    expect(() =>
      generateNativeMessagingManifest("/etc/passwd", "x", [ORIGIN], root),
    ).toThrow(TrustError);
  });

  it("rejects a non-absolute host path", () => {
    expect(() =>
      generateNativeMessagingManifest("relative/host", "x", [ORIGIN], root),
    ).toThrow(TrustError);
  });

  it("rejects an invalid allowed origin", () => {
    expect(() =>
      generateNativeMessagingManifest(
        join(root, "host"),
        "x",
        ["http://evil.example"],
        root,
      ),
    ).toThrow(TrustError);
  });
});

describe(" capability detection", () => {
  it("is pure and returns a negative default", () => {
    const caps = detectTrustCapabilities();
    expect(caps).toEqual({
      manifest: false,
      caTrust: false,
      reasons: ["no-capability-provider"],
    });
  });

  it("is injectable and capability-based, not OS-name-based", () => {
    const caps = detectTrustCapabilities({ platform: "darwin" });
    expect(caps.manifest).toBe(false);
  });
});

describe(" trust controller lifecycle", () => {
  it("installs the manifest only where capable and is idempotent", async () => {
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
    });
    const first = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(first.ok).toBe(true);
    expect(first.state).toBe("installed");
    const second = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(second.ok).toBe(true);
    const status = await controller.status();
    expect(status.installed).toBe(true);
  });

  it("reports unsupported and writes nothing when manifest capability is absent", async () => {
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      detectCapabilities: () => ({
        manifest: false,
        caTrust: false,
        reasons: ["manifest-dir-unwritable"],
      }),
    });
    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("unsupported");
    expect(result.reasons).toContain("manifest-dir-unwritable");
    const status = await controller.status();
    expect(status.installed).toBe(false);
  });

  it("uninstall is a no-op when absent and removes the manifest otherwise", async () => {
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
    });
    const noop = await controller.uninstall();
    expect(noop.ok).toBe(true);
    expect(noop.state).toBe("uninstalled");
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect((await controller.status()).installed).toBe(true);
    const removed = await controller.uninstall();
    expect(removed.ok).toBe(true);
    expect((await controller.status()).installed).toBe(false);
  });

  it("install provisions the confined CA and invokes the installer once (idempotent)", async () => {
    const installer = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: () => ({
        manifest: true,
        caTrust: true,
        reasons: [],
      }),
      caTrustInstaller: installer,
    });
    const first = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(first.ok).toBe(true);
    expect(first.state).toBe("installed");
    expect(installer).toHaveBeenCalledTimes(1);
    const second = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(second.ok).toBe(true);
    expect(installer).toHaveBeenCalledTimes(1); // idempotent
    expect((await controller.status()).trusted).toBe(true);
  });

  it("untrust removes the CA material and is a no-op when absent", async () => {
    const remover = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
      caTrustRemover: remover,
    });
    const noop = await controller.untrust();
    expect(noop.ok).toBe(true);
    expect(remover).not.toHaveBeenCalled();
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect((await controller.status()).trusted).toBe(true);
    await controller.untrust();
    expect(remover).toHaveBeenCalledTimes(1);
    expect((await controller.status()).trusted).toBe(false);
  });

  it("status leaks no manifest path, host path, or CA material", async () => {
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
    });
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    const status = await controller.status();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(join(root, "runtime-host"));
    expect(serialized).not.toContain(join(root, "com.rogatio.runtime.json"));
    expect(serialized).not.toContain(root);
  });

  it("unified install: manifest + CA + installer all run when both capabilities present (AC-1)", async () => {
    const installer = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
    });
    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    expect(result.state).toBe("installed");
    expect(installer).toHaveBeenCalledTimes(1);
    const status = await controller.status();
    expect(status.installed).toBe(true);
    expect(status.trusted).toBe(true);
  });

  it("unified install: manifest cap absent returns unsupported and writes nothing (AC-2)", async () => {
    const installer = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: () => ({
        manifest: false,
        caTrust: true,
        reasons: ["manifest-dir-unwritable"],
      }),
      caTrustInstaller: installer,
    });
    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("unsupported");
    expect(result.reasons).toContain("manifest-dir-unwritable");
    expect(installer).not.toHaveBeenCalled();
    const status = await controller.status();
    expect(status.installed).toBe(false);
    expect(status.trusted).toBe(false);
  });

  it("unified install: caTrust cap absent rolls back the just-written manifest (AC-3)", async () => {
    const installer = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: () => ({
        manifest: true,
        caTrust: false,
        reasons: ["no-ca-tooling"],
      }),
      caTrustInstaller: installer,
    });
    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("unsupported");
    expect(result.reasons).toContain("no-ca-tooling");
    expect(installer).not.toHaveBeenCalled();
    const status = await controller.status();
    expect(status.installed).toBe(false);
    expect(status.trusted).toBe(false);
  });

  it("unified install: caTrustInstaller throws rolls back both CA and manifest (AC-4)", async () => {
    const throwingInstaller = vi.fn(() => {
      throw new Error("nope");
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: throwingInstaller,
    });
    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("unsupported");
    expect(throwingInstaller).toHaveBeenCalledTimes(1);
    const status = await controller.status();
    expect(status.installed).toBe(false);
    expect(status.trusted).toBe(false);

    const okInstaller = vi.fn(async () => {});
    const controllerRetry = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: okInstaller,
    });
    const retry = await controllerRetry.install(
      "abcdefghijklmnopabcdefghijklmnop",
    );
    expect(retry.ok).toBe(true);
    expect(okInstaller).toHaveBeenCalledTimes(1);
  });

  it("unified install: idempotent re-call does not re-invoke installer (AC-5)", async () => {
    const installer = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
    });
    const first = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(first.ok).toBe(true);
    expect(installer).toHaveBeenCalledTimes(1);
    const second = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(second.ok).toBe(true);
    expect(installer).toHaveBeenCalledTimes(1);
    const status = await controller.status();
    expect(status.installed).toBe(true);
    expect(status.trusted).toBe(true);
  });
});

describe(" scope and limits", () => {
  it("exposes an immutable limit profile", () => {
    expect(TRUST_LIMITS.manifestMaxBytes).toBe(4096);
    expect(TRUST_LIMITS.maxAllowedOrigins).toBe(64);
    expect(TRUST_LIMITS.caKeyBits).toBeGreaterThanOrEqual(2048);
  });

  it("rejects more than the maximum allowed origins", () => {
    const ids: string[] = [];
    for (let i = 0; i < 65; i += 1) {
      let body = "";
      let x = i;
      for (let k = 0; k < 32; k += 1) {
        body += String.fromCharCode(97 + (x % 16));
        x = Math.floor(x / 16);
      }
      ids.push(`chrome-extension://${body}/`);
    }
    expect(ids).toHaveLength(65);
    expect(() =>
      generateNativeMessagingManifest(join(root, "host"), "x", ids, root),
    ).toThrow(TrustError);
  });

  it("default install root is platform-derived", () => {
    expect(typeof defaultTrustInstallRoot("linux")).toBe("string");
    expect(defaultTrustInstallRoot("linux")).toContain("rogatio");
  });
});
