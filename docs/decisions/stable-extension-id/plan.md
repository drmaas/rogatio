> Status: draft

# PLAN: stable-extension-id

Issue: [#263](https://github.com/drmaas/rogatio/issues/263). Research: `research.md`. Key-custody decision: `docs/adrs/0011-stable-extension-id-key-custody.md`.

## Outcome

Every build that contains the committed public `key` has one Chrome extension ID, independent of the unpacked folder. `rogatio runtime install` defaults to that ID. `--extension-id` still overrides it for a dev or forked build. `rogatio runtime verify` and the extension runtime card say when the connecting ID is not in `allowed_origins` and print the one command that fixes it. Install docs describe the upgrade from a path-derived ID.

## Behavior

1. Add the public SPKI (`key`) to `packages/extension/public/manifest.json`. The build already copies the manifest through, including unknown fields, and only rewrites `version`.
2. Derive the release ID with Chrome's algorithm (SHA-256 of the decoded key, first 16 bytes, nibble map `a`–`p`). Hold that ID in:
   - `packages/runtime/src/extension-id.ts` as `RELEASE_EXTENSION_ID` (CLI default; runtime does not import the extension).
   - `packages/extension/src/extension-id.ts` as the same constant (extension does not import the runtime).
3. `rogatio runtime install` with no `--extension-id` installs `chrome-extension://<release-id>/`. An explicit flag is validated exactly as today (32 characters `a`–`p`, exit 2 otherwise).
4. `rogatio runtime verify` reads `allowed_origins` from the host manifest. When the manifest is valid and its origins do not include the expected ID (release default, or `--extension-id` when passed), exit 1 and print the expected ID, the origins that are pinned, Chrome's refusal, and `rogatio runtime install` or `rogatio runtime install --extension-id <id>`.
5. When `connectNative` fails with Chrome's forbidden-host error, the extension diagnostic is `extension.native-host-origin-forbidden`. The runtime card and the guidance banner show the loaded ID and the same command. A missing host stays `extension.native-host-missing`.

## Tests

- Extension manifest test: the `key` derives to `RELEASE_EXTENSION_ID` (same bytes, same ID; the ID does not depend on a path).
- Runtime test: empty-input vector `odlameecjipmbmbejkplpemijjgpljce`, plus the manifest key matches `RELEASE_EXTENSION_ID`.
- Trust controller returns `allowedOrigins` from `verify`. The fixture host is `runtime-host.cmd` on Windows so `stat` reports the executable bit (extensionless names do not).
- CLI: `install` with no flag passes the release ID; an explicit ID still works; invalid IDs still exit 2; `verify` prints the mismatch command.
- Service worker: a forbidden-host send failure returns `extension.native-host-origin-forbidden` and the re-pin command.
- Browser journey: the runtime card and guidance show that command when the page is told the origin was rejected.
- `test/browser/extension-context.ts` derives the loaded ID from the manifest `key` when present, and still hashes the directory path when the key is absent. The harness previously always hashed the path, which no longer matches Chrome.

## Docs

Update the install/upgrade wording in `README.md`, `packages/cli/README.md`, `samples/basic/README.md`, `rogatio-overview.md`, `docs/architecture.md` (trust lifecycle, CLI runtime bullets), and the Starlight pages that tell users to pass `--extension-id` (installation, runtime guide, CLI reference, platforms, request-body, response-body, docs index).

## Out of scope

- A Chrome Web Store upload pipeline, CRX packaging, or stripping `key` for a store ZIP.
- Retaining or distributing the private key.
- Changing native-messaging manifest shape, CA trust, or DNR behavior.

## Maintainer follow-up

Recorded in ADR 0011. The private key for this public key was not retained. Before a CRX or a Web Store listing that must keep this ID, generate a key pair, hold the private key outside the repo, replace the manifest `key`, and update both ID constants. Do that before the first release users depend on if the store ID must match the unpacked ID.
