---
title: Local runtime
description: The macOS native-messaging runtime for response-body and request-body rules.
---

Response-body and request-body rules need a separately installed local runtime reached
through Chrome native messaging. The ordinary mock/body server (used for mocks) and the
runtime-owned request-body TLS proxy are separate processes.

## `rogatio runtime` lifecycle

- `rogatio runtime start` / `stop` / `status` control the running runtime process.
- `rogatio runtime install | status | trust | untrust | uninstall` manage the device-local
  native-messaging host registration and the device-local CA trust that request-body
  interception requires.

## Activation is capability-based

The runtime activates only where a trusted device-local CA can be provisioned and Chrome PAC
routing does not collide with an existing controlling proxy/PAC/extension/enterprise policy.
Where the required capabilities are absent, activation reports `unsupported`. macOS is the
reference supported platform; Linux and Windows may also activate when those capabilities
are present.

## Authority revalidation

The browser grant is **not** a security boundary. Every transformation request is
re-checked against the canonical `.rogatio.json`: the rule must exist, its URL regular
expression must match, the request and target origins must be within the rule's effective
origins, the method must match when specified, the resource type must be allowed, and the
initiator origin must be within granted scope. A denied request triggers no interception.

## Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging
envelope carries bounded metadata and transform instructions, never body bytes, credentials,
sensitive header values, or file contents. Observed bodies are never persisted, logged,
exported, or transferred through native messaging.
