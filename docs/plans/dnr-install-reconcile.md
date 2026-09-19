# Plan — dnr-install-reconcile

> Status: frozen 2026-09-18


**Audience:** hybrid  
**Status:** approved — implement next  
**Plan gate:** Approved (Q2 → one PR; strategy → TDD)  
**Feature:** `dnr-install-reconcile`  
**PRD / research:** `docs/decisions/dnr-install-reconcile/{prd,research}.md`  
**Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-dnr-install-reconcile`  
**Branch:** `feature/dnr-install-reconcile`  
**Scope:** `packages/extension` + unit/browser tests. browser-core status math unchanged unless tiny diagnostic plumbing required.

## Goal

After MV3 service-worker restart, Workspace status for redirect, query, and header rules matches Chrome’s live dynamic DNR set. One reconciler owns remove/install/report. Failed adds surface Chrome reasons. Body rules stay on native-runtime status (not DNR).

## Non-goals

- Body semantics / body match-logging (#163).
- Schema, compiler shapes, editor authoring.
- Moving Chrome DNR into `browser-core`.
- Store/packed match-logging gaps; multi-project id-band redesign beyond reconciler correctness.
- Badge-math redesign beyond attention copy that depends on accurate statuses.
- Baking “reload the extension” recovery text unless a test proves it; prefer automatic reconcile that makes bad copy unnecessary.

## Architecture

**Parties.** Chrome DNR (live dynamic rules), extension reconciler (adapter), `chrome.storage.local` match index, compiled project in `projectState`, browser-core status math (consumer only), Workspace overlay.

**Trust.** Chrome live set is authority for what is enforced. Stored index is untrusted (ADR 0003). Compiled project is the only operation source. Browser-core does not talk to Chrome. Body rules never enter the DNR installer.

**Reconciler (ADR 0009).** One extension path for redirect + query + header. Remove set = `getDynamicRules()` ∩ kind-scoped owned bands (redirect/query 1–1_000_000; header `2_000_001+`). Never trust only in-memory `tracked`. `getDynamicRules` throw → fail closed (do not treat as empty and add).

**Identity (ADR 0008).** Reuse `rogatio.matchLogging.index`. No third map. Join: Chrome ids ∩ index `ruleId` ∩ compiled ops from `projectState`. Do not rebuild operations from the index. `current()` signature unchanged; hydrate from that join when memory is cold.

**Diagnostics (ADR 0010).** No adapter signature change. `ok: false` only on total failure. Partial success stays `ok: true`. Per-rule Chrome reasons use the existing Workspace `extension.dnr-error` + `params.reason` overlay (generalize headers to all DNR kinds). `projectState` must read those reasons.

### Locked ADRs

| ADR | Choice |
| --- | --- |
| [0008](../../adrs/0008-reuse-match-index-for-install-identity.md) | Reuse `rogatio.matchLogging.index` as `numericId → ruleId`. No sibling key. Compiled project supplies operations. |
| [0009](../../adrs/0009-unified-dnr-reconciler-kind-scoped-bands.md) | One reconciler; kind-scoped bands; fail closed if live set unreadable. |
| [0010](../../adrs/0010-dnr-install-diagnostics-fill.md) | Fill existing `install` diagnostics; overlay `extension.dnr-error`; no adapter / core-code change. |

### Public API / wire-format

- No `RuleInstallerAdapter` change. No envelope / index-key / index-shape change.
- Soft change only: attention strings after reconcile works. No unproven “reload the extension” copy.

## Phases

Map to product intent A–D. Stay inside extension + tests.

| Phase | Intent | Deliverable |
| --- | --- | --- |
| **P1 (A)** | Remove via Chrome ∩ Rogatio ids | Live Chrome ids ∩ owned bands; fail closed if live set unreadable; no empty-remove-then-duplicate-add after restart. **TDD first:** empty `tracked` + Chrome-held ids in `dnr.test.ts`. |
| **P2 (B)** | `current()` / installed ids survive restart | ADR 0008 join (Chrome ∩ index ∩ compiled). Hydrate; do not rebuild ops from index. **TDD first:** empty `tracked` + Chrome-held ids + seeded index. |
| **P3a (C)** | Fold headers | Same reconciler for header remove/install/`installedRuleIds` as redirect/query. Unit: unified path + empty `tracked` + Chrome-held header ids (`2_000_001+`). |
| **P3b (C)** | Shared diagnostics + attention | ADR 0010: total-fail diagnostics + Workspace overlay for all DNR kinds; attention drops primary re-activate/restart-runtime for this class; no unproven reload string. |
| **P4 (D)** | Browser journey | New focused test (not bolted onto `sample-basic-live`). Seed grants → import/enable sample → baseline `statusFor` → CDP SW stop proven dead → reopen Workspace → DNR `active`, body `needs runtime`. |

P3a→P3b stay one product intent (C); split only so each slice stays ≤~8 tasks. Stacked PR option may cut after P3a or after P3b.

### Delivery decision (open — human at plan gate)

**Q2:** One feature branch (`feature/dnr-install-reconcile`). Prefer **one PR** if review load OK; else stacked **P1→P2→P3a→P3b→P4**. Recommendation: one PR unless diff exceeds comfortable review size after P3b.

## Risks

| Risk | Mitigation |
| --- | --- |
| Third durable map (over-engineering) | ADR 0008: reuse match index only. |
| `current()` rebuilds ops from index | Forbidden (0003/0008); join compiled project this turn. |
| `getDynamicRules` throw treated as `[]` | ADR 0009: fail closed; do not empty-remove then add. |
| Cross-band remove | ADR 0009 bands; tests for both. |
| Partial-add `ok: true` hides Chrome reasons | ADR 0010: overlay per-rule `extension.dnr-error`; do not flip `ok: false`. |
| `ok: false` on partial → InstallService rollback | ADR 0010: `ok: false` only when zero desired rules landed. |
| Touching browser-core status formulas | Out of scope unless documented tiny plumbing. |
| Oversized “god reconciler” | Fold headers by call-path; no unrelated dnr.ts cleanup. |
| Unproven “reload extension” copy | Automatic reconcile first; change attention only after behavior works. |

## Acceptance criteria

| ID | Criterion | Phase | Tests |
| --- | --- | --- | --- |
| AC1 | Post-restart install remove uses Chrome ∩ Rogatio ids; no duplicate-id failure when Chrome still holds desired rules. | P1 | **TDD:** `packages/extension/test/dnr.test.ts` — new installer (empty `tracked`), `getDynamicRules` returns Chrome-held desired numeric ids → remove set includes those ids; `install` `ok: true` (no duplicate-id). |
| AC2 | After SW restart, reported `installedRuleIds` / hydrated `current()` include still-present redirect/query (and later header) compiler ids via Chrome ∩ index ∩ compiled (not index-alone ops). | P2 | **TDD:** same empty-`tracked` + Chrome-held setup + seeded `rogatio.matchLogging.index` + compiled ops this turn → `current()` / reported ids non-empty, same compiled op identity. Negatives: no index → not reported (no hash guess); index-only / Chrome-missing → not reported. |
| AC3 | Header install/remove/`installed` go through same reconciler authority as redirect/query. | P3a | Unit: unified path; empty `tracked` + Chrome-held header ids in `2_000_001+` band. |
| AC4 | DNR add/update failure surfaces `extension.dnr-error` with Chrome reason when provided (overlay; adapter fill on total fail). Partial success stays `ok: true`. | P3b | Unit: total-fail diagnostics (redirect/query + header); partial-success `ok: true` + overlay reason on failed sibling. |
| AC5 | Attention does not primary-push re-activate/restart-runtime for false “not installed” when reconcile fixes it; no unproven reload string. | P3b | Unit: extract/test a pure helper (today `attentionFromStatuses` is unexported and closes over page `state`). Must **not** return “Re-activate the group, or restart the native runtime” as primary fix for this class; no “reload the extension” string. |
| AC6 | Browser: sample → SW restart → redirect, query, header sample rules `active` given prior grants/enablement. | P4 | Browser: `test/browser/dnr-install-reconcile.test.ts`. Observe per-rule via `getExtensionState` + `statusFor` on `rule-redirect`, `rule-query`, `rule-header-set`, `rule-header-remove`. Prove SW death before reopen (see checklist). |
| AC7 | Body rules remain `needs runtime` until native `started`, then `active`; never DNR-installed. | P4 (+ regression if SW overlay touched earlier) | Same journey: `statusFor` on `rule-response-body`, `rule-request-body` stays `needs runtime`. |

## Contracts note

`skipped` (Q3). No `docs/contracts.md` edits.

## Implementation strategy

TDD

Chrome DNR and storage are already fakeable in `dnr.test.ts`; write the empty-`tracked` + Chrome-held units (P1/P2) and the P4 journey first, then make them pass.
