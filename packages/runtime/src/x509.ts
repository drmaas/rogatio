import "reflect-metadata";
import { generateKeyPairSync, type KeyObject, webcrypto } from "node:crypto";
import {
  BasicConstraintsExtension,
  Name,
  PemConverter,
  type PublicKeyType,
  X509Certificate,
  X509CertificateGenerator,
} from "@peculiar/x509";

const crypto = webcrypto.subtle;

/**
 * Creates a self-signed X.509 CA certificate with proper basic constraints.
 * Returns PEM-encoded certificate and private key.
 */
export async function createCertificate(
  subjectName: string,
  _privateKey: KeyObject,
  validityDays: number,
): Promise<{ certPem: string; keyPem: string }> {
  const keyPair = await crypto.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const name = new Name([{ CN: [subjectName] }]);

  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setDate(notAfter.getDate() + validityDays);

  const basicConstraints = new BasicConstraintsExtension(true, 0, true);

  const cert = await X509CertificateGenerator.createSelfSigned({
    name,
    keys: keyPair as globalThis.CryptoKeyPair,
    notBefore,
    notAfter,
    extensions: [basicConstraints],
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  });

  const certPem = PemConverter.encode(cert.rawData, "CERTIFICATE");
  const keyPem = PemConverter.encode(
    await crypto.exportKey("pkcs8", keyPair.privateKey),
    "PRIVATE KEY",
  );

  return { certPem, keyPem };
}

/**
 * Signs a leaf certificate for the given hostname using the CA private key.
 */
export async function signCertificate(
  hostname: string,
  caCertPem: string,
  caKeyPem: string,
  validityDays: number,
): Promise<string> {
  const caCert = new X509Certificate(caCertPem);
  const caKey = await crypto.importKey(
    "pkcs8",
    PemConverter.decodeFirst(caKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const leafKeyPair = await crypto.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const name = new Name([{ CN: [hostname] }]);

  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setDate(notAfter.getDate() + validityDays);

  const cert = await X509CertificateGenerator.create({
    subject: name,
    issuer: caCert.subjectName,
    publicKey: leafKeyPair.publicKey as PublicKeyType,
    signingKey: caKey as unknown as CryptoKey,
    notBefore,
    notAfter,
    extensions: [],
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  });

  return PemConverter.encode(cert.rawData, "CERTIFICATE");
}

/**
 * Generates a new CA key pair.
 */
export function generateCaKeyPair(bits: number = 2048): {
  privateKey: KeyObject;
  publicKey: KeyObject;
} {
  return generateKeyPairSync("rsa", { modulusLength: bits });
}
