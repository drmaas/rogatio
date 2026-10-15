> Status: frozen 2026-10-14

# Arch and Chromium trust install

Audience: hybrid

Issue #354. `rogatio runtime install` on Arch with Chromium stopped before any write. The Linux adapter only probed `update-ca-certificates` and `~/.config/google-chrome/NativeMessagingHosts`.

## Acceptance checks

- AC-001. When `update-ca-certificates` is on PATH, install and remove stay on the Debian path. Remove still does not spawn.
- AC-002. When that tool is absent and `update-ca-trust` is on PATH, install writes `rogatio-ca.crt` with argv-only `sudo tee` into the anchors directory that tool reads, then runs argv-only `sudo update-ca-trust`. Arch uses `/etc/ca-certificates/trust-source/anchors`. Fedora and RHEL use `/etc/pki/ca-trust/source/anchors`. If both trees exist, or neither exists, detect reports `ca-store-unwritable`.
- AC-003. Remove deletes whichever of those anchor files is present and runs `update-ca-trust`. It does not choose the store from the current PATH alone.
- AC-004. `trust anchor --store` is not used.
- AC-005. Install writes `com.rogatio.runtime.json` for Google Chrome and Chromium when that browser's config directory can host it. A missing `NativeMessagingHosts` directory is created only when the parent config directory is writable. A missing parent is skipped. Any probe error other than `ENOENT` skips that browser.
- AC-006. Install records the directories it wrote. Later status, verify, and uninstall use that record. A browser config that appears later is not required until the next install.
- AC-007. If CA trust fails after the manifests are written, each manifest is restored to its previous bytes, or removed if it was new.
- AC-008. With more than one recorded manifest, verify requires every file to name this host and this host path. Origins must match across the files.
- AC-009. The CLI hint for `tooling-missing` names `update-ca-certificates` or `update-ca-trust`. The manifest hint names Google Chrome or Chromium.
- AC-010. Certificate bytes stay on stdin. No shell. Trust errors do not include certificate paths or tool output.

## Review corrections

- A failed store removal leaves `.rogatio-ca-store-pending` so the next uninstall still calls the remover after the local key is gone.
- When `native-messaging-dirs.json` is absent, status and verify require only host manifests that already exist.

## Out of scope

ChromeOS, Brave, Edge, and Flatpak config directories. `trust` without `update-ca-trust`. NSS `~/.pki/nssdb`. openSUSE `/etc/pki/trust/anchors`.
