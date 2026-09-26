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
- `rogatio runtime install --extension-id <id>` registers the device-local
  native-messaging host for your loaded extension ID. The same invocation also
  provisions and trusts the device-local CA on capable platforms (required for
  request-body interception). When elevation is unavailable the command prints
  `trust unsupported: <reasons>` and exits `0` — the host manifest is still installed;
  only the CA trust step is skipped. CA trust requires elevated privileges: Linux
  (`sudo`), macOS (keychain authorization), Windows (Administrator).
  `rogatio runtime uninstall` removes the host manifest, the device-local CA files, and
  the trust installation (idempotent).
- If the host manifest is missing, the extension's Start control shows the ready-to-run
  `rogatio runtime install --extension-id <your extension ID>` command with a copy
  affordance (the browser-assigned extension ID is shown in the UI).
- `rogatio runtime host <path>` launches the consolidated native-messaging host for a
  project on stdio. The browser extension connects to it for pairing, authorization, and
  body transforms.

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
