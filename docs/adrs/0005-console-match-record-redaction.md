# 0005. Console match record and redaction

## Context

The page console is visible and live. Match records must be filterable, theme-readable, and must not dump unbounded secrets. `%c` colors are fixed hex and do not follow the DevTools theme. Collapsed groups add UI the PRD did not ask for. `onRuleMatchedDebug` supplies URL, initiator, method, type, and tabId — not live bodies and not wire-applied header values.

## Decision

One flat `console.log` line per reported match. Prefix lowercase `[rogatio]` with ANSI SGR `\x1B[1;34m`, reset `\x1B[m`. Message unstyled. Detail `\x1B[2m`. No `%c`, no `groupCollapsed`.

Field order: prefix; `matched` + live method + live resource type + live request URL; dim `ruleId` and kind; dim intended action from the index (redirect destination, query param ops, header op after probe); dim initiator when the event supplied one. Omit absent segments. Wording is "matched / intended action", never success.

**Live (Chrome event):** URL, method, initiator, resource type (`request.type`).
**Intended (rule config via index):** redirect destination, query transform, header name/value/direction/operation.
**Not logged:** live request/response bodies; intended body rewrite; wire-applied headers. Body-rule matches are out of this feature (**tracked in GitHub issue #163**).

Per logged string: drop URL userinfo and fragment; truncate so the result is ≤200 characters with trailing ASCII `...` when cut. Bound is per string, not the whole line. If a destination or initiator is not a parseable URL (including redirect `\\1` backrefs), treat it as an opaque string: truncate only, do not throw.

When `redactSensitiveInLogs` is true: case-insensitive substring deny-list on query keys (`token`, `access_token`, `id_token`, `refresh_token`, `code`, `api_key`, `apikey`, `key`, `secret`, `client_secret`, `password`, `passwd`, `pwd`, `auth`, `session`, `sid`, `sig`, `signature`, `jwt`, `assertion`, `otp`, `state`, `nonce`, `email`); header values whose names match the forbidden-header seed plus `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token` become `[redacted]`. When that flag is absent or false: still drop userinfo/fragment and truncate; do not apply the deny-list.

No `redactBodiesInLogs`. Re-apply truncate and (when flagged) deny-list at format time; treat index values as untrusted.

Implement as pure functions in `packages/extension`. Do not import Node `schema` / Ajv.

Amended: earlier decision forbade destinations, query transforms, header names/values, initiator, method, and resource type. Product now requires those, as intended-from-config plus live method/initiator/type. Body-redact flag removed; sensitive-flag default is off (absent → false).

## Consequences

- Path segments and unlisted query keys can still carry secrets. Flag-off truncated secrets appear in the console. Accepted residual.
- Formatter is pure and unit-testable with no Chrome APIs.
- Users can mistake intended header/body config for wire reality. Docs must say "intended".
