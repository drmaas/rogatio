> Status: draft

# RESEARCH: stable-extension-id

Issue: [#263](https://github.com/drmaas/rogatio/issues/263).

## Problem restatement

Release ZIPs are loaded unpacked. `packages/extension/public/manifest.json` has no `key`, so Chrome derives the extension ID from the absolute path of the unpacked folder. `rogatio runtime install --extension-id <id>` writes that ID into the native-messaging host manifest as `allowed_origins`. Moving or replacing the folder (the normal upgrade, because there is no store auto-update) changes the ID. Chrome then refuses `connectNative` and body rules stop until the user copies the new ID and re-runs an elevated install.

## What the code does today

### Extension ID is path-derived

`packages/extension/public/manifest.json` is an MV3 manifest with no `key`. `scripts/build.ts` copies that file to `packages/extension/dist/manifest.json` and only overwrites `version`. The built ZIP therefore has no stable ID.

The management page reads `chrome.runtime.id` and shows it as `Extension ID:` (`packages/extension/src/extension-page-entry.ts`). The install command it offers is always `rogatio runtime install --extension-id ${id}`.

### Install pins one origin

`packages/cli/src/commands/runtime.ts` rejects `install` when `--extension-id` is missing or is not 32 characters from `a` through `p` (exit 2). `packages/runtime/src/trust.ts` `install(extensionId)` writes `allowed_origins: ["chrome-extension://<id>/"]` via `generateNativeMessagingManifest`. The origin regex is `^chrome-extension://[a-p]{32}/?$`.

`packages/cli/src/help.ts` documents the flag as required.

### Verify does not compare IDs

`createRequestBodyTrustController().verify()` reports manifest presence, wrapper existence and the execute bit, `allowedOriginsCount`, and CA files. It succeeds when `allowedOriginsCount > 0`. It does not know which extension is connecting, so a host still pinned to a previous path-derived ID verifies as healthy.

### The extension collapses an origin rejection into a generic failure

Chrome does not start the host when the caller is absent from `allowed_origins`. The port disconnects with `Access to the specified native messaging host is forbidden.` The host process never sees the connection, so it cannot explain the mismatch.

`packages/extension/src/background.ts` `ensurePort` turns every synchronous `connectNative` exception into `extension.native-host-missing`. A disconnect stores `chrome.runtime.lastError` and rejects the pending send with that text. `stableStartFailureReason` in `packages/extension/src/native-session.ts` maps only `extension.native-host-missing` and `extension.request-body-needs-trust`; every other message, including the forbidden-host string, becomes `extension.native-runtime-transition`. The runtime card then shows a generic failure, not the one command that re-pins `allowed_origins`.

## How Chrome assigns an unpacked ID

For an unpacked extension, the ID is the first 16 bytes of SHA-256 over the manifest `key` (base64-decoded SPKI DER), with each hex nibble mapped onto `a`–`p` (`0` → `a`, …, `f` → `p`). The same public key yields the same ID in every folder. Without `key`, Chrome hashes the load path instead.

The manifest field is the **public** key only. Chrome does not need the private key to load an unpacked extension or to compute the ID.

SHA-256 of the empty input is a fixed vector for the mapping. Its first 32 hex characters `e3b0c44298fc1c149afbf4c8996fb924` become `odlameecjipmbmbejkplpemijjgpljce`.

## Chrome Web Store

Current distribution is a GitHub Release ZIP loaded unpacked (`packages/docs-site` installation guide, `rogatio-overview.md`). There is no store listing.

If a listing is added later:

- The store ignores the manifest `key` when assigning an ID. On first upload it generates a key unless the ZIP contains the matching private key at the root as `key.pem` (and the manifest `key` field is omitted from that upload; the store rejects a first upload that contains `key`).
- Later store updates keep the ID from the first upload. The manifest `key` does not change it.
- Unpacked release ZIPs must keep the public `key` and must not contain `key.pem`.
- The unpacked ID matches the store ID only when both were produced from the same key pair.

## Key custody

Only the public key belongs in git. The maintainer holds the matching private key outside the repository. It is used for CRX signing and for the first Chrome Web Store upload (`key.pem` at the ZIP root, with the manifest `key` omitted from that upload). It is not required for unpacked ID stability, and it is not in the repository.

The committed public key is the maintainer's. The release ID derived from it is `dkngkciiiabbdjcopbipkpndfmpbmjom`.

## Dev and forked builds

A build that ships this public `key` has the release ID whether it is loaded from `packages/extension/dist` or from a release ZIP. `--extension-id` is only for development (a local unpacked build without the release key) and for forks. Release users never need it. The release default must not prevent an explicit ID on those builds.

## Migration

Existing host manifests pin a path-derived ID. After this ships, loading the release build changes the connecting ID to the pinned one, and Chrome forbids the connection until `rogatio runtime install` rewrites `allowed_origins`. `runtime verify` and the runtime card are the places that can say so with the exact command.

## Rejected alternatives

- Leaving the ID path-derived and documenting "always unpack into the same folder". Users already lose pairing on ordinary upgrades. A folder convention does not survive a second directory.
- Committing the private key, or printing it in the PR, so the maintainer can sign later. The private key must stay out of the repo and the logs.
- Blocking the unpacked ID on a key the maintainer has not generated yet. Unpacked stability needs only the public key. The maintainer now holds the private key outside the repo and the committed `key` is that pair's public half.
- Putting the release ID in `@rogatio/schema`. Schema does not own browser identity. The runtime package already writes `allowed_origins`, and the CLI already depends on it. The extension cannot import the runtime (dependency direction). The manifest `key` is the source of truth; each package holds the derived ID and tests lock both to that key.
- Teaching the native host to report the mismatch. Chrome never launches the host when the origin is rejected.
