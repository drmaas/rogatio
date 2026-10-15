> Status: frozen 2026-10-14

# Plan: Arch CA trust and Chromium host manifest

Audience: hybrid

## Architecture

- `packages/runtime/src/trust-platform/linux.ts` picks the CA backend by the tool on PATH. Debian stays first. p11-kit runs only when `update-ca-trust` is the tool that will refresh the store, and only into the anchors tree that exists for that tool.
- The same file lists installable native-messaging directories for Google Chrome and Chromium. `defaultManifestDir()` stays the Google Chrome path.
- `createRequestBodyTrustController` writes every directory it is given, records that list under the install root, and uses the record for status, verify, and uninstall. Rollback restores previous manifest bytes.
- `createInstalledTrustController` passes the linux directory list. macOS and Windows stay on one directory.
- The CLI hint text matches the tools and browsers above.

Rejected: calling `trust anchor --store` on the anchors file. That stores a second object. Rejected: creating `~/.config/google-chrome` when Chrome has never run. Rejected: treating a later Chromium config directory as a failed install.

## Tasks

1. Extend the linux detect and install tests for `update-ca-trust`, Arch anchors, Fedora anchors, and Chromium. Covers AC-001 through AC-005 and AC-010.
2. Extend the trust controller tests for multi-directory write, restore, and recorded verify. Covers AC-006 through AC-008.
3. Implement the linux adapter and the controller record. Keep Debian remove spawn-free when no p11-kit anchor file is present.
4. Update the CLI hints. Covers AC-009.
5. Update `docs/architecture.md` and the platforms page. Point the browser harness at both Linux manifest directories.
