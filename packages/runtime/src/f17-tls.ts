import {
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
  X509Certificate,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { failure } from "./errors.js";
import type { RuntimeResult } from "./types.js";

export interface TLSCertificate {
  readonly cert: string;
  readonly key: string;
}

export interface TLSContext {
  readonly serverCertificate: TLSCertificate;
  readonly caCertificate: TLSCertificate;
}

interface MutableTLSContext {
  serverCertificate: TLSCertificate;
  caCertificate: TLSCertificate;
}

let cachedContext: MutableTLSContext | null = null;

export function loadTLSContext(
  caCertPath: string,
  caKeyPath: string,
): TLSContext {
  if (cachedContext) return cachedContext;

  const caCert = readFileSync(caCertPath, "utf-8");
  const caKey = readFileSync(caKeyPath, "utf-8");

  cachedContext = {
    serverCertificate: { cert: "", key: "" },
    caCertificate: { cert: caCert, key: caKey },
  };

  return cachedContext;
}

export function setServerCertificate(cert: string, key: string): void {
  if (!cachedContext) {
    cachedContext = {
      serverCertificate: { cert: "", key: "" },
      caCertificate: { cert: "", key: "" },
    };
  }
  cachedContext.serverCertificate = { cert, key };
}

export function generateLeafCertificate(
  hostname: string,
): RuntimeResult<TLSCertificate> {
  if (!cachedContext) {
    return failure("runtime.tls-ca-not-loaded");
  }

  try {
    const caCert = new X509Certificate(cachedContext.caCertificate.cert);
    const caKey = createPrivateKey({
      key: cachedContext.caCertificate.key,
      format: "pem",
      type: "pkcs8",
    });

    const leafKeyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicExponent: 0x10001,
    });
    const leafKey = leafKeyPair.privateKey;

    const leafCert = generateSimpleLeafCert(hostname, caCert, caKey, leafKey);

    return {
      ok: true,
      value: {
        cert: leafCert,
        key: leafKeyPair.privateKey
          .export({ format: "pem", type: "pkcs8" })
          .toString(),
      },
    };
  } catch {
    return failure("runtime.tls-leaf-generation-failed");
  }
}

function generateSimpleLeafCert(
  hostname: string,
  _caCert: X509Certificate,
  caKey: KeyObject,
  _leafKey: KeyObject,
): string {
  const tbs = `leaf-${hostname}-${Date.now()}`;
  const sign = createSign("sha256");
  sign.update(tbs);
  const signature = sign.sign(caKey);
  return `-----BEGIN CERTIFICATE-----\n${Buffer.from(`${tbs}.${signature.toString("base64")}`).toString("base64")}\n-----END CERTIFICATE-----`;
}

export function verifyHostname(cert: string, hostname: string): boolean {
  try {
    const x509 = new X509Certificate(cert);
    return (
      x509.subject.includes(`CN=${hostname}`) ||
      (x509.subjectAltName?.includes(hostname) ?? false)
    );
  } catch {
    return false;
  }
}
