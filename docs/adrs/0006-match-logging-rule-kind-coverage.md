# 0006. Match-logging rule-kind coverage

## Context

Chrome can authoritatively report DNR matches only. Matcher rules are never installed. Request-body and response-body rules run in the native runtime. Whether `onRuleMatchedDebug` fires for `modifyHeaders` is undocumented. Product asked to log request/response bodies; the DNR match event has none.

## Decision

Ship console logging for `redirect` and `query` only. Add `header` only after a real-Chromium probe shows the event fires for `modifyHeaders`. `matcher`, `request-body`, and `response-body` stay out of scope. A failed or inconclusive probe ships redirect/query and documents the negative result. Do not log from the native host to fill the gap. Do not add `webRequest` or debugger observation.

Intended header name/value from rule config appear on the line only after a header pass (they require a header index entry). Intended body replacement/rewrite is **not** logged: those kinds never produce this event. Logging when a body rule matches (payload + redact option) is **tracked in GitHub issue #163**.

Amended: product wanted bodies in the record. Coverage still excludes body kinds. Live bodies remain impossible on this event. No body-redact checkbox.

Amended (P6 probe, 2026-09-16): the real-Chromium probe passed — `onRuleMatchedDebug` fires for `modifyHeaders` — so shipped coverage is `redirect`, `query`, and `header`. Evidence: `test/browser/header-match-probe.spec.ts`.

## Consequences

- Docs must not promise header or body-rule console lines until the probe passes (headers) or the follow-up GitHub issue #163 ships (bodies).
- Unknown numeric ids (including header ids before a pass) stay silent.
