> Status: frozen 2026-09-25

# Research: body-rule-match-logging

Phase: research. Inputs: `docs/decisions/body-rule-match-logging/prd.md`. Claims verified in worktree source.

## Problem restatement

Shipped console match logging covers `redirect` / `query` / `header` only (`docs/architecture.md:91`). Body-rule URL matches produce no DevTools line. PRD wants one pipeline: `onRuleMatchedDebug` + session DNR markers, intended body action only (no live bytes, no native-host match events). Blocks #204.

## Codebase findings

### Request-body session DNR markers — docs only; not installed today

Architecture specifies one ephemeral session-bound DNR marker per request-body operation (URL matcher, method, `xmlhttprequest`, initiator host-domain; reserved header prefix; strip before upstream) (`docs/architecture.md:1005-1025`, `:1054-1056`). F17 spec same (`docs/specs/f17-request-body-rules.md:130`, `:649`, `:803-804`).

**Extension does not install them.** No `updateSessionRules` / `getSessionRules` anywhere under `packages/` (only a skipped live test expects `window.rogatio?.dnr?.sessionRules` — `test/browser/request-body-live.test.ts:15`, `:104-113`). `ChromeDeclarativeNetRequest` exposes only dynamic rules + `onRuleMatchedDebug` — no session-rule methods (`packages/extension/src/chrome.ts:58-67`). `createDnrInstaller.install` branches only `redirect` / `query` / `header` (`packages/extension/src/dnr.ts:335-388`); ADR 0009 says body kinds are never installed via DNR (`docs/adrs/0009-unified-dnr-reconciler-kind-scoped-bands.md:17`).

Runtime has `X-Rogatio-Dispatch-*` helpers (`createMarker` / `verifyMarker` / `stripReservedMarkers` in `packages/runtime/src/proxy.ts:7-94`) and related error codes (`packages/runtime/src/types.ts:220-224`). Nothing outside `proxy.ts` calls those helpers (`registerPendingAuthForRule` at `:212` uses `createMarker` but has no other callers); `packages/runtime/test/proxy.test.ts` is placeholder stubs. Markers are scaffolding, not a live install path.

**Relation to #170:** [#170](https://github.com/drmaas/rogatio/issues/170) (open) gates F23 PAC / `chrome.proxy` live body rewrite. Marker install is a separate missing piece (architecture + F17). Live rewrite (#170) and match-logging markers both needed for full body path; neither is “markers already ship.”

### Current matchLogging pipeline (header / redirect / query)

1. **Register** — `packages/extension/src/background.ts:244` → `registerMatchLogListener` (`match-listener.ts:104-119`). Absent `onRuleMatchedDebug` or `scripting.executeScript` → no-op.
2. **Event** — `handleRuleMatchedDebug` (`match-listener.ts:69-101`): read toggle → reject bad/`tabId === -1` → `lookupMatchIndexEntry(api, info.rule.ruleId)` → `formatMatchRecord` → ISOLATED `executeScript` inject (`injectMatchLogLine`). Fail-closed catch.
3. **Toggle** — `rogatio.matchLogging.enabled` (`match-logging-enabled.ts:3`); popup + management UI.
4. **Index** — `rogatio.matchLogging.index` (`match-index.ts:10`). Written wholesale on successful DNR install (`dnr.ts:209-238`, `:475-476`). Kinds limited to `"redirect" | "query" | "header"` (`match-index.ts:38`); `rawEntryFromOperation` returns `undefined` for other kinds (`match-index.ts:160-218`).
5. **Format** — live `method` / `type` / `url` + dim `ruleId` / `name` / `kind` / intended action / `initiator` (`match-format.ts:106-154`). Body sentinels ignored (`packages/extension/test/match-format.test.ts:469-478`).
6. **Prior probe** — `test/browser/header-match-probe.test.ts` (P6: `modifyHeaders` fires `onRuleMatchedDebug`; ADR 0006 amendment).

Architecture summary of the same path: `docs/architecture.md:91-93`.

### What indexing body markers would require

- Install session (or dynamic) DNR rules keyed to each body operation’s URL matcher so Chrome emits `onRuleMatchedDebug` with a numeric id. Plan must extend `chrome.ts` with session-rule APIs if markers stay session-bound.
- New Rogatio id band + reconciler ownership (today ADR 0009 forbids body DNR install — must amend).
- Extend `MatchIndexEntry.kind` + intent types; teach `rawEntryFromOperation` / `boundStoredKind` / sanitize + `formatIntendedAction` for `request-body` / `response-body` (mode + bounded rewrite summary from action shapes — `packages/schema/src/types.ts:83-119`; compiler ops `packages/compiler/src/types.ts:57-67`).
- Include those numeric ids in the wholesale index write (today only redirect/query/header tracked — `dnr.ts:219-227`).
- Wire marker lifecycle to native-session start/stop (architecture start installs markers atomically — `docs/architecture.md:1054-1056`); today `native-session.ts` is host messaging/policy only — no DNR marker install.

### Response-body session DNR signal

**None in code or architecture.** Architecture markers section is request-body only (`docs/architecture.md:1005-1025`). `projectMatchers` marks `response-body` `installable: true` but emits no `dnrRule` (`packages/extension/src/projection.ts:191-201`). No response-body marker header convention.

**Probe needed before R6 (and for request-body if using session rules):** mirror `header-match-probe.test.ts` — install a candidate session/dynamic rule with the body URL matcher; assert (1) `onRuleMatchedDebug` fires for that rule class, (2) marker headers do not reach upstream. Prefer same request-header marker pattern as architecture request-body over inventing a new mechanism (PRD / #163).

### Editor `redactSensitiveInLogs` exclusion for body cards

`isBodyRuleType` → `request-body` | `response-body` (`packages/editor/src/editor.ts:331-333`). Checkbox fieldset rendered only when `!isBodyRuleType(rule.type)` (`editor.ts:2612-2630`). Test locks hide: `packages/editor/test/redact-sensitive-in-logs.test.ts:150-157`. ADR 0007 recorded that exclusion (`docs/adrs/0007-per-rule-log-redaction-flags.md:9`); PRD Q3 decided body cards get the checkbox.

### #204 append seam

**Missing.** `handleRuleMatchedDebug` formats then injects only (`match-listener.ts:85-98`). No shared “record match” / history append hook. #204 expects one feed from this path ([#204](https://github.com/drmaas/rogatio/issues/204)). Implement should extract a post-lookup seam (entry + live fields → consumers: console inject + future history) without building history UI here.

### ADR 0001 / 0006 implications

| ADR | Current text | Must amend |
| --- | --- | --- |
| 0001 | Only `onRuleMatchedDebug`; do not log native-runtime body activity; “Body-kind rules stay silent… #163” (`docs/adrs/0001-dnr-on-rule-matched-debug.md:9-18`) | Keep single Chrome signal; drop “body silent”; record URL-match ⇒ attempt-to-rewrite via session markers; keep reject native-host match logging. |
| 0006 | Body kinds out of scope; “Intended body… never produce this event” (`docs/adrs/0006-match-logging-rule-kind-coverage.md:9-13`) | Extend coverage to body kinds once markers indexed; intended body action from index (not live bytes); cite probe evidence for response-body like P6 header. |
| Also | 0007 (no body checkbox); 0009 (body never DNR) | Align with PRD Q3 + marker install. |

Prior research assumed body kinds have no Chrome signal (`docs/research/console-match-logging.md:76`) — superseded by #163 / this PRD once markers exist.

## External findings

None beyond shipped Chrome APIs already used. Session-rule + response-body marker behavior is empirical (probe), same class as prior `modifyHeaders` probe.

## Constraints and invariants

- Single match source: `onRuleMatchedDebug` only (ADR 0001). No native-host “matched” events for logging/history (PRD R2 / #163 rejected alternatives).
- No live request/response body bytes in console or history (PRD non-goals; `match-format` already refuses body fields).
- Fail-closed: missing API, toggle off, unknown id, inject failure → silence (`match-listener.ts:99-101`, `docs/architecture.md:91`).
- Unpacked-only feedback permission (`docs/architecture.md:91`).
- No fake DNR for actionless `matcher` (`docs/architecture.md:89`).
- Package boundary: Chrome install/listener stay in `packages/extension`; runtime strips/validates markers only if that path is wired.
- Id-band / session vs dynamic: new body marker band must not wipe redirect/query/header bands (ADR 0009 discipline).
- Reuse `redactSensitiveInLogs` + ≤200 truncate (`docs/architecture.md:91`; ADR 0005/0007).

## Open questions

1. **Marker install ownership:** **Decided (research gate):** session-rules helper tied to native-session start/stop (matches architecture); keep redirect/query/header in dynamic installer; index write must still see marker ids.
2. **#170 vs this feature:** **Decided:** ship match-logging markers independently of #170 live rewrite. Lines mean attempt, not rewrite success.
3. **Probe:** **Deferred to plan** — first implement phase mirrors `header-match-probe`; prefer requestHeaders reserved marker + strip; try session rules first per architecture; fall back to dynamic only if session probe fails.
4. **Id band for session markers:** **Deferred to plan** — new body-marker band; do not wipe existing bands (ADR 0009).
5. **Intended-action summary bounds:** **Decided:** mode + bounded truncated rewrite text (≤200), same hard bound as other logged strings; never full live bodies.
