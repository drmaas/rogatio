---
title: Local runtime
description: The consolidated native-messaging runtime for response-body and request-body rules.
---

Response-body and request-body rules run through a single native-messaging host
process. Pairing, authorization, and body transforms flow over the `v1`
native-messaging envelope (spec REQ-001..REQ-005).

## `rogatio runtime` lifecycle

- The runtime session (start/stop) is driven from the extension's **Start runtime** and
  **Stop runtime** controls. The CLI has no session lifecycle subcommand; the host is
  launched by the browser via the native-messaging manifest once `install` has
  registered it.
- `rogatio runtime install` registers the device-local native-messaging host
  for the pinned release extension ID. Pass `--extension-id <id>` for a dev or
  forked build whose ID is different. The same invocation also
  provisions and trusts the device-local CA (required for request-body interception).
  The call is **transactional**: CA trust requires elevated privileges — Linux
  (`sudo`), macOS (keychain authorization), Windows (Administrator) — and when elevation
  or any required capability is unavailable the command prints
  `trust unsupported: <reasons>` with a remediation hint and exits `1` after rolling the
  manifest back. Nothing is half-installed; re-run it with elevated privileges.
  `rogatio runtime uninstall` removes the host manifest, the device-local CA files, and
  the trust installation (idempotent).
- `rogatio runtime verify` reports whether the manifest, the `runtime-host` wrapper, the
  allowed origins, and the device-local CA trust are all present and valid. It exits `0`
  only when every check passes, and prints a remediation hint per failed check. When
  `allowed_origins` does not include the release ID (or `--extension-id`), it names that
  mismatch and prints the re-pin command.
- If the host manifest is missing, or Chrome refuses the connection because the loaded
  ID is not in `allowed_origins`, the extension's runtime card shows the ready-to-run
  install command with a copy affordance (`rogatio runtime install` for a release
  build, `rogatio runtime install --extension-id <id>` otherwise). The loaded extension
  ID is shown in the UI.
- Upgrading from a path-derived ID: load the new release ZIP (any folder), then run
  `rogatio runtime install` again so the host manifest matches the pinned ID.
- `rogatio runtime host <path>` launches the consolidated native-messaging host for a
  project on stdio. The browser extension connects to it for pairing, authorization, and
  body transforms. `--root <dir>` overrides the confined file root; `--mock-port <n>`
  binds the loopback mock-response faucet.

## Activation is unconditional for the host

The native host starts whenever launched; it does **not** require a device-local CA or PAC
routing capability (spec REQ-004). Only the device-local CA trust provisioning used by
request-body interception remains capability-gated at the OS level and reports `unsupported`
without error on incapable platforms. macOS is the reference platform for live request-body
interception; the native host itself runs everywhere the browser can start it.

## Authority revalidation

Install-time host access is **not** a security boundary. Every transformation request is
re-checked against the canonical `.rogatio.json`: the rule must exist, its source
condition must match, the method must match when specified, the resource type must be
allowed, and initiator/target same-origin policy must hold. A denied request triggers no
interception.

## Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging envelope
carries bounded metadata and transform instructions, never request or response body bytes,
credentials, sensitive header values, or file contents. Observed live bodies are never
persisted, logged, exported, or transferred through native messaging.
