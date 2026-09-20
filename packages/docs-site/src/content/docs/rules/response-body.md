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
- Replace-mode bodies may use `$1` through `$9` from the rule's `urlRegex`, and `$$`
  for a literal dollar sign.
- Regex-mode replacements keep `$1` through `$9` for captures from the body regex.
  The two capture namespaces are not mixed.
- Routed through native messaging to the explicitly started local runtime.

## Requirements

- Requires the native-messaging host to be registered (`rogatio runtime install --extension-id <id>`)
  and the runtime session to be started from the extension's **Start runtime** control
  (see [Local runtime](/guides/runtime/)).
- Enabled, granted response-body rules report `needs runtime` until the host session is
  started. They report `unsupported` only when the platform/native adapter reports that
  phase (not merely because the session is stopped).
- Response-body rules do **not** require device-local CA trust. CA trust is for
  request-body interception only.
- Observed bodies are never persisted, logged, exported, or transferred through native
  messaging.
