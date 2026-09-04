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

- Activation is **capability-based** and cannot compose with another controlling proxy,
  PAC, extension, or enterprise policy.
- Where the required capabilities are absent, activation reports `unsupported`; Linux and
  Windows may still verify, edit, import, export, and dry-run request-body rules.
- Requires the device-local CA trust installed via `rogatio runtime install`
  (the same `install` command provisions the CA on capable platforms; on
  incapable platforms the install completes without CA trust). See
  [Local runtime](/guides/runtime/).
- Observed bodies are processed in-process only and never persisted, logged, exported, or
  transferred through native messaging.
