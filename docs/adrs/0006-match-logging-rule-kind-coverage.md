# 0006. Match-logging rule-kind coverage

## Context

Chrome can authoritatively report DNR matches only. Matcher rules are never installed. Request-body and response-body rules run in the native runtime. Whether `onRuleMatchedDebug` fires for `modifyHeaders` is undocumented. Product asked to log request/response bodies; the DNR match event has none.

## Decision

Ship console logging for `redirect` and `query` only. Add `header` only after a real-Chromium probe shows the event fires for `modifyHeaders`. `matcher`, `request-body`, and `response-body` stay out of scope. A failed or inconclusive probe ships redirect/query and documents the negative result. Do not log from the native host to fill the gap. Do not add `webRequest` or debugger observation.

Intended header name/value from rule config appear on the line only after a header pass (they require a header index entry). Intended body replacement/rewrite is **not** logged: those kinds never produce this event. Logging when a body rule matches (payload + redact option) is **tracked in GitHub issue #163**.

Amended: product wanted bodies in the record. Coverage still excludes body kinds. Live bodies remain impossible on this event. No body-redact checkbox.

Amended (P6 probe, 2026-09-16): the real-Chromium probe passed — `onRuleMatchedDebug` fires for `modifyHeaders` — so shipped coverage is `redirect`, `query`, and `header`. Evidence: `test/browser/header-match-probe.spec.ts`.

Amended (2026-09-20, #163 body-rule-match-logging): Extend coverage to `request-body` and `response-body` once session (or documented dynamic-fallback) URL-match markers are indexed. Log **intended** body action from the match index (mode + bounded rewrite summary), never live body bytes. Do not log from the native host. `matcher` stays out (no fake DNR). Response-body (and request-body marker class) ship only after a real-Chromium probe shows (1) `onRuleMatchedDebug` fires and (2) marker headers do not leak upstream.

Amended (Phase 1 probe, 2026-09-20): real-Chromium probe passed for both body shapes — session `modifyHeaders` remove-when-present on reserved request header; event fires; no upstream leak. Evidence: `test/browser/body-match-probe.test.ts`.

## Consequences

- Shipped coverage is `redirect` + `query` + `header`, plus `request-body` / `response-body` when session URL-match markers are indexed (Phase 1 probe green; product path is DNR set + runtime strip — never DNR set+DNR strip). Production `runtimeStripPathAvailable` stays fail-closed (`false`) until live traffic hits strip, so body kinds remain silent in the shipped wiring until that gate flips.
- Unknown numeric ids stay silent.
- Intended body text is config-derived and hard-bounded; live bodies remain impossible on this event.
- Native host remains never a match-logging source.
