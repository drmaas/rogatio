import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync, readSync } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { writeExclusiveCertificate } from "../../src/trust-platform/private-cert-file.js";
import { createCertificate, generateCaKeyPair } from "../../src/x509.js";

describe("writeExclusiveCertificate", () => {
  let caPem = "";

  beforeAll(async () => {
    const created = await createCertificate(
      "CN=Rogatio Request-Body CA",
      generateCaKeyPair().privateKey,
      3650,
    );
    caPem = created.certPem;
  });

  it("does not replace an existing regular file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rogatio-ca-"));
    const certPath = join(dir, "ca.crt");
    try {
      await writeFile(certPath, "keep");
      await expect(
        writeExclusiveCertificate(certPath, caPem),
      ).rejects.toThrow();
      expect(await readFile(certPath, "utf8")).toBe("keep");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not follow an existing symlink", async (ctx) => {
    const dir = await mkdtemp(join(tmpdir(), "rogatio-ca-"));
    const sink = join(dir, "sink.crt");
    const certPath = join(dir, "ca.crt");
    try {
      await writeFile(sink, "sink-bytes");
      try {
        await symlink(sink, certPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "ENOTSUP") ctx.skip();
        throw error;
      }
      await expect(
        writeExclusiveCertificate(certPath, caPem),
      ).rejects.toThrow();
      expect(await readFile(sink, "utf8")).toBe("sink-bytes");
      expect((await lstat(certPath)).isSymbolicLink()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not open an existing fifo", async (ctx) => {
    if (process.platform === "win32") ctx.skip();
    const dir = await mkdtemp(join(tmpdir(), "rogatio-ca-"));
    const certPath = join(dir, "ca.crt");
    let reader = -1;
    try {
      try {
        execFileSync("mkfifo", [certPath]);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") ctx.skip();
        throw error;
      }
      reader = openSync(certPath, constants.O_RDONLY | constants.O_NONBLOCK);
      await expect(
        writeExclusiveCertificate(certPath, caPem),
      ).rejects.toThrow();
      const buf = Buffer.alloc(32);
      let bytes = 0;
      try {
        bytes = readSync(reader, buf, 0, buf.length, null);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EAGAIN" && code !== "EWOULDBLOCK") throw error;
      }
      expect(bytes).toBe(0);
      expect((await lstat(certPath)).isFIFO()).toBe(true);
    } finally {
      if (reader >= 0) closeSync(reader);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
