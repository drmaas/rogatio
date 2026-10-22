---
title: Response body
description: Full replace or bounded regex rewrite on authorized public GETs through the local runtime.
---

Response-body rules fetch an authorized public GET without browser credentials
and either replace the entire response body or perform bounded textual regex
rewriting via native messaging to the explicitly started local runtime.

## Behavior

- Authorized **public GET** only, without browser credentials.
- **Replace mode** substitutes the entire fetched response body with the configured UTF-8 text. Upstream status is kept.
- The listener drops `Cookie`, `Authorization`, and `Set-Cookie`. It also drops any upstream `Content-Security-Policy` (including a report-only policy) and sets `Content-Security-Policy: sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'` and `X-Content-Type-Options: nosniff`. Style and image loads stay blocked by `default-src 'none'`, because allowing them would let the document request more URLs on the listener origin. The redirect path includes an unguessable per-runtime token; a request without that token, or with a different token, is rejected. The same content policy is set on HTML mocks served from this listener.
- **Regex rewrite mode** applies one or more bounded pattern/replacement pairs to the fetched body. Patterns compile in Unicode mode (`u`) and are bounded by the response-body pattern length, separate from the URL source pattern limit.
- Replace-mode bodies may use `$1` through `$9` from the rule's **source** regex, and `$$`
  for a literal dollar sign.
- Regex-mode replacements keep `$1` through `$9` for captures from the body regex.
  The two capture namespaces are not mixed.
- Routed through native messaging to the explicitly started local runtime.

## Requirements

- Requires the native-messaging host to be registered (`rogatio runtime install`; release users never pass `--extension-id`, which is only for development — a local unpacked build without the release key — and for forks)
  and the runtime session to be started from the extension's **Start runtime** control
  (see [Local runtime](/guides/runtime/)).
- Enabled, granted response-body rules report `needs runtime` until the host session is
  started. They report `unsupported` only when the platform/native adapter reports that
  phase (not merely because the session is stopped).
- Response-body rules do **not** require device-local CA trust. CA trust is for
  request-body interception only.
- Observed bodies are never persisted, logged, exported, or transferred through native
  messaging.
