# 0011. Stable unpacked extension ID, public key only

## Context

Unpacked Chrome extension IDs follow the load path unless `manifest.json` contains a public `key`. Rogatio release ZIPs are loaded unpacked, and the native-messaging host manifest pins `allowed_origins` to that ID. A new folder on upgrade changes the ID and Chrome refuses the host (`Access to the specified native messaging host is forbidden.`) until the user re-runs `rogatio runtime install --extension-id`.

Chrome hashes the public key, not a private key, to compute that ID. A CRX signature and a Chrome Web Store item ID need the matching private key. On first store upload the store assigns its own ID unless the ZIP contains that private key as `key.pem` (the manifest `key` field is omitted from that upload). Later updates keep the first-upload ID. Unpacked loads keep using the manifest `key`.

## Decision

Commit only the public key, in `packages/extension/public/manifest.json` `key`, as base64 SPKI. The release extension ID is the Chrome ID of that key (`dkngkciiiabbdjcopbipkpndfmpbmjom`). `rogatio runtime install` and `rogatio runtime verify` use it. `--extension-id` is only for development (a local unpacked build without the release key) and for forks. Release users never need it.

Do not commit a private key. Do not put a private key in GitHub Release ZIPs, docs, or logs.

The maintainer holds the matching private key outside the repository. It is used for CRX signing and for the first Chrome Web Store upload. Unpacked release builds use the public `key` only.

For the first Chrome Web Store upload only: omit `key` from the uploaded manifest and place the private key at the ZIP root as `key.pem`. Later store updates keep the ID from that first upload and must not include a new private key. The GitHub Release ZIP keeps `key` and must not contain `key.pem`.

`runtime verify` and the extension runtime card treat a host whose `allowed_origins` omit the connecting ID as a distinct failure and print the re-pin command. They do not treat it as a missing host.

## Consequences

- Release ZIPs loaded from different folders share one extension ID.
- `rogatio runtime install` and `rogatio runtime verify` work without `--extension-id` for those builds. Release users never pass that flag.
- A path-derived host manifest from an older install keeps failing closed until the user re-runs install. Verify and the runtime card name that mismatch.
- The maintainer can sign a CRX and perform the first Web Store upload because they hold the private key outside the repo. The repository itself cannot.
- Development builds that omit the release key, and forks that change or drop `key`, pass `--extension-id`.

## Alternatives rejected

- Shipping with no `key` until the maintainer generates one. That leaves the upgrade bug in place, and the unpacked ID does not need the private key.
- Committing the private key "so it is not lost". It would be lost in a worse way: anyone who can read the repo could sign as this extension.
- Using a Web Store ID as the source of truth. There is no store item. The store would also assign a different ID unless the private key is uploaded on first publish.
