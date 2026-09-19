# 0008. Reuse match-logging index for DNR install identity

## Context

After an MV3 service-worker restart, in-memory `tracked` is empty. `current()` then reports nothing even when Chrome still holds dynamic rules. A second durable map would be a third source of truth next to Chrome and `rogatio.matchLogging.index`. ADR 0003 already persists `numericId → { ruleId, kind, … }` for logging and forbids a full `RogatioOperation` in that key. `RuleInstallerAdapter.current()` still returns operations, not ids.

## Decision

Reuse `rogatio.matchLogging.index` as the only durable `numericId → compiler ruleId` map. No sibling key. No new install-only fields. Do not persist a full operation.

Resolve installed identity as: Chrome live dynamic ids ∩ index `ruleId` ∩ compiled project operations already in `projectState`. Treat the stored index as untrusted (ADR 0003). Write identity for every successfully installed DNR kind (redirect, query, header) in the existing sole wholesale writer. Header identity is written on successful install; the 0006 probe was logging coverage, not install write-gating.

Do not change `current()`’s signature. If memory is cold, the extension hydrates from that join this turn. It must not rebuild operations from the index alone.

## Consequences

- One map survives restart. Logging and install identity cannot drift across keys.
- `current()` / `installedRuleIds` stay correct without a third store.
- Stale index after a crash still cannot invent ids (0003). P1 live-set remove covers duplicate-id recovery.
- ADR 0003 log-intent shape and bounds stay in force.
