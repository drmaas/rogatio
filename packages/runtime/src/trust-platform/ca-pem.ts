import { X509Certificate } from "node:crypto";

const MAX_CERTIFICATE_PEM_LENGTH = 16 * 1024;
const BEGIN_CERTIFICATE = "-----BEGIN CERTIFICATE-----";
const END_CERTIFICATE = "-----END CERTIFICATE-----";
const BODY_LINE = /^[A-Za-z0-9+/]{1,64}={0,2}$/;

/**
 * True only for one PEM CERTIFICATE block that Node can parse as a CA.
 * Extra text, a second certificate, or a non-CA certificate is refused.
 */
export function isInstallableCaCertificate(pem: string): boolean {
  if (
    typeof pem !== "string" ||
    pem.length === 0 ||
    pem.length > MAX_CERTIFICATE_PEM_LENGTH ||
    pem.includes("\0")
  ) {
    return false;
  }

  const normalized = pem.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.some((line) => line.trim() === "EOF")) return false;
  if (
    lines.length < 3 ||
    lines[0] !== BEGIN_CERTIFICATE ||
    lines[lines.length - 1] !== END_CERTIFICATE
  ) {
    return false;
  }
  if (lines.filter((line) => line === BEGIN_CERTIFICATE).length !== 1) {
    return false;
  }
  if (lines.filter((line) => line === END_CERTIFICATE).length !== 1) {
    return false;
  }

  const body = lines.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index] ?? "";
    if (!BODY_LINE.test(line)) return false;
    if (line.includes("=") && index !== body.length - 1) return false;
  }
  if (body.join("").length % 4 !== 0) return false;

  try {
    const certificate = new X509Certificate(`${lines.join("\n")}\n`);
    return certificate.ca;
  } catch {
    return false;
  }
}
