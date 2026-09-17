---
title: Response body
description: Full replace or bounded regex rewrite on authorized public GETs through the local runtime.
---

Response-body rules fetch an authorized public GET without browser credentials
and either replace the entire response body or perform bounded textual regex
rewriting via native messaging to the explicitly started local runtime.

## Behavior

- Authorized **public GET** only, without browser credentials.
- **Replace mode** substitutes the entire fetched response body with the configured UTF-8 text while preserving upstream status and headers.
- **Regex rewrite mode** applies one or more bounded pattern/replacement pairs to the fetched body.
- Routed through native messaging to the explicitly started local runtime.

## Requirements

- Requires the native runtime to be started (see [Local runtime](/guides/runtime/)).
  Without the runtime, response-body rules report `unsupported`.
- Requires the device-local CA trust installed via `rogatio runtime install`. CA trust
  installation requires elevated privileges: Linux (`sudo`), macOS (keychain password),
  Windows (Administrator).
- Activation is capability-based; where required capabilities are absent, activation reports
  `unsupported`.
- Observed bodies are never persisted, logged, exported, or transferred through native
  messaging.
