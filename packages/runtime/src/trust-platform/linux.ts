import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { join as posixJoin } from "node:path/posix";
import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import { isInstallableCaCertificate } from "./ca-pem.js";
import type { TrustPlatformAdapter } from "./types.js";

const CA_DIR = "/usr/local/share/ca-certificates";
const CERT_PATH = posixJoin(CA_DIR, "rogatio-ca.crt");

function hasSudo(): boolean {
  const result = spawnSync("which", ["sudo"], { timeout: 1000 });
  return result.status === 0;
}

function installFailureReason(
  stderr: string,
): "ca-store-unwritable" | "elevation-required" {
  const text = stderr.toLowerCase();
  if (
    text.includes("permission") ||
    text.includes("not permitted") ||
    text.includes("no tty") ||
    text.includes("terminal")
  ) {
    return "elevation-required";
  }
  return "ca-store-unwritable";
}

/**
 * Run an argv-only sudo command. Certificate bytes, when present, are written
 * to stdin and never interpolated into a shell command. Stdout is discarded.
 */
function runSudo(
  args: readonly string[],
  stdin?: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr });
    };
    const child = spawn("sudo", [...args], {
      stdio: [stdin === undefined ? "ignore" : "pipe", "ignore", "pipe"],
    });
    child.stderr?.on("data", (data: Buffer | string) => {
      stderr += data.toString();
    });
    child.on("error", (err: Error) => {
      stderr += err.message;
      finish(1);
    });
    child.on("close", (code: number | null) => {
      finish(code ?? 1);
    });
    if (stdin === undefined) return;
    const input = child.stdin;
    if (!input) {
      finish(1);
      return;
    }
    input.on("error", () => {
      // sudo may exit before it reads stdin
    });
    input.end(stdin);
  });
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
    // sudo is installed.  If neither, report elevation-required.
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
    if (!isInstallableCaCertificate(certPem)) {
      throw new TrustError("trust.internal", "invalid-ca-certificate", [
        "invalid-ca-certificate",
      ]);
    }
    try {
      mkdirSync(CA_DIR, { recursive: true });
    } catch {
      throw new TrustError("trust.internal", "ca-store-unwritable", [
        "ca-store-unwritable",
      ]);
    }

    const certResult = await runSudo(["tee", CERT_PATH], certPem);
    if (certResult.code !== 0) {
      const reason = installFailureReason(certResult.stderr);
      throw new TrustError("trust.internal", reason, [reason]);
    }

    const result = await runSudo(["update-ca-certificates"]);
    if (result.code !== 0) {
      const reason = installFailureReason(result.stderr);
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
  async caTrustAnchorRemover(
    fingerprintSha1: string,
    certPem: string,
  ): Promise<void> {
    // The installer replaces rogatio-ca.crt and update-ca-certificates rebuilds
    // the bundle, so there is no separate anchor to delete.
    void fingerprintSha1;
    void certPem;
  },
};

export default linuxAdapter;
