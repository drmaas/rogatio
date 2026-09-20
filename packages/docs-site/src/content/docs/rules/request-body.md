---
title: Request-body replacement
description: Replace or modify eligible POST/PUT/PATCH request bodies via the local runtime.
---

Request-body rules replace a complete body or apply bounded global ECMAScript regular
expression replacement to eligible POST, PUT, or PATCH XHR requests. They use the
runtime-owned TLS proxy.

## Behavior

- **Full body replace**, or
- **Bounded global ECMAScript regex replace** on the body.

## Supported inputs

- Bounded UTF-8 **JSON**, **form-encoded**, or **textual** bodies.
- Unsupported framing, encoding, or signatures are **rejected**.

## Requirements and capabilities

- Requires the native-messaging host registered via
  `rogatio runtime install --extension-id <id>` and the runtime session started from the
  extension's **Start runtime** control. Without a started session, enabled granted
  request-body rules report `needs runtime`.
- Request-body interception is **capability-based**: it needs a trusted device-local CA
  and non-colliding Chrome PAC routing, excludes private browsing, and cannot compose with
  another controlling proxy, PAC, extension, or enterprise policy.
- Where those capabilities are absent, request-body activation reports `unsupported`;
  Linux and Windows may still verify, edit, import, export, and dry-run request-body rules.
  The host can still start for response-body rules.
- CA trust is installed by the same `rogatio runtime install --extension-id <id>` command
  on capable platforms. Elevation: Linux (`sudo`), macOS (keychain authorization), Windows
  (Administrator). When elevation is unavailable the command prints
  `trust unsupported: <reasons>` and exits `0` (manifest installed; CA skipped).
  See [Local runtime](/guides/runtime/).
- Observed bodies are processed in-process only and never persisted, logged, exported, or
  transferred through native messaging.
