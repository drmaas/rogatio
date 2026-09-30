/**
 * Chrome extension ID of the public `key` in `public/manifest.json`.
 *
 * Must match `RELEASE_EXTENSION_ID` in `@rogatio/runtime`. The manifest unit
 * test derives the ID from the key and fails if this constant drifts.
 * See `docs/adrs/0011-stable-extension-id-key-custody.md`.
 */
export const RELEASE_EXTENSION_ID = "ieaimkhfimopjkfamallppgmdfadpbko";

const EXTENSION_ID_RE = /^[a-p]{32}$/;

/** Install command that pins `allowed_origins` to the loaded extension. */
export function runtimeInstallCommand(extensionId: string): string {
  if (extensionId === RELEASE_EXTENSION_ID) return "rogatio runtime install";
  if (EXTENSION_ID_RE.test(extensionId)) {
    return `rogatio runtime install --extension-id ${extensionId}`;
  }
  return "rogatio runtime install --extension-id <extension ID>";
}

/**
 * Runtime-card copy when Chrome rejects connectNative because this ID is
 * absent from the host manifest `allowed_origins`.
 */
export function nativeHostOriginMismatchMessage(extensionId: string): string {
  const command = runtimeInstallCommand(extensionId);
  const idText = EXTENSION_ID_RE.test(extensionId) ? extensionId : "unknown";
  return `This extension ID (${idText}) is not in the native host manifest allowed_origins. Chrome refused the connection. Run \`${command}\`, reload the extension at chrome://extensions, then click Start runtime again.`;
}

/**
 * Chrome's native-messaging rejection when the caller is not in
 * `allowed_origins`. The host process is never started.
 */
export function isNativeHostOriginForbiddenMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("extension.native-host-origin-forbidden") ||
    normalized.includes(
      "access to the specified native messaging host is forbidden",
    ) ||
    normalized.includes("native messaging host is forbidden")
  );
}
