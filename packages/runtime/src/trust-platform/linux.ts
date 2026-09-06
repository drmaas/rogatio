import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { join as posixJoin } from "node:path/posix";
import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import type { TrustPlatformAdapter } from "./types.js";

const CA_DIR = "/usr/local/share/ca-certificates";
const CERT_PATH = posixJoin(CA_DIR, "rogatio-ca.crt");

function hasSudo(): boolean {
  const result = spawnSync("sudo", ["-n", "true"], { timeout: 1000 });
  return result.status === 0;
}

const linuxAdapter: TrustPlatformAdapter = {
  platform: "linux",
  defaultManifestDir: () => {
    const home = process.env.HOME ?? "";
    return posixJoin(home, ".config/google-chrome/NativeMessagingHosts");
  },
  defaultCaInstallPath: () => CA_DIR,
  detect(): TrustCapabilities {
    const reasons: string[] = [];
    const manifestDir = this.defaultManifestDir();

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

    // The system CA dir (/usr/local/share/ca-certificates) requires root to
    // write.  Check whether it is directly writable; if not, check whether
    // passwordless sudo is available.  If neither, report elevation-required.
    try {
      accessSync(CA_DIR, constants.W_OK);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        // Directory doesn't exist yet — check if the parent is writable
        // so mkdirSync({ recursive: true }) in the installer can create it.
        try {
          accessSync(dirname(CA_DIR), constants.W_OK);
        } catch {
          if (!hasSudo()) {
            reasons.push("elevation-required");
          }
        }
      } else if (!hasSudo()) {
        reasons.push("elevation-required");
      }
    }

    const manifest =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("manifest-dir-unwritable");
    const caTrust =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("elevation-required");

    return {
      manifest,
      caTrust,
      reasons: [...new Set(reasons)].sort(),
    };
  },
  async caTrustInstaller(certPem: string): Promise<void> {
    try {
      mkdirSync(CA_DIR, { recursive: true });
    } catch {
      throw new TrustError("trust.internal", "ca-store-unwritable", [
        "ca-store-unwritable",
      ]);
    }

    const certResult = await new Promise<{ code: number; stderr: string }>(
      (resolve) => {
        const child = spawn("sudo", [
          "sh",
          "-c",
          `cat > "${CERT_PATH}" << 'EOF'\n${certPem}\nEOF`,
        ]);
        let stderr = "";
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
        child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
      },
    );

    if (certResult.code !== 0) {
      const stderr = certResult.stderr.toLowerCase();
      let reason: "ca-store-unwritable" | "elevation-required" =
        "ca-store-unwritable";
      if (
        stderr.includes("permission") ||
        stderr.includes("not permitted") ||
        stderr.includes("no tty") ||
        stderr.includes("terminal")
      ) {
        reason = "elevation-required";
      }
      throw new TrustError("trust.internal", reason, [reason]);
    }

    const result = await new Promise<{ code: number; stderr: string }>(
      (resolve) => {
        const child = spawn("sudo", ["update-ca-certificates"]);
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
      let reason: "ca-store-unwritable" | "elevation-required" =
        "ca-store-unwritable";
      if (
        stderr.includes("permission") ||
        stderr.includes("not permitted") ||
        stderr.includes("no tty") ||
        stderr.includes("terminal")
      ) {
        reason = "elevation-required";
      }
      throw new TrustError("trust.internal", reason, [reason]);
    }
  },
  async caTrustRemover(): Promise<void> {
    try {
      unlinkSync(CERT_PATH);
    } catch {
      // Ignore "not found" errors
    }

    // Idempotent removal: we intentionally do not run update-ca-certificates
    // as it's not strictly necessary for removing trust and avoids permission issues
  },
};

export default linuxAdapter;
