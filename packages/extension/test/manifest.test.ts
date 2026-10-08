import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_EXTENSION_ID } from "../src/extension-id.js";

const manifestPath = resolve(import.meta.dirname, "../public/manifest.json");

/**
 * Chrome unpacked ID: SHA-256 of the decoded manifest `key`, first 16 bytes,
 * each hex nibble mapped onto a–p. The folder path is not an input, so two
 * unpack directories that share this key share this ID.
 */
function extensionIdFromPublicKey(publicKeyBase64: string): string {
  const der = Buffer.from(publicKeyBase64.replace(/\s+/g, ""), "base64");
  const hex = createHash("sha256")
    .update(der)
    .digest()
    .subarray(0, 16)
    .toString("hex");
  let id = "";
  for (const nibble of hex) {
    id += String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16));
  }
  return id;
}

describe("extension manifest", () => {
  it("includes match-logging permissions and broad host_permissions", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    expect(manifest.permissions).toEqual([
      "storage",
      "declarativeNetRequest",
      "declarativeNetRequestFeedback",
      "scripting",
      "nativeMessaging",
      "proxy",
    ]);
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.host_permissions).toEqual(["*://*/*"]);
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  it("pins a stable extension ID from the public key", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      key?: string;
    };
    expect(typeof manifest.key).toBe("string");
    const key = manifest.key ?? "";
    expect(key).not.toMatch(/PRIVATE KEY|BEGIN /);
    expect(key.startsWith("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A")).toBe(true);
    const derived = extensionIdFromPublicKey(key);
    expect(derived).toBe(extensionIdFromPublicKey(key));
    expect(derived).toMatch(/^[a-p]{32}$/);
    expect(derived).toBe(RELEASE_EXTENSION_ID);
  });
});
