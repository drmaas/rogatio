---
title: Local runtime
description: The consolidated native-messaging runtime for mock, response-body, and request-body rules.
---

Response-body, request-body, and mock rules all run through a single native-messaging host
process. There is no separate HTTP mock server: pairing, authorization, and mock delivery
all flow over the `v1` native-messaging envelope (spec REQ-001..REQ-005).

## `rogatio runtime` lifecycle

- The runtime (start/stop) is driven from the extension's **Start runtime** and
  **Stop runtime** controls. The CLI has no lifecycle subcommand; the host is
  launched by the browser via the native-messaging manifest once `install` has
  registered it.
- `rogatio runtime install | trust | untrust | uninstall` manage the device-local
  native-messaging host registration and the device-local CA trust that request-body
  interception requires.
- `rogatio runtime host <path>` launches the consolidated native-messaging host for a project
  on stdio. The browser extension connects to it for pairing, authorization, and mock delivery.

## Activation is unconditional for the host

The native host starts whenever launched; it does **not** require a device-local CA or PAC
routing capability (spec REQ-004). Only the device-local CA trust provisioning used by
request-body interception remains capability-gated at the OS level and reports `unsupported`
without error on incapable platforms. macOS is the reference platform for live request-body
interception; the native host itself runs everywhere the browser can start it.

## Authority revalidation

The browser grant is **not** a security boundary. Every transformation request is
re-checked against the canonical `.rogatio.json`: the rule must exist, its URL regular
expression must match, the request and target origins must be within the rule's effective
origins, the method must match when specified, the resource type must be allowed, and the
initiator origin must be within granted scope. A denied request triggers no interception.

## Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging envelope
carries bounded metadata and transform instructions, never request or response body bytes,
credentials, sensitive header values, or file contents — with one deliberate exception: mock
response bodies cross the envelope as base64 `mockBody` on the `mock.response` message only
(spec REQ-006). Observed live bodies are never persisted, logged, exported, or transferred
through native messaging.
