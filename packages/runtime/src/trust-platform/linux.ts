import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { join as posixJoin } from "node:path/posix";
import type { TrustCapabilities } from "../trust.js";
import { TrustError } from "../trust.js";
import { isInstallableCaCertificate } from "./ca-pem.js";
import type { TrustPlatformAdapter } from "./types.js";

const CA_DIR = "/usr/local/share/ca-certificates";
const CERT_NAME = "rogatio-ca.crt";
const DEBIAN_CERT = posixJoin(CA_DIR, CERT_NAME);
const ARCH_TRUST_SOURCE = "/etc/ca-certificates/trust-source";
const FEDORA_TRUST_SOURCE = "/etc/pki/ca-trust/source";
const ARCH_ANCHORS = "/etc/ca-certificates/trust-source/anchors";
const FEDORA_ANCHORS = "/etc/pki/ca-trust/source/anchors";
const P11_CERTS = [
  posixJoin(ARCH_ANCHORS, CERT_NAME),
  posixJoin(FEDORA_ANCHORS, CERT_NAME),
] as const;
const BROWSERS = ["google-chrome", "chromium"] as const;

function nodeCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.length > 0 ? code : "EACCES";
}

function exists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch (err: unknown) {
    return nodeCode(err) !== "ENOENT";
  }
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `which` is a separate package on some Linux installs. When that binary is
 * missing, walk PATH. A non-zero `which` result still means the tool is absent.
 */
function toolOnPath(name: string): boolean {
  const result = spawnSync("which", [name], { timeout: 1000 });
  if (result.status === 0) return true;
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (code !== "ENOENT") return false;
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (dir.length === 0) continue;
    try {
      accessSync(posixJoin(dir, name));
      return true;
    } catch {
      // Keep scanning PATH.
    }
  }
  return false;
}

function caBackend(): "debian" | "p11kit" | undefined {
  if (toolOnPath("update-ca-certificates")) return "debian";
  if (toolOnPath("update-ca-trust")) return "p11kit";
  return undefined;
}

/**
 * The anchors directory the installed `update-ca-trust` reads.
 * Arch scans `/etc/ca-certificates/trust-source`. Fedora and RHEL scan
 * `/etc/pki/ca-trust/source`. If both trees exist, or neither does, there is
 * no safe directory to choose.
 */
function p11kitAnchorsDir(): string | undefined {
  const arch = exists(ARCH_TRUST_SOURCE);
  const fedora = exists(FEDORA_TRUST_SOURCE);
  if (arch && !fedora) return ARCH_ANCHORS;
  if (fedora && !arch) return FEDORA_ANCHORS;
  return undefined;
}

function needsElevation(dir: string): boolean {
  if (writable(dir)) return false;
  try {
    accessSync(dir, constants.W_OK);
  } catch (err: unknown) {
    if (nodeCode(err) === "ENOENT" && writable(dirname(dir))) return false;
  }
  return !toolOnPath("sudo");
}

function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (typeof xdg === "string" && xdg.startsWith("/")) return xdg;
  const home = process.env.HOME ?? "";
  return posixJoin(home, ".config");
}

function manifestDirFor(browser: (typeof BROWSERS)[number]): string {
  return posixJoin(configHome(), browser, "NativeMessagingHosts");
}

function canHostManifest(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch (err: unknown) {
    if (nodeCode(err) !== "ENOENT") return false;
  }
  try {
    accessSync(dirname(dir), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function installableManifestDirs(): string[] {
  return BROWSERS.map(manifestDirFor).filter(canHostManifest);
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

async function sudoOrThrow(
  args: readonly string[],
  stdin?: string,
): Promise<void> {
  const result = await runSudo(args, stdin);
  if (result.code === 0) return;
  const reason = installFailureReason(result.stderr);
  throw new TrustError("trust.internal", reason, [reason]);
}

const linuxAdapter: TrustPlatformAdapter = {
  platform: "linux",
  defaultManifestDir: () => {
    const home = process.env.HOME ?? "";
    return posixJoin(home, ".config/google-chrome/NativeMessagingHosts");
  },
  manifestDirs: () => installableManifestDirs(),
  defaultCaInstallPath: () => CA_DIR,
  detect(): TrustCapabilities {
    const reasons: string[] = [];
    const backend = caBackend();
    if (!backend) reasons.push("tooling-missing");
    if (installableManifestDirs().length === 0) {
      reasons.push("manifest-dir-unwritable");
    }
    if (backend === "debian") {
      if (needsElevation(CA_DIR)) reasons.push("elevation-required");
    } else if (backend === "p11kit") {
      const anchors = p11kitAnchorsDir();
      if (!anchors) reasons.push("ca-store-unwritable");
      else if (needsElevation(anchors)) reasons.push("elevation-required");
    }

    const manifest =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("manifest-dir-unwritable");
    const caTrust =
      !reasons.includes("tooling-missing") &&
      !reasons.includes("elevation-required") &&
      !reasons.includes("ca-store-unwritable");

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
    if (caBackend() === "debian") {
      try {
        mkdirSync(CA_DIR, { recursive: true });
      } catch {
        throw new TrustError("trust.internal", "ca-store-unwritable", [
          "ca-store-unwritable",
        ]);
      }
      await sudoOrThrow(["tee", DEBIAN_CERT], certPem);
      await sudoOrThrow(["update-ca-certificates"]);
      return;
    }
    if (caBackend() !== "p11kit") {
      throw new TrustError("trust.internal", "tooling-missing", [
        "tooling-missing",
      ]);
    }
    const anchors = p11kitAnchorsDir();
    if (!anchors) {
      throw new TrustError("trust.internal", "ca-store-unwritable", [
        "ca-store-unwritable",
      ]);
    }
    const certPath = posixJoin(anchors, CERT_NAME);
    await sudoOrThrow(["mkdir", "-p", anchors]);
    await sudoOrThrow(["tee", certPath], certPem);
    const refresh = await runSudo(["update-ca-trust"]);
    if (refresh.code === 0) return;
    await sudoOrThrow(["rm", "-f", certPath]);
    const rebuilt = await runSudo(["update-ca-trust"]);
    if (rebuilt.code !== 0) {
      const reason = installFailureReason(rebuilt.stderr);
      throw new TrustError("trust.internal", reason, [reason]);
    }
    const reason = installFailureReason(refresh.stderr);
    throw new TrustError("trust.internal", reason, [reason]);
  },
  async caTrustRemover(): Promise<void> {
    try {
      unlinkSync(DEBIAN_CERT);
    } catch {
      // Ignore "not found" errors. Debian removal does not run
      // update-ca-certificates.
    }
    if (!toolOnPath("update-ca-trust")) return;
    const present = P11_CERTS.filter((path) => exists(path));
    // Debian hosts refresh only when an anchors file is actually present.
    // A p11-kit host must refresh even after the file is gone: `sudo rm`
    // can succeed and `update-ca-trust` can fail, and the next retry would
    // otherwise leave the extracted bundle trusting the CA.
    if (caBackend() !== "p11kit" && present.length === 0) return;
    for (const certPath of present) {
      await sudoOrThrow(["rm", "-f", certPath]);
    }
    await sudoOrThrow(["update-ca-trust"]);
  },
  async caTrustAnchorRemover(
    fingerprintSha1: string,
    certPem: string,
  ): Promise<void> {
    // Debian rebuilds the bundle from rogatio-ca.crt. p11-kit refresh does
    // the same from the anchors file. There is no separate anchor to delete.
    void fingerprintSha1;
    void certPem;
  },
};

export default linuxAdapter;
