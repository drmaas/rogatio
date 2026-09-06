import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { join as posixJoin } from "node:path/posix";
import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import type { TrustPlatformAdapter } from "./types.js";

const linuxAdapter: TrustPlatformAdapter = {
  platform: "linux",
  defaultManifestDir: () => {
    const home = process.env.HOME ?? "";
    return posixJoin(home, ".config/google-chrome/NativeMessagingHosts");
  },
  defaultCaInstallPath: () => {
    const home = process.env.HOME ?? "";
    return posixJoin(home, ".local/share/ca-certificates");
  },
  detect(): TrustCapabilities {
    const reasons: string[] = [];
    const manifestDir = this.defaultManifestDir();
    const caDir = this.defaultCaInstallPath();

    const updateCa = spawnSync("which", ["update-ca-certificates"], {
      timeout: 1000,
    });
    if (updateCa.status !== 0) {
      reasons.push("tooling-missing");
    }

    try {
      accessSync(manifestDir, constants.W_OK);
    } catch {
      reasons.push("manifest-dir-unwritable");
    }

    try {
      accessSync(caDir, constants.W_OK);
    } catch (err: unknown) {
      // Directory doesn't exist yet — check if the parent is writable
      // so mkdirSync({ recursive: true }) in the installer can create it.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        try {
          accessSync(dirname(caDir), constants.W_OK);
        } catch {
          reasons.push("ca-store-unwritable");
        }
      } else {
        reasons.push("ca-store-unwritable");
      }
    }

    const manifest =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("manifest-dir-unwritable");
    const caTrust =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("ca-store-unwritable");

    return {
      manifest,
      caTrust,
      reasons: [...new Set(reasons)].sort(),
    };
  },
  async caTrustInstaller(certPem: string): Promise<void> {
    const caDir = this.defaultCaInstallPath();
    const certPath = posixJoin(caDir, "rogatio-ca.crt");

    try {
      mkdirSync(caDir, { recursive: true });
    } catch {
      throw new TrustError("trust.internal", "ca-store-unwritable", [
        "ca-store-unwritable",
      ]);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("sh", [
          "-c",
          `cat > "${certPath}" << 'EOF'\n${certPem}\nEOF`,
        ]);
        child.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`exit code ${code}`)),
        );
        child.on("error", reject);
      });
    } catch {
      throw new TrustError("trust.internal", "ca-store-unwritable", [
        "ca-store-unwritable",
      ]);
    }

    const result = await new Promise<{ code: number; stderr: string }>(
      (resolve) => {
        const child = spawn("update-ca-certificates");
        let stderr = "";
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
        child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
      },
    );

    if (result.code !== 0) {
      const stderr = result.stderr.toLowerCase();
      let reason = "ca-store-unwritable";
      if (stderr.includes("permission") || stderr.includes("not permitted")) {
        reason = "ca-store-unwritable";
      }
      throw new TrustError("trust.internal", reason, [reason]);
    }
  },
  async caTrustRemover(): Promise<void> {
    const caDir = this.defaultCaInstallPath();
    const certPath = posixJoin(caDir, "rogatio-ca.crt");

    try {
      unlinkSync(certPath);
    } catch {
      // Ignore "not found" errors
    }

    // Idempotent removal: we intentionally do not run update-ca-certificates
    // as it's not strictly necessary for removing trust and avoids permission issues
  },
};

export default linuxAdapter;
