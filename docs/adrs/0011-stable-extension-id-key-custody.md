# 0011. Stable unpacked extension ID, public key only

## Context

Unpacked Chrome extension IDs follow the load path unless `manifest.json` contains a public `key`. Rogatio release ZIPs are loaded unpacked, and the native-messaging host manifest pins `allowed_origins` to that ID. A new folder on upgrade changes the ID and Chrome refuses the host (`Access to the specified native messaging host is forbidden.`) until the user re-runs `rogatio runtime install --extension-id`.

Chrome hashes the public key, not a private key, to compute that ID. A CRX signature and a Chrome Web Store item ID need the matching private key. On first store upload the store assigns its own ID unless the ZIP contains that private key as `key.pem` (the manifest `key` field is omitted from that upload). Later updates keep the first-upload ID. Unpacked loads keep using the manifest `key`.

## Decision

Commit only the public key, in `packages/extension/public/manifest.json` `key`, as base64 SPKI. The release extension ID is the Chrome ID of that key. `rogatio runtime install` defaults to it. `--extension-id` remains the override for a dev or forked build whose manifest does not carry this key.

Do not commit a private key. Do not put a private key in release ZIPs, docs, or logs.

The public key in this change was generated so unpacked builds can ship a stable ID. The matching private key was discarded in the same step and is not recoverable from the repository. Unpacked release builds do not need it. CRX packaging and a Web Store listing that must keep this ID do.

The maintainer generates and holds the signing key:

1. Generate a 2048-bit RSA key and store the private key outside the repository.
2. Replace `key` in `packages/extension/public/manifest.json` with the base64 SPKI public key (one line, no PEM armor).
3. Set `RELEASE_EXTENSION_ID` in `packages/runtime/src/extension-id.ts` and `packages/extension/src/extension-id.ts` to the Chrome ID of that public key. The manifest test fails if either constant drifts.
4. For the first Chrome Web Store upload only: omit `key` from the uploaded manifest and place the private key at the ZIP root as `key.pem`. Do not put `key.pem` in the GitHub Release ZIP. Later store updates must not include a new private key.

Replacing the public key changes the unpacked ID. Existing installs must run `rogatio runtime install` again. Do the replacement before users depend on the ID if a later store listing must match it.

`runtime verify` and the extension runtime card treat a host whose `allowed_origins` omit the connecting ID as a distinct failure and print the re-pin command. They do not treat it as a missing host.

## Consequences

- Release ZIPs loaded from different folders share one extension ID.
- `rogatio runtime install` works without `--extension-id` for those builds.
- A path-derived host manifest from an older install keeps failing closed until the user re-runs install. Verify and the runtime card name that mismatch.
- Nobody can sign a CRX or upload `key.pem` for the committed public key. Store parity requires the maintainer steps above.
- Forks that change or drop `key` pass `--extension-id`.

## Alternatives rejected

- Shipping with no `key` until the maintainer generates one. That leaves the upgrade bug in place, and the unpacked ID does not need the private key.
- Committing the private key "so it is not lost". It would be lost in a worse way: anyone who can read the repo could sign as this extension.
- Using a Web Store ID as the source of truth. There is no store item. The store would also assign a different ID unless the private key is uploaded on first publish.
