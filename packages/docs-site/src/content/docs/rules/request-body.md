---
title: Request-body replacement
description: Replace or modify eligible POST/PUT/PATCH request bodies via the local runtime.
---

Request-body rules replace a complete body or apply bounded global ECMAScript regular
expression replacement to eligible POST, PUT, or PATCH XHR requests. Body rewrite applies
to cleartext HTTP absolute-form requests on port 80. HTTPS `CONNECT` is tunneled without
decryption, so those request bodies are not rewritten.

## Behavior

- **Full body replace**, or
- **Bounded global ECMAScript regex replace** on the body. Patterns compile in
  Unicode mode (`u`) and are bounded by the request-body pattern length, separate
  from the URL source pattern limit.

Replace-mode bodies may use `$1` through `$9` from the rule's **source** regex, and `$$`
for a literal dollar sign. Regex-mode replacements keep `$1` through `$9` for
captures from the body regex. The two capture namespaces are not mixed.

## Supported inputs

- Bounded UTF-8 **JSON**, **form-encoded**, or **textual** bodies.
- Unsupported framing, encoding, or signatures are **rejected**.

## Requirements and capabilities

- Requires the native-messaging host registered via
  `rogatio runtime install` and the runtime session started from the
  extension's **Start runtime** control. Release users never pass `--extension-id`.
  That flag is only for development (a local unpacked build without the release
  key) and for forks. Without a started session, enabled granted
  request-body rules report `needs runtime`.
- Request-body PAC routing is **capability-based**: it needs a trusted device-local CA
  and non-colliding Chrome proxy settings, excludes private browsing, and cannot compose
  with another controlling proxy, PAC, extension, or enterprise policy. The CA is a
  startup gate for that routing and is not used to decrypt TLS.
- Where those capabilities are absent, request-body activation reports `unsupported`;
  Linux and Windows may still verify, edit, import, export, and dry-run request-body rules.
  Response-body rules do not need the CA. The host can still start for them.
- CA trust is installed by the same `rogatio runtime install` command.
  Elevation: Linux (`sudo`), macOS (keychain authorization), Windows (Administrator). When
  elevation or any required capability is unavailable, that command is transactional and
  prints `trust unsupported: <reasons>` then exits `1` after rolling the manifest back —
  nothing is half-installed. Use `rogatio runtime verify` to check the manifest,
  `runtime-host` wrapper, allowed origins, and CA trust independently.
  See [Local runtime](/guides/runtime/).
- Observed bodies are processed in-process only and never persisted, logged, exported, or
  transferred through native messaging.
