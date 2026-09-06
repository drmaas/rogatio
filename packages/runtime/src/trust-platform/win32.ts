import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import type { TrustPlatformAdapter } from "./types.js";

const win32Adapter: TrustPlatformAdapter = {
  platform: "win32",
  defaultManifestDir: () => {
    const appdata = process.env.APPDATA ?? "";
    return join(appdata, "Google", "Chrome", "NativeMessagingHosts");
  },
  defaultCaInstallPath: () => {
    return "Cert:\\CurrentUser\\Root";
  },
  detect(): TrustCapabilities {
    const reasons: string[] = [];
    const manifestDir = this.defaultManifestDir();

    const certutil = spawnSync("where", ["certutil"], { timeout: 1000 });
    if (certutil.status !== 0) {
      reasons.push("tooling-missing");
    }

    try {
      accessSync(manifestDir, constants.W_OK);
    } catch {
      reasons.push("manifest-dir-unwritable");
    }

    // Note: Cert:\CurrentUser\Root is not a filesystem path, so we don't probe it
    // caTrust capability = certutil presence only

    const manifest =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("manifest-dir-unwritable");
    const caTrust = !reasons.includes("tooling-missing");

    return {
      manifest,
      caTrust,
      reasons: [...new Set(reasons)].sort(),
    };
  },
  async caTrustInstaller(certPem: string): Promise<void> {
    const tmpPath = join(tmpdir(), `rogatio-ca-${Date.now()}.crt`);

    try {
      writeFileSync(tmpPath, certPem, "utf8");
    } catch {
      throw new TrustError("trust.internal", "elevation-required", [
        "elevation-required",
      ]);
    }

    const result = await new Promise<{ code: number; stderr: string }>(
      (resolve) => {
        const child = spawn("certutil", ["-addstore", "-f", "Root", tmpPath]);
        let stderr = "";
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
        child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
      },
    );

    try {
      unlinkSync(tmpPath);
    } catch {
      // best effort cleanup
    }

    if (result.code !== 0) {
      const stderr = result.stderr.toLowerCase();
      let reason = "elevation-required";
      if (stderr.includes("access denied") || stderr.includes("permission")) {
        reason = "elevation-required";
      }
      throw new TrustError("trust.internal", reason, [reason]);
    }
  },
  async caTrustRemover(): Promise<void> {
    const result = await new Promise<{ code: number; stderr: string }>(
      (resolve) => {
        const child = spawn("certutil", [
          "-delstore",
          "Root",
          "CN=Rogatio Request-Body CA",
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
      if (
        !stderr.includes("not found") &&
        !stderr.includes("does not exist") &&
        !stderr.includes("cannot find")
      ) {
        throw new TrustError("trust.internal", "elevation-required", [
          "elevation-required",
        ]);
      }
    }
  },
};

export default win32Adapter;
