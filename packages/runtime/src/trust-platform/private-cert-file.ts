import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrustError } from "../trust.js";
import { isInstallableCaCertificate } from "./ca-pem.js";

const INSTALL_CERT_NAME = "ca.crt";

function optionalFlag(flag: number | undefined): number {
  return typeof flag === "number" ? flag : 0;
}

function exclusiveWriteFlags(): number {
  return (
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_EXCL |
    constants.O_TRUNC |
    optionalFlag(constants.O_NOFOLLOW)
  );
}

function readFlags(): number {
  return (
    constants.O_RDONLY |
    optionalFlag(constants.O_NOFOLLOW) |
    optionalFlag(constants.O_NONBLOCK)
  );
}

function refuseCertificateFile(message: string): never {
  throw new TrustError("trust.internal", message, [
    "certificate-file-rejected",
  ]);
}

/**
 * Create `certPath` only when no file is already there, mode 0o600.
 * An existing symlink or fifo is left untouched.
 */
export async function writeExclusiveCertificate(
  certPath: string,
  pem: string,
): Promise<void> {
  const handle = await open(certPath, exclusiveWriteFlags(), 0o600);
  try {
    await handle.writeFile(Buffer.from(pem, "utf8"));
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

/**
 * Re-read `certPath` without following a symlink. Refuse when it is not a
 * regular file, its bytes differ, or it is not a single CA certificate.
 */
async function assertCertificateReady(
  certPath: string,
  pem: string,
): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(certPath);
  } catch {
    refuseCertificateFile("certificate file is not a regular file");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.isFIFO()) {
    refuseCertificateFile("certificate file is not a regular file");
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(certPath, readFlags());
    const opened = await handle.stat();
    if (!opened.isFile() || opened.isFIFO() || opened.isSymbolicLink()) {
      refuseCertificateFile("certificate file is not a regular file");
    }
    const bytes = await handle.readFile();
    if (!bytes.equals(Buffer.from(pem, "utf8"))) {
      refuseCertificateFile(
        "certificate file does not match the certificate to install",
      );
    }
    if (!isInstallableCaCertificate(bytes.toString("utf8"))) {
      throw new TrustError("trust.internal", "invalid-ca-certificate", [
        "invalid-ca-certificate",
      ]);
    }
  } catch (error) {
    if (error instanceof TrustError) throw error;
    refuseCertificateFile("certificate file is not a regular file");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Write the certificate into a fresh private temp directory, re-check it,
 * then run `use`. The directory is removed when `use` returns or throws.
 */
export async function withInstallCertificateFile(
  pem: string,
  use: (certPath: string) => Promise<void>,
): Promise<void> {
  if (!isInstallableCaCertificate(pem)) {
    throw new TrustError("trust.internal", "invalid-ca-certificate", [
      "invalid-ca-certificate",
    ]);
  }
  const directory = await mkdtemp(join(tmpdir(), "rogatio-ca-"));
  try {
    const certPath = join(directory, INSTALL_CERT_NAME);
    await writeExclusiveCertificate(certPath, pem);
    await assertCertificateReady(certPath, pem);
    await use(certPath);
  } finally {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      // Cleanup must not mask the install result or include the path.
    }
  }
}
