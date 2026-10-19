import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { join as posixJoin } from "node:path/posix";
import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import {
  withInstallCertificateFile,
  writeExclusiveCertificate,
} from "./private-cert-file.js";
import type { TrustPlatformAdapter } from "./types.js";

const PREVIOUS_CA_PEM_MAX_BYTES = 16 * 1024;

function spawnSecurity(
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("security", [...args]);
    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
  });
}

function securityMiss(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return text.includes("not found") || text.includes("does not exist");
}

const darwinAdapter: TrustPlatformAdapter = {
  platform: "darwin",
  defaultManifestDir: () => {
    const home = process.env.HOME ?? "";
    return posixJoin(
      home,
      "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    );
  },
  defaultCaInstallPath: () => {
    const home = process.env.HOME ?? "";
    return posixJoin(home, "Library/Keychains/login.keychain-db");
  },
  detect(): TrustCapabilities {
    const reasons: string[] = [];
    const manifestDir = this.defaultManifestDir();
    const caDir = dirname(this.defaultCaInstallPath());

    const security = spawnSync("which", ["security"], { timeout: 1000 });
    if (security.status !== 0) {
      reasons.push("tooling-missing");
    }

    try {
      accessSync(manifestDir, constants.W_OK);
    } catch {
      reasons.push("manifest-dir-unwritable");
    }

    try {
      accessSync(caDir, constants.W_OK);
    } catch {
      reasons.push("keychain-unwritable");
    }

    const manifest =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("manifest-dir-unwritable");
    const caTrust =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("keychain-unwritable");

    return {
      manifest,
      caTrust,
      reasons: [...new Set(reasons)].sort(),
    };
  },
  async caTrustInstaller(certPem: string): Promise<void> {
    const keychain = this.defaultCaInstallPath();
    try {
      await withInstallCertificateFile(certPem, async (certPath) => {
        const result = await spawnSecurity([
          "add-trusted-cert",
          "-d",
          "-r",
          "trustRoot",
          "-k",
          keychain,
          certPath,
        ]);
        if (result.code !== 0) {
          const stderr = result.stderr.toLowerCase();
          let reason = "keychain-unwritable";
          if (stderr.includes("permission") || stderr.includes("auth")) {
            reason = "keychain-unwritable";
          }
          throw new TrustError("trust.internal", reason, [reason]);
        }
      });
    } catch (error) {
      if (error instanceof TrustError) throw error;
      throw new TrustError("trust.internal", "keychain-unwritable", [
        "keychain-unwritable",
      ]);
    }
  },
  async caTrustRemover(): Promise<void> {
    const keychain = this.defaultCaInstallPath();

    const result = await new Promise<{ code: number; stderr: string }>(
      (resolve) => {
        const child = spawn("security", [
          "delete-certificate",
          "-c",
          "CN=Rogatio Request-Body CA",
          keychain,
        ]);
        let stderr = "";
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
        child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
      },
    );

    // Ignore "not found" errors (certificate already removed)
    if (result.code !== 0) {
      const stderr = result.stderr.toLowerCase();
      if (!stderr.includes("not found") && !stderr.includes("does not exist")) {
        throw new TrustError("trust.internal", "keychain-unwritable", [
          "keychain-unwritable",
        ]);
      }
    }
  },
  async caTrustAnchorRemover(
    fingerprintSha1: string,
    certPem: string,
  ): Promise<void> {
    if (!/^[0-9a-f]{40}$/.test(fingerprintSha1)) {
      throw new TrustError("trust.internal", "invalid-ca-certificate", [
        "invalid-ca-certificate",
      ]);
    }
    if (
      typeof certPem !== "string" ||
      certPem.length === 0 ||
      certPem.length > PREVIOUS_CA_PEM_MAX_BYTES
    ) {
      throw new TrustError("trust.internal", "invalid-ca-certificate", [
        "invalid-ca-certificate",
      ]);
    }
    const keychain = this.defaultCaInstallPath();
    const dir = await mkdtemp(join(tmpdir(), "rogatio-ca-"));
    const tmpPath = join(dir, "previous.crt");
    let failed = false;
    try {
      await writeExclusiveCertificate(tmpPath, certPem);
      const trust = await spawnSecurity(["remove-trusted-cert", "-d", tmpPath]);
      if (trust.code !== 0 && !securityMiss(trust.stderr)) failed = true;
      const item = await spawnSecurity([
        "delete-certificate",
        "-Z",
        fingerprintSha1,
        keychain,
      ]);
      if (item.code !== 0 && !securityMiss(item.stderr)) failed = true;
    } catch (error) {
      if (error instanceof TrustError) throw error;
      failed = true;
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Cleanup must not mask the removal result or include the path.
      }
    }
    if (failed) {
      throw new TrustError("trust.internal", "keychain-unwritable", [
        "keychain-unwritable",
      ]);
    }
  },
};

export default darwinAdapter;
