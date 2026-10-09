import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  X509Certificate,
} from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRequestBodyTrustController,
  defaultTrustInstallRoot,
  detectTrustCapabilities,
  extensionOriginListed,
  generateNativeMessagingManifest,
  TRUST_LIMITS,
  TrustError,
} from "../src/index.js";
import { createCertificate, generateCaKeyPair } from "../src/x509.js";

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
    const remover = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
      caTrustRemover: remover,
    });
    const noop = await controller.uninstall();
    expect(noop.ok).toBe(true);
    expect(noop.state).toBe("uninstalled");
    expect(remover).not.toHaveBeenCalled();
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect((await controller.status()).installed).toBe(true);
    expect((await controller.status()).trusted).toBe(true);
    const removed = await controller.uninstall();
    expect(removed.ok).toBe(true);
    expect(remover).toHaveBeenCalledTimes(1);
    expect((await controller.status()).installed).toBe(false);
    expect((await controller.status()).trusted).toBe(false);
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

  it("unified uninstall: removes manifest + CA files + invokes remover (AC-1)", async () => {
    const remover = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
      caTrustRemover: remover,
    });
    const installed = await controller.install(
      "abcdefghijklmnopabcdefghijklmnop",
    );
    expect(installed.ok).toBe(true);
    expect(installed.state).toBe("installed");
    expect(await fileExists(join(root, "com.rogatio.runtime.json"))).toBe(true);
    expect(await fileExists(join(root, ".rogatio-ca.key"))).toBe(true);
    expect(await fileExists(join(root, ".rogatio-ca.pub"))).toBe(true);
    expect(await fileExists(join(root, ".rogatio-ca.crt"))).toBe(true);

    const removed = await controller.uninstall();
    expect(removed.ok).toBe(true);
    expect(removed.state).toBe("uninstalled");
    expect(remover).toHaveBeenCalledTimes(1);
    expect(await fileExists(join(root, "com.rogatio.runtime.json"))).toBe(
      false,
    );
    expect(await fileExists(join(root, ".rogatio-ca.key"))).toBe(false);
    expect(await fileExists(join(root, ".rogatio-ca.pub"))).toBe(false);
    expect(await fileExists(join(root, ".rogatio-ca.crt"))).toBe(false);

    const status = await controller.status();
    expect(status.installed).toBe(false);
    expect(status.trusted).toBe(false);
  });

  it("unified uninstall: idempotent re-call is a no-op (AC-2)", async () => {
    const remover = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
      caTrustRemover: remover,
    });
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    const first = await controller.uninstall();
    expect(first.ok).toBe(true);
    expect(first.state).toBe("uninstalled");
    expect(remover).toHaveBeenCalledTimes(1);

    const second = await controller.uninstall();
    expect(second.ok).toBe(true);
    expect(second.state).toBe("uninstalled");
    expect(remover).toHaveBeenCalledTimes(1);
    expect(await fileExists(join(root, "com.rogatio.runtime.json"))).toBe(
      false,
    );
    expect(await fileExists(join(root, ".rogatio-ca.key"))).toBe(false);
  });

  it("unified uninstall: succeeds without capability gating (AC-3)", async () => {
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: () => ({
        manifest: false,
        caTrust: false,
        reasons: ["no-capability-provider"],
      }),
    });
    const result = await controller.uninstall();
    expect(result.ok).toBe(true);
    expect(result.state).toBe("uninstalled");
    expect(await fileExists(join(root, "com.rogatio.runtime.json"))).toBe(
      false,
    );
  });

  it("unified uninstall: caTrustRemover throw removes files and surfaces unsupported (AC-4)", async () => {
    const remover = vi.fn(() => {
      throw new Error("remover-failure-observed");
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
      caTrustRemover: remover,
    });
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(await fileExists(join(root, "com.rogatio.runtime.json"))).toBe(true);
    expect(await fileExists(join(root, ".rogatio-ca.key"))).toBe(true);

    const result = await controller.uninstall();
    expect(result.ok).toBe(false);
    expect(result.state).toBe("unsupported");
    expect(result.reasons).toContain("remover-failure-observed");
    expect(await fileExists(join(root, "com.rogatio.runtime.json"))).toBe(
      false,
    );
    expect(await fileExists(join(root, ".rogatio-ca.key"))).toBe(false);
    expect(await fileExists(join(root, ".rogatio-ca.pub"))).toBe(false);
    expect(await fileExists(join(root, ".rogatio-ca.crt"))).toBe(false);
  });

  it("unified uninstall: status non-leakage + public surface narrowing (AC-5)", async () => {
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
    });
    await controller.install("abcdefghijklmnopabcdefghijklmnop");
    const uninstalled = await controller.uninstall();
    expect(uninstalled.ok).toBe(true);

    const status = await controller.status();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(join(root, "runtime-host"));
    expect(serialized).not.toContain(join(root, "com.rogatio.runtime.json"));
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(".rogatio-ca.key");
    expect(serialized).not.toContain(".rogatio-ca.pub");
    expect(serialized).not.toContain(".rogatio-ca.crt");
    expect(status.installed).toBe(false);
    expect(status.trusted).toBe(false);

    expect(controller).not.toHaveProperty("untrust");
    expect(Object.keys(controller).sort()).toEqual(
      ["install", "status", "uninstall", "verify"].sort(),
    );
  });

  it("reuses a stored CA when the certificate public key matches the private key", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, material.certPem, material.keyPem, 0o600);
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
    expect(installer).toHaveBeenCalledTimes(1);
    expect(installer).toHaveBeenCalledWith(material.certPem);
    expect(await readFile(join(root, ".rogatio-ca.crt"), "utf8")).toBe(
      material.certPem,
    );
    expect(await readFile(join(root, ".rogatio-ca.key"), "utf8")).toBe(
      material.keyPem,
    );
  });

  it("regenerates a CA when the stored certificate does not match the private key", async () => {
    const unused = generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey;
    const planted = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    const other = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, planted.certPem, other.keyPem, 0o600);
    const installer = vi.fn(async (pem: string) => {
      expect(pem).not.toBe(planted.certPem);
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    expect(installer).toHaveBeenCalledTimes(1);
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(certPem).toBe(installer.mock.calls[0]?.[0]);
    expect(certPem).not.toBe(planted.certPem);
    expect(keyPem).not.toBe(other.keyPem);
    const certificate = new X509Certificate(certPem);
    expect(certificate.ca).toBe(true);
    expect(certificate.checkPrivateKey(createPrivateKey(keyPem))).toBe(true);
    expect((await lstat(join(root, ".rogatio-ca.key"))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("regenerates a CA when the key file holds only a public key", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    const publicPem = spkiPem(material.keyPem);
    await writeCaFiles(root, material.certPem, publicPem, 0o600);
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
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(keyPem).not.toBe(publicPem);
    expect(certPem).not.toBe(material.certPem);
    expect(
      new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem)),
    ).toBe(true);
  });

  it("regenerates a CA when the key file mixes a public key with another private key", async () => {
    const unused = generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey;
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    const other = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    const mixedPem = `${spkiPem(material.keyPem)}${other.keyPem}`;
    await writeCaFiles(root, material.certPem, mixedPem, 0o600);
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
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(keyPem).not.toBe(mixedPem);
    expect(
      new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem)),
    ).toBe(true);
  });

  it("regenerates a CA when the key file is a copy of the certificate", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, material.certPem, material.certPem, 0o600);
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
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(keyPem).not.toBe(material.certPem);
    expect(certPem).not.toBe(material.certPem);
    expect(
      new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem)),
    ).toBe(true);
  });

  it("regenerates a CA when the stored certificate has trailing text", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(
      root,
      `${material.certPem}\nEOF\n`,
      material.keyPem,
      0o600,
    );
    const installer = vi.fn(async (certPem: string) => {
      expect(certPem).not.toContain("\nEOF\n");
      expect(certPem).not.toBe(`${material.certPem}\nEOF\n`);
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(
      new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem)),
    ).toBe(true);
  });

  it("regenerates a CA when the private key is not mode 0600", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, material.certPem, material.keyPem, 0o644);
    const installer = vi.fn(async (certPem: string) => {
      expect(certPem).not.toBe(material.certPem);
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    expect(installer).toHaveBeenCalledTimes(1);
    expect((await lstat(join(root, ".rogatio-ca.key"))).mode & 0o777).toBe(
      0o600,
    );
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(
      new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem)),
    ).toBe(true);
  });

  it("regenerates a CA when the private key matches public fields but cannot sign", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    const plantedKey = pkcs8WithInconsistentPrivateMaterial(material.keyPem);
    const planted = createPrivateKey(plantedKey);
    const plantedCert = new X509Certificate(material.certPem);
    expect(plantedCert.checkPrivateKey(planted)).toBe(true);
    const payload = Buffer.from("rogatio-ca-possession");
    let possessed = true;
    try {
      const signature = sign("sha256", payload, planted);
      possessed = verify("sha256", payload, plantedCert.publicKey, signature);
    } catch {
      possessed = false;
    }
    expect(possessed).toBe(false);
    await writeCaFiles(root, material.certPem, plantedKey, 0o600);
    expect((await lstat(join(root, ".rogatio-ca.key"))).mode & 0o777).toBe(
      0o600,
    );
    const installer = vi.fn(async (pem: string) => {
      expect(pem).not.toBe(material.certPem);
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    const certPem = await readFile(join(root, ".rogatio-ca.crt"), "utf8");
    const keyPem = await readFile(join(root, ".rogatio-ca.key"), "utf8");
    expect(certPem).not.toBe(material.certPem);
    expect(keyPem).not.toBe(plantedKey);
    expect(installer).toHaveBeenCalledTimes(1);
    expect(installer).toHaveBeenCalledWith(certPem);
  });

  it("removes the previous trust anchor after a regenerated CA is installed", async () => {
    const unused = generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey;
    const planted = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    const other = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, planted.certPem, other.keyPem, 0o600);
    const previous = sha1Of(planted.certPem);
    const events: string[] = [];
    const installer = vi.fn(async (pem: string) => {
      events.push(pem === planted.certPem ? "install-old" : "install-new");
    });
    const anchorRemover = vi.fn(async (fingerprint: string) => {
      events.push(`remove:${fingerprint}`);
    });
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: installer,
      caTrustAnchorRemover: anchorRemover,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    expect(events).toEqual(["install-new", `remove:${previous}`]);
    expect(await readFile(join(root, ".rogatio-ca.crt"), "utf8")).not.toBe(
      planted.certPem,
    );
    expect(await readFile(join(root, ".rogatio-ca.key"), "utf8")).not.toBe(
      other.keyPem,
    );
  });

  it("reports a previous-anchor removal failure without failing install", async () => {
    const unused = generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey;
    const planted = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    const other = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, planted.certPem, other.keyPem, 0o600);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const controller = createRequestBodyTrustController({
        installRoot: root,
        manifestDir: root,
        hostPath: join(root, "runtime-host"),
        detectCapabilities: capable,
        caTrustInstaller: async () => {},
        caTrustAnchorRemover: async () => {
          throw new Error("anchor store unavailable");
        },
      });

      const result = await controller.install(
        "abcdefghijklmnopabcdefghijklmnop",
      );
      expect(result.ok).toBe(true);
      expect(result.state).toBe("installed");
      expect(result.reasons).toEqual(["previous-anchor-not-removed"]);
      expect(errorSpy).toHaveBeenCalledWith(
        "[rogatio] previous CA trust anchor was not removed",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not remove an anchor when the stored CA is reused", async () => {
    const material = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, material.certPem, material.keyPem, 0o600);
    const anchorRemover = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
      caTrustAnchorRemover: anchorRemover,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(true);
    expect(anchorRemover).not.toHaveBeenCalled();
    expect(await readFile(join(root, ".rogatio-ca.crt"), "utf8")).toBe(
      material.certPem,
    );
  });

  it("does not remove the previous anchor when the new install fails", async () => {
    const unused = generateCaKeyPair(TRUST_LIMITS.caKeyBits).privateKey;
    const planted = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    const other = await createCertificate(
      "CN=Rogatio Request-Body CA",
      unused,
      TRUST_LIMITS.caValidityDays,
    );
    await writeCaFiles(root, planted.certPem, other.keyPem, 0o600);
    const anchorRemover = vi.fn(async () => {});
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath: join(root, "runtime-host"),
      detectCapabilities: capable,
      caTrustInstaller: async () => {
        throw new Error("install failed");
      },
      caTrustAnchorRemover: anchorRemover,
    });

    const result = await controller.install("abcdefghijklmnopabcdefghijklmnop");
    expect(result.ok).toBe(false);
    expect(anchorRemover).not.toHaveBeenCalled();
  });
});

describe("verify allowed_origins", () => {
  it("reports the pinned origins so a different extension ID can be detected", async () => {
    const hostPath = join(root, "runtime-host");
    const pinned = "abcdefghijklmnopabcdefghijklmnop";
    const controller = createRequestBodyTrustController({
      installRoot: root,
      manifestDir: root,
      hostPath,
      detectCapabilities: capable,
      caTrustInstaller: async () => {},
    });
    const installed = await controller.install(pinned);
    expect(installed.ok).toBe(true);
    await writeFile(hostPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(hostPath, 0o755);

    const checked = await controller.verify();
    expect(checked.allowedOrigins).toEqual([`chrome-extension://${pinned}/`]);
    expect(checked.manifestValid).toBe(true);
    expect(checked.binaryExists).toBe(true);
    expect(checked.binaryExecutable).toBe(true);
    expect(checked.caTrusted).toBe(true);
    expect(checked.reasons).toEqual([]);
    expect(checked.ok).toBe(true);
    expect(extensionOriginListed(pinned, checked.allowedOrigins)).toBe(true);

    const other = "bcdefghijklmnopabcdefghijklmnopa";
    expect(extensionOriginListed(other, checked.allowedOrigins)).toBe(false);
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sha1Of(certPem: string): string {
  return new X509Certificate(certPem).fingerprint
    .replaceAll(":", "")
    .toLowerCase();
}

function readDerLength(
  buf: Buffer,
  offset: number,
): { length: number; next: number } {
  const first = buf[offset] ?? 0;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    length = (length << 8) | (buf[offset + 1 + index] ?? 0);
  }
  return { length, next: offset + 1 + count };
}

function readTlv(
  buf: Buffer,
  offset: number,
): { tag: number; valueStart: number; valueEnd: number; end: number } {
  const tag = buf[offset] ?? 0;
  const { length, next } = readDerLength(buf, offset + 1);
  return { tag, valueStart: next, valueEnd: next + length, end: next + length };
}

function sequenceFields(
  buf: Buffer,
  valueStart: number,
  valueEnd: number,
): { tag: number; valueStart: number; valueEnd: number; end: number }[] {
  const fields = [];
  let offset = valueStart;
  while (offset < valueEnd) {
    const field = readTlv(buf, offset);
    fields.push(field);
    offset = field.end;
  }
  return fields;
}

/** PKCS#8 whose public modulus matches, but the private coefficient does not. */
function pkcs8WithInconsistentPrivateMaterial(privateKeyPem: string): string {
  const der = Buffer.from(
    createPrivateKey(privateKeyPem).export({ format: "der", type: "pkcs8" }),
  );
  const outer = readTlv(der, 0);
  const pkcs8Fields = sequenceFields(der, outer.valueStart, outer.valueEnd);
  const octet = pkcs8Fields[2];
  if (octet?.tag !== 0x04) {
    throw new Error("expected a PKCS#8 private key");
  }
  const rsa = readTlv(der, octet.valueStart);
  const rsaFields = sequenceFields(der, rsa.valueStart, rsa.valueEnd);
  const coefficient = rsaFields[8];
  if (coefficient?.tag !== 0x02) {
    throw new Error("expected an RSA private coefficient");
  }
  const copy = Buffer.from(der);
  for (
    let index = coefficient.valueStart;
    index < coefficient.valueEnd;
    index += 1
  ) {
    copy[index] = 0x11;
  }
  const encoded = copy
    .toString("base64")
    .replaceAll(/(.{64})/g, "$1\n")
    .replace(/\n$/, "");
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----\n`;
}

function spkiPem(privateKeyPem: string): string {
  return createPublicKey(privateKeyPem).export({
    type: "spki",
    format: "pem",
  });
}

async function writeCaFiles(
  dir: string,
  certPem: string,
  keyPem: string,
  keyMode: number,
): Promise<void> {
  await writeFile(join(dir, ".rogatio-ca.crt"), certPem, "utf8");
  await writeFile(join(dir, ".rogatio-ca.pub"), certPem, "utf8");
  await writeFile(join(dir, ".rogatio-ca.key"), keyPem, "utf8");
  await chmod(join(dir, ".rogatio-ca.key"), keyMode);
}
