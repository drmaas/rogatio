# Checklist — dnr-install-reconcile

**Audience:** agent  
**Plan:** `docs/decisions/dnr-install-reconcile/plan.md`  
**Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-dnr-install-reconcile`  
**Branch:** `feature/dnr-install-reconcile`  
**Contracts:** skipped  
**Strategy:** TDD

Track progress in this file. Stay in `packages/extension` + tests. Do not change browser-core status math unless tiny diagnostic plumbing.

---

## Gate — before implement

- [x] Plan review + ADRs written: 0008 install identity, 0009 unified reconciler, 0010 diagnostics (arch-sec). QA-testability: TDD; P1/P2 empty-tracked + Chrome-held units; P4 SW-restart proof steps.
- [x] Human Q2: one PR (plan gate)
- [x] Implementation strategy filled in `plan.md` (TDD)

---

## P1 — Remove via Chrome ∩ Rogatio ids (intent A)

**AC:** AC1  
**Prove (TDD first):** `packages/extension/test/dnr.test.ts` — construct `createDnrInstaller` with empty `tracked` (new instance), fake `getDynamicRules` returning Chrome-held desired numeric ids, same compiled ops. Assert remove set includes those ids; `install` is `ok: true` (no duplicate-id). Index not required for this remove test.

- [x] Map owned numeric bands (redirect/query 1–1_000_000 vs header `2_000_001+`) in reconciler remove helper (ADR 0009)
- [x] Change remove set: `getDynamicRules()` ∩ Rogatio-owned ids (not only in-memory `tracked` keys)
- [x] Keep remove kind-scoped (no cross-band wipe)
- [x] If `getDynamicRules` throws: fail closed — do not treat live set as empty and add
- [x] Drop orphan Chrome ids that Rogatio owns but are no longer desired
- [x] Unit first (TDD): empty-`tracked` + Chrome-held desired ids → remove includes those ids; `install` `ok: true`
- [x] Unit: undesired orphan id removed; foreign/non-Rogatio id left alone
- [x] Unit: `getDynamicRules` throw does not empty-remove then add
- [x] Unit: `getDynamicRules` non-array fail-closed (unreadable live set)
- [x] Unit: empty desired drops owned Chrome ids; foreign/header left alone
- [x] Unit: orphan bulk-remove failure still reinstalls via per-rule remove+add
- [x] Phase verify: format/lint/typecheck + focused `dnr.test.ts`

---

## P2 — `current()` survives restart (intent B)

**AC:** AC2  
**Prove (TDD first):** same empty-`tracked` + Chrome-held ids setup as P1, plus seeded `rogatio.matchLogging.index` + compiled ops this turn. Hydrated `current()` / reported ids include those compiler `ruleId`s and return the compiled op identity (not a rebuilt object). Join seam: Chrome ∩ index ∩ compiled.

- [ ] Reuse `rogatio.matchLogging.index` only (ADR 0008). No sibling key, no new install fields
- [ ] Resolve installed ids from: Chrome live ids ∩ index `ruleId` ∩ compiled ops from project (not index-alone rebuild)
- [ ] Hydrate cold `current()` / `installedRuleIds` from that join; do not change adapter `current()` signature
- [ ] Write/update durable identity on successful install for redirect/query (header write lands in P3a)
- [ ] Wire `projectState` so `installedRuleIds` are correct after SW death (join this turn, then warm `current()`)
- [ ] Unit first (TDD): empty `tracked` + Chrome-held ids + index + compiled → `current()` / reported ids non-empty
- [ ] Unit: empty `tracked` + Chrome-held ids, **no** index → not reported (no `ruleIdHash` guess)
- [ ] Unit: Chrome missing / index-only id → not reported; malformed index entries ignored
- [ ] Phase verify: focused unit + no body-path regressions in touched SW paths

---

## P3a — Fold headers into reconciler (intent C)

**AC:** AC3 (+ AC7 regression if SW overlay touched)  
**Prove:** unit — headers use same remove/install/`installedRuleIds` authority as redirect/query; no separate header-only path.

- [ ] Fold `installHeaderRules` into unified reconciler (call-path only; no unrelated dnr.ts cleanup)
- [ ] Remove dual path in `projectState`
- [ ] Kind-scoped bands preserved under unified remove
- [ ] Write header identity on successful install (same index key; ADR 0008)
- [ ] Unit: unified header+redirect/query install/remove
- [ ] Unit: empty `tracked` + Chrome-held header ids (`2_000_001+`) → remove/`installed` same authority
- [ ] Unit/assert: body still native overlay if SW touched
- [ ] Phase verify: focused extension unit tests

---

## P3b — Shared diagnostics + attention (intent C)

**AC:** AC4, AC5  
**Prove:** unit — redirect/query/header failures emit `extension.dnr-error` with Chrome reason; attention helper no longer primary-pushes re-activate/restart-runtime for this class; no unproven reload string.

- [ ] Total fail: `install` returns `{ ok: false, diagnostics }` with Chrome reason in params when available (ADR 0010)
- [ ] Partial success: keep `{ ok: true }`; do not flip `ok: false`
- [ ] `projectState` reads install reasons; overlay `extension.dnr-error` + `params.reason` for redirect/query/header
- [ ] Attention: drop primary “Re-activate the group, or restart the native runtime” for this error class when reconcile fixes it
- [ ] Do **not** bake “reload the extension” unless a test proves it
- [ ] Unit: total-fail diagnostics for redirect/query and header
- [ ] Unit: partial success `ok: true` + overlay reason on the failed sibling
- [ ] Unit: pure attention helper (extract if needed; do not unit the page-closed `attentionFromStatuses`) — must **not** return “Re-activate the group, or restart the native runtime” as primary fix; no “reload the extension”
- [ ] Phase verify: extension unit suite green

---

## P4 — Browser journey (intent D)

**AC:** AC6, AC7  
**Prove:** new focused file `test/browser/dnr-install-reconcile.test.ts` (do **not** bolt onto `sample-basic-live`). Reuse `importAndEnableSample`, `getExtensionState`, `statusFor` from `test/browser/sample-basic-helpers.ts`. Reuse CDP stop/`waitForWorkerTarget` pattern from `test/browser/header-match-probe.test.ts` (extract or copy).

**Observe (named ids):**

| Kind | Sample `ruleId` | After restart |
| --- | --- | --- |
| redirect | `rule-redirect` | `statusFor` → `active` |
| query | `rule-query` | `statusFor` → `active` |
| header | `rule-header-set`, `rule-header-remove` | `statusFor` → `active` |
| body | `rule-response-body`, `rule-request-body` | `statusFor` → `needs runtime` |

Workspace `[data-rule-statuses]` must not show “not installed” for those DNR rules.

**SW-restart proof (all must pass; CDP failure is a fail, not a skip):**

1. `extensionContext({ grantOrigins })` like `sample-basic-live`; import+enable `samples/basic`.
2. Baseline: DNR ids `active`; body ids `needs runtime` (`statusFor` on `getExtensionState`).
3. Snapshot `chrome.declarativeNetRequest.getDynamicRules()` numeric ids (from the extension page).
4. `stopExtensionServiceWorkerViaCdp` result must be `"stopped"`. Fail if `no-target` / `no-version` / `cdp-error`.
5. Assert worker target gone (`waitForWorkerTarget(..., "gone")`).
6. Reopen `chrome-extension://<id>/index.html` Workspace; wait worker alive (`waitForExtensionServiceWorker` or `waitForWorkerTarget(..., "alive")`).
7. Re-read `getExtensionState`; assert the table above. UI list must not contain “not installed” for DNR sample rules.
8. `getDynamicRules()` still contains the snapshotted numeric ids (Chrome still holds them).

- [ ] New focused browser test file + reuse helpers (not `sample-basic-live`)
- [ ] Seed grants; import/enable sample; record baseline `statusFor` + Chrome ids
- [ ] CDP stop `"stopped"` + worker gone (fail on inconclusive)
- [ ] Reopen Workspace; worker alive; DNR `active`; body `needs runtime`; Chrome still holds snapshotted ids
- [ ] Phase verify: that browser test green; then `pnpm validate`

---

## Done criteria

- [ ] All AC1–AC7 checked with evidence in PR/description
- [ ] No third durable install map
- [ ] No browser-core status formula change (unless documented tiny plumbing)
- [ ] Contracts untouched
- [ ] Implementation review + human gate per phase (RPI)
