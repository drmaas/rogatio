# Plan: body-rule-match-logging

## Goal

When a `request-body` or `response-body` rule’s URL matcher hits a live request, emit one `[rogatio]` DevTools console line through the existing `onRuleMatchedDebug` pipeline. Line carries live match fields plus intended body action (mode + ≤200 rewrite text). No live body bytes. Leave a post-lookup append seam for #204. Ship markers independent of #170.

## Non-goals

- Live body bytes in console or history
- Native-host match events for logging/history
- #204 history UI or persistence
- Fake DNR for actionless `matcher` rules
- #170 PAC / live body rewrite
- F17 capability-token minting / pending-auth map for logging-only markers
- Changing redirect/query/header match-logging behavior beyond shared index/seam needs
- Firefox

## Architecture

**Parties:** Extension SW (listener, index, session-rules helper) → Chrome DNR (`onRuleMatchedDebug` + session `modifyHeaders`) → page ISOLATED inject. Native host is **not** a match source. Upstream origin must never see marker headers.

**Signal:** Session DNR URL-match markers — `modifyHeaders` **set** reserved request header with **inert** value so `onRuleMatchedDebug` fires. Same Chrome event as redirect/query/header. Native-host match logging rejected.

**No-leak (amended after §1 probe, 2026-09-20):** Do **not** ship DNR set + DNR strip of the same header (probe: same-rule set+remove leaks; set + higher-priority DNR remove silences the event). Strip reserved `X-Rogatio-Dispatch-*` markers via **non-DNR** runtime/proxy before upstream (reuse `stripReservedMarkers` / session proxy path). Match signal = DNR set; no-leak = runtime strip. Install markers only when that strip path is active for the session (fail-closed: no strip path → no marker install → silence), so logging stays independent of full #170 PAC rewrite but does not leak.

**Probe lock (§1):** Session store won. Empirical `remove-when-present` (client-sent header + DNR remove) proved event+no-leak; product path uses DNR set + runtime strip instead of client-sent headers. Evidence: `test/browser/body-match-probe.test.ts`.

**Trust edges (logging-only):**
- Markers exist to fire the event; runtime strips them before upstream. They are **not** rewrite capability tokens and must not mint pending-auth / F17 validate-and-rewrite gates (#170 owns that).
- Prefer reserved header **name** pattern from architecture; marker **values** for this feature stay inert (opaque match-log ids or non-auth sentinels). Do not put session capability, preset digest, or rewrite auth material in logging markers.
- Install only while native session is active **and** runtime strip is available; remove on stop / start-failure. No orphan session rules after stop.
- Fail-closed: toggle off, missing API, unknown id, inject failure, no active session markers, or no strip path → silence. Console line means URL match ⇒ will attempt rewrite when body path is live — not proof rewrite ran.
- Console inject may show intended rewrite summary from **rule config** (bounded + `redactSensitiveInLogs`); never live body bytes, never marker header values.
- Session-rule ids and dynamic-rule ids are separate Chrome stores. Body band is Rogatio ownership **inside the session store**; session helper must not `updateDynamicRules`; dynamic reconciler must not clear session body markers.

**Install ownership:** New session-rules helper; lifecycle tied to native-session start/stop. Redirect/query/header stay in dynamic `createDnrInstaller`. Match-index write must include body marker ids (merge after marker install).

**Id band:** New body-marker band (propose `3_000_001+` within session rules); never wipe dynamic redirect/query (`1–1_000_000`) or header (`2_000_001+`) bands.

**Probe-first:** Phase 1 done — session preferred; both body shapes gated green under locked probe mode. Product mechanism amended at §1 review gate (DNR set + runtime strip).

**Index/format:** Extend `MatchIndexEntry.kind` + body intent; `formatIntendedAction` = mode + truncated rewrite summary; reuse `redactSensitiveInLogs` + existing hard bounds.

**Seam:** Extract post-lookup append from `handleRuleMatchedDebug` (entry + live fields → console inject now; history later). Seam stays in-process; no new network or native match feed.

**Editor:** Show `redactSensitiveInLogs` on body cards. Schema already allows the boolean on all rule types — UI gate only.

**Public / wire changes:**

| Surface | Change | Risk |
| --- | --- | --- |
| Project schema / `.rogatio.json` | None for redact flag (already optional boolean on rules) | Low — no project wire bump |
| Match-index storage (`rogatio.matchLogging.index`) | New kinds + body intent shape (local Chrome storage only) | Sanitize unknown kinds fail-closed; not a project file |
| `ChromeApi` | Session-rule methods (`updateSessionRules` / `getSessionRules`) | Internal adapter; harness-injectable |
| Runtime proxy markers | Reuse reserved **name** prefix; logging values inert (no rewrite auth) | Must not collide with future #170 capability markers without an explicit join |
| Editor | Body cards gain checkbox (draft/save already round-trip schema field) | UI only |
| Native messaging / history | None | — |

### ADR candidates

| Candidate | Choice | Status |
| --- | --- | --- |
| Amend ADR 0001 (DNR match signal) | Keep `onRuleMatchedDebug` only; drop “body silent”; URL-match ⇒ attempt-to-rewrite via markers; keep reject native-host match logging | Amended at plan review |
| Amend ADR 0006 (kind coverage) | Extend coverage to body kinds once markers indexed; probe-gated (cite evidence when Phase 1 lands) | Amended at plan review |
| Amend ADR 0007 (per-rule redaction) | Body cards get `redactSensitiveInLogs` checkbox (PRD Q3) | Amended at plan review |
| Amend ADR 0009 (id bands) | Body markers get session band; session DNR for match logging; no cross-store wipe | Amended at plan review |

## Phases

### Phase 1 — Probe (checklist §1) — AC4 — **done**

Empirical probe landed. Session won. Locked probe evidence + mechanism amendment recorded above. Do not re-open DNR set+DNR strip.

### Phase 2 — Session API + marker helper + id band (checklist §2) — AC8, AC10

Extend `chrome.ts` with session-rule ports. Add body-marker id band helper and session-rules install/remove module (pure of native messaging). Helper builds **DNR set-only** inert marker rules (reserved name + opaque id value) — **not** DNR remove of the same header. Unit-test band math, session-store-only remove (`getSessionRules ∩` body band), and no `updateDynamicRules` from this helper.

**Acceptance:** Session APIs injectable in harness; helper installs/removes only body-band session ids; dynamic bands untouched; built rules are set-only with inert values (no capability/digest/auth; no paired DNR strip).

**Tests prove (TDD):** Failing harness tests first — band ownership; remove ∩ body band only; never calls `updateDynamicRules`; installed action is set-only inert sentinel.

### Phase 3 — Lifecycle + index merge (checklist §3) — AC4, AC8, AC9, AC10

On native-session start: if runtime strip path is available, install set-only markers for body ops that passed probe gates; merge marker ids into match-index write. Wire/confirm reserved-marker strip on the session proxy path (reuse scaffolding; no F17 capability mint). On stop/failure: remove owned session markers; drop those index entries. Do not put body markers in dynamic `createDnrInstaller`. If response-body probe failed, install request-body only. No PAC / pending-auth / capability mint (AC9).

**Acceptance:** Start → markers present + index lookupable + strip path active; stop → markers gone + index ids dropped; start-failure → orphan cleanup; no strip path → no install; dynamic non-body install unchanged.

**Tests prove (TDD):** Start → session body-band + index hit; stop/start-failure → clean; no-strip → no install; response-body skipped when gate false; `createDnrInstaller` never emits body rules; strip unit/integration covers reserved header absence on outbound when strip path invoked.

### Phase 4 — Index + format body kinds (checklist §4) — AC1, AC3, AC2 (redact)

Extend `match-index` kinds/intents/`rawEntryFromOperation`/`sanitize`. `formatIntendedAction` for body: mode + ≤200 rewrite text; never body bytes from the live request. Redaction path unchanged. Unknown/malformed body kinds fail-closed via sanitize.

**Acceptance:** Indexed body entry formats one `[rogatio]` line with live URL/method/initiator/type + intended action; redact flag honored; no live body bytes; sanitize drops unknown kinds.

**Tests prove (TDD):** `match-index.test.ts` — body kinds round-trip; unknown kind sanitized away. `match-format.test.ts` — replace “body sentinels ignored” with body-kind line; assert mode + ≤200 rewrite; assert live `body` / marker header values absent from output; `redactSensitiveInLogs` applied to intended rewrite text.

### Phase 5 — Append seam (checklist §5) — AC2, AC6

Extract post-lookup seam from `handleRuleMatchedDebug`: after successful index lookup, notify seam then console-inject. No history store/UI.

**Acceptance:** Listener still fail-closed; seam invoked with entry + live fields; console path sole consumer; body-kind index hits reach seam + inject like other kinds.

**Tests prove (TDD):** `match-listener.test.ts` — seam called with entry + live fields; inject still works for body kind; fail-closed matrix stays silent: toggle off, unknown id, `tabId === -1`, missing API, inject throw; no history store write.

### Phase 6 — Editor checkbox (checklist §6) — AC7

Remove `isBodyRuleType` hide of `redactSensitiveInLogs`. Flip editor test that locked hide.

**Acceptance:** Body rule cards show checkbox; toggle persists in draft/save.

**Tests prove (TDD):** Flip `redact-sensitive-in-logs.test.ts` to expect visible + toggle round-trip on body cards (red first).

### Phase 7 — Architecture docs (checklist §7) — AC5

ADRs 0001 / 0006 / 0007 / 0009 already amended at plan review. Update `docs/architecture.md` match-logging + marker notes (logging-only session markers; inert values; response-body URL-match markers; single pipeline; no native-host match log). After Phase 1, add probe evidence cite to ADR 0006 amendment (same style as P6). Sync package README only if user-facing behavior described there.

**Acceptance:** Architecture matches shipped decision; no “body silent” / “body never DNR” contradiction; ADR 0006 cites probe when green.

**Tests prove:** Doc review in phase gate (no code test); `pnpm validate` still green after doc-only if no code.

### Phase 8 — End-to-end verify (checklist §8) — AC1–AC10

Focused extension/editor/browser tests + `pnpm validate`. Optional thin live journey: body rule + match logging on → console line (if browser harness allows without #170 rewrite success).

**Acceptance:** Canonical validate green; probe + unit evidence mapped to AC1–AC10 (checklist spot-check).

**Tests prove:** `pnpm validate`; probe + match-* + editor redact + lifecycle orphan tests green.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Over-engineering:** full F17 capability-token / proxy auth for logging-only | Logging = DNR set for signal + existing reserved-header strip; no pending-auth map, no rewrite gate, no #170 PAC |
| Capability leak via marker value | Inert logging values; never embed session capability / digest / rewrite auth; #170 may later replace or join with real capability markers under a separate decision |
| DNR set + DNR strip dual-assert fail | **Locked:** never ship that pair; runtime strip only |
| Cross-store / cross-band wipe | Session helper owns body band in session store only; dynamic reconciler unchanged for redirect/query/header (ADR 0009) |
| Marker leak if strip path missing | Do not install markers without active runtime strip; fail-closed silence |
| Orphan markers after stop | Remove owned session rules on stop / start-failure; index drop those ids |
| Index race (dynamic install vs session markers) | Explicit merge on session start/stop; document order |
| Coupling to #170 | Need strip scaffolding only, not PAC rewrite; lines mean attempt, not rewrite success |
| Match-index storage shape drift | Sanitize unknown kinds fail-closed (existing pattern) |
| Response-body probe inconclusive | Both shapes passed §1; keep gates if future probes regress |

## Acceptance criteria

| ID | Criterion | Check how | Checklist |
| --- | --- | --- | --- |
| AC1 | Live URL match of request-body or response-body rule emits one `[rogatio]` console line when match logging on | Format + listener tests with body kind indexed; optional live journey in §8 | §4, §5, §8 |
| AC2 | Same signal, toggle, fail-closed, field/style, redaction as DNR kinds; no native-host match log | Listener fail-closed matrix + redact on body format; code/docs never add native match feed | §4, §5, §7, §8 |
| AC3 | Line has live URL, method, initiator, resource type + intended mode + ≤200 rewrite text; no live body bytes | `match-format` asserts fields; assert no live `body` / marker values in output | §4, §8 |
| AC4 | Request-body markers via session DNR (or documented dynamic fallback); response-body only after probe | Probe two asserts; lifecycle skips gated kinds | §1, §3, §8 |
| AC5 | ADRs/architecture record single pipeline + reject native-host match logging | Doc gate + ADR 0006 probe cite | §7 |
| AC6 | Post-lookup append seam usable by #204; no history UI | Seam unit test; no history store/UI | §5 |
| AC7 | Body editor cards expose `redactSensitiveInLogs` | Editor test visible + toggle | §6 |
| AC8 | New body id band; existing bands not wiped | Helper unit tests: band math + no dynamic wipe | §2, §3 |
| AC9 | Independent of #170 | Lifecycle/helper tests + review: no PAC, pending-auth, or capability mint | §3, §8 |
| AC10 | Logging markers inert (no rewrite capability / digest in values); removed on session stop / start-failure | Inert-value assert on built rules; orphan-on-stop + start-failure tests | §1, §2, §3, §8 |

## Contracts

`skipped`

## Implementation strategy

**TDD** — red-green per phase (§2–§6). **Exception:** Phase 1 browser probe is empirical (Code first against Chrome, then lock event-fire + no-upstream-leak asserts before later phases ship gated kinds).

## Plan-review gate (2026-09-20)

Approved. Locked:

- Logging marker values inert (not F17 capability tokens); sentinel = opaque rule/marker id string.
- Session body band `3_000_001+`.
- No body match lines when native session is down (fail-closed).
- §8 optional live console journey: skip if harness blocked without #170; unit path covers AC1.

## §1 implementation-review gate (2026-09-20)

Approved with recommendations. Locked:

- Amend mechanism: **DNR session set (inert) + non-DNR runtime/proxy strip** — never DNR set + DNR strip of the same header.
- Rebase feature branch onto `main` before more browser work.
