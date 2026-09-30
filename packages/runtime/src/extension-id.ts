import { createHash } from "node:crypto";

/**
 * Chrome extension ID of the public `key` in
 * `packages/extension/public/manifest.json`.
 *
 * The extension package repeats this constant (it cannot import runtime).
 * Both copies are tested against the manifest key. Replacing the key
 * changes the ID; update both constants together.
 *
 * The matching private key is not in the repo. See
 * `docs/adrs/0011-stable-extension-id-key-custody.md`.
 */
export const RELEASE_EXTENSION_ID = "ieaimkhfimopjkfamallppgmdfadpbko";

const EXTENSION_ID_RE = /^[a-p]{32}$/;

/**
 * Chrome unpacked extension ID for a manifest `key`.
 *
 * `publicKeyBase64` is the base64 SPKI body (no PEM armor). Chrome hashes
 * those decoded bytes with SHA-256, keeps the first 16 bytes, and maps each
 * hex nibble onto `a`–`p`. The load path is not an input.
 */
export function extensionIdFromPublicKey(publicKeyBase64: string): string {
  const trimmed = publicKeyBase64.replace(/\s+/g, "");
  const der = Buffer.from(trimmed, "base64");
  const hex = createHash("sha256")
    .update(der)
    .digest()
    .subarray(0, 16)
    .toString("hex");
  let id = "";
  for (const nibble of hex) {
    const value = Number.parseInt(nibble, 16);
    id += String.fromCharCode("a".charCodeAt(0) + value);
  }
  return id;
}

/** `chrome-extension://<id>/` origin stored in native-messaging manifests. */
export function extensionOrigin(extensionId: string): string {
  return `chrome-extension://${extensionId}/`;
}

/**
 * True when `allowedOrigins` lists this extension.
 * Accepts the trailing-slash form the installer writes and the same origin
 * without the slash.
 */
export function extensionOriginListed(
  extensionId: string,
  allowedOrigins: readonly string[],
): boolean {
  if (!EXTENSION_ID_RE.test(extensionId)) return false;
  const origin = extensionOrigin(extensionId);
  const bare = origin.slice(0, -1);
  return allowedOrigins.some((value) => value === origin || value === bare);
}

/**
 * Actionable verify text when the host manifest is pinned to a different ID.
 * The command rewrites `allowed_origins`. Release builds omit the flag.
 */
export function describeExtensionIdMismatch(
  expectedExtensionId: string,
  allowedOrigins: readonly string[],
): string {
  const allowed =
    allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "(none)";
  const command =
    expectedExtensionId === RELEASE_EXTENSION_ID
      ? "rogatio runtime install"
      : `rogatio runtime install --extension-id ${expectedExtensionId}`;
  return [
    `Extension ID ${expectedExtensionId} is not in the host manifest allowed_origins.`,
    `The host manifest allows: ${allowed}.`,
    "Chrome refuses the connection until allowed_origins includes this ID (Access to the specified native messaging host is forbidden).",
    `Run: ${command}`,
  ].join("\n");
}
