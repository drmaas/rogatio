# 0003. Durable DNR match index

## Context

`onRuleMatchedDebug` reports a numeric DNR id. `createDnrInstaller`'s in-memory `tracked` map is redirect/query only and is lost when the MV3 worker restarts. `ruleIdHash` is not injective after collision probing, so the id cannot be recomputed. The console line needs intended redirect / query / header fields, which the Chrome event does not include.

## Decision

Persist `chrome.storage.local` key `rogatio.matchLogging.index` as `numericId → { ruleId, name, kind, redactSensitiveInLogs, intent }`. `intent` is a kind-discriminated **log subset** of the compiled action: redirect `{ destination }`, query `{ params }`, header `{ direction, operation, name, value? }` (header only after the coverage probe). Do not persist matcher regex, origins, resourceTypes, groupId, event URLs, body payloads, or `redactBodiesInLogs`. Do not persist a full `RogatioOperation`. Resolve `redactSensitiveInLogs` at write: absent → `false`. Missing or non-string stored `name` is accepted as `""` at read for older indexes.

The service worker is the sole writer. Rewrite the key wholesale after a successful redirect/query `updateDynamicRules` (including an empty set). On install failure, leave the previous index. At write, truncate every string to ≤200 with trailing `...`; if `redactSensitiveInLogs` is true, apply the formatter deny-list before store. Treat stored values as untrusted: malformed entries are ignored. Unknown ids are a no-op, never a hash guess.

Header ids are not written until a probe confirms `modifyHeaders` reporting. That path must extend this same snapshot in one write, not a second wholesale writer in `installHeaderRules`.

Amended: earlier decision stored only `{ ruleId, kind }` and forbade destinations/query/headers. Product now requires those intended fields on the line, so the index holds a bounded log-intent subset.

## Consequences

- Lookup survives worker restart without putting data in the `rogatio` envelope.
- `projectId` is not stored; the console line does not need it.
- A stale index after a crash between DNR update and storage write yields unknown-id no-ops, not guessed names.
- Extension pages that read `chrome.storage.local` can see intended action strings in this key as well as in the envelope. Residual accepted; subset + write-time bound keep it from being unbounded.
- No `redactBodiesInLogs`. Extra body fields on a stored entry are ignored at format time.
