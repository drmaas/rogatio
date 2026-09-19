# Research — dnr-install-reconcile

> Status: frozen 2026-09-18


**Audience:** hybrid  
**Status:** approved — plan next  
**Research gate:** Approved with recommendations (Q1→ADR; Q2→plan gate; reload-extension claim → prove or avoid)  
**Feature:** `dnr-install-reconcile`  
**PRD:** `docs/decisions/dnr-install-reconcile/prd.md`

## Problem restatement

After MV3 service-worker restart, enabled+granted redirect/query rules often show Workspace `error` (“not installed”) even when Chrome still holds the dynamic rules. Header install uses a separate path. Attention copy pushes re-activate / restart runtime, which does not clear orphaned DNR ids. Body rules stay on native-runtime status, not DNR.

## Codebase findings

### R1 — Restart loss and duplicate-id path

`createDnrInstaller` keeps install identity in an in-memory `tracked` map (`packages/extension/src/dnr.ts:131`).

`current()` intersects `getDynamicRules()` with `tracked` only (`dnr.ts:201–215`). `getDynamicRules` throw → `[]` (`dnr.ts:207–208`). After SW restart `tracked` is empty → `current()` returns `[]` even when Chrome still has rules.

`install()` removes only `[...tracked.keys()]` (`dnr.ts:221`, `246–253`), then `tracked.clear()` (`dnr.ts:254`), then per-rule add with `removeRuleIds: []` (`dnr.ts:266–269`). Post-restart: remove set empty → add hits existing Chrome ids → catch logs failure, leaves `tracked` empty (`dnr.ts:272–279`). Also cannot drop Chrome ids that are no longer desired.

All adds fail, or DNR missing → `{ ok: false, diagnostics: [] }` (`dnr.ts:243–244`, `288–290`). Any add success → `{ ok: true }` even if others failed. No Chrome reason to Workspace.

`projectState` uses `installer.current()` for `installedRuleIds`, then reinstalls redirect/query when desired compiler `ruleId` set ≠ current (`service-worker.ts:301–379`). Empty `current()` after restart looks like “nothing installed” → `install(desired)` → duplicate-id path. Install throw swallowed (`service-worker.ts:387–389`).

Live numeric bands: redirect/query `ruleIdHash` → 1–1_000_000 (`dnr.ts:113–118`); headers `2_000_001 + index` (`projection.ts:263`). Unified remove must stay kind-scoped.

### R2 — Header split

`dnrManagedOps` filters only `redirect` / `query`; comment: headers via `installHeaderRules` (`service-worker.ts:245–262`).

Headers: `installHeaderRules` (`installer.ts:131–190`) removes via `getDynamicRules ∩ removeRuleIds` (`installer.ts:161–176`), then batch add. `projectState` passes all header projection ids as the remove set (`service-worker.ts:323–326`). Success compiler `ruleId`s appended to `installedRuleIds` (`service-worker.ts:327–331`). Separate from `createDnrInstaller.tracked`. This live-set remove is why headers survive restart.

### Durable index (logging, not install authority)

Key `rogatio.matchLogging.index` (`match-index.ts:10`). Snapshot shape: `numericId → { ruleId, name, kind, redactSensitiveInLogs, intent }` (`match-index.ts:35–43`, `272–284`). ADR 0003: survives restart for match logging; `tracked` lost on restart; do not recompute via `ruleIdHash`; do not persist a full `RogatioOperation` (`docs/adrs/0003-durable-dnr-match-index.md:5–11`). Written after redirect/query install (`dnr.ts:284–286`) and header sync (`dnr.ts:292–301`). **Not** read by `current()` or status.

`RuleInstallerAdapter.current()` must return full `RogatioOperation[]` (`browser-core/src/types.ts:41–43`). Index is log-intent only, so Q1 reuse cannot implement `current()` without the compiled project (already in `projectState`) or an adapter-shape change.

### R3 — Status and install diagnostics

`computeRuleStatuses`: enabled+granted but missing from `installedRuleIds` → `error` + `core.rule-not-installed` (`browser-core/src/status.ts:62–73`). Message: “enabled with granted site access but is not installed.” (`browser-core/src/diagnostics.ts:41–42`). `installedRuleIds` are compiler string `ruleId`s, not numeric DNR ids.

Header failures: `extension.dnr-error` with Chrome/`Error` message (`installer.ts:178–187`); one Chrome error applied to every header in the failed batch. Swapped onto status in `operationStatuses` (`service-worker.ts:143–155`) as `params.reason`. Workspace prefers `extension.dnr-error` and shows `params.reason` (`extension-page-entry.ts:146–150`, `167`). Redirect/query `install` does not surface Chrome reasons (empty `diagnostics`).

### R6 — Body path unchanged

`request-body` / `response-body`: if compute status is active/error, overlay `unsupported` when `nativePhase === "unsupported"`, else `needs runtime` until `nativePhase === "started"`, then `active` (`service-worker.ts:168–194`). Not DNR-installed. Do not put body ids through the DNR installer.

### R4 — Attention copy

`attentionFromStatuses` for `error`: fix = “Re-activate the group, or restart the native runtime.” (`extension-page-entry.ts:310–316`). Same helper feeds Workspace badge (`extension-page-entry.ts:389–397`) and `.rogatio-attention-note` (`extension-page-entry.ts:556–563`). Popup has badge attention flag only (`popup-model.ts:37`); no recovery sentence.

Repo does not prove “reload the extension” clears orphaned DNR ids. Confirm before baking that string. Automatic reconcile can make the copy unnecessary.

### R5 — Tests and sample

Sample: redirect, query, two headers, response-body, request-body (`samples/basic/.rogatio.json:11–89`).

Unit: `packages/extension/test/dnr.test.ts` (no Chrome-held-ids + empty `tracked` case), `match-index.test.ts`, `installer.test.ts`, `permission-grant.test.ts` (header `extension.dnr-error`). Browser: mocked attention/`extension.dnr-error` in `test/browser/extension.test.ts`; real import lifecycle in `extension-real.test.ts` (synthetic one-redirect project; no SW restart; no `active` status assert). CDP SW stop helper `stopExtensionServiceWorkerViaCdp` (`test/browser/header-match-probe.test.ts:293`) used at `:420` — reusable pattern, not sample reconcile journey. **Gap:** no browser test for activate sample → SW restart → redirect/query/header `active`. No unit test for the restart `current()` / duplicate-id path.

### Adapter boundary

`RuleInstallerAdapter.current` / `install` (`browser-core/src/types.ts:41–43`). `install` failure type expects `diagnostics: readonly CoreDiagnostic[]` (`types.ts:46–48`); DNR installer returns `never[]`. Chrome DNR stays in extension; browser-core only consumes reported ids.

## Constraints and invariants

- Chrome DNR work stays in extension adapter (PRD non-goal: no move into browser-core).
- Body semantics and match-logging for body (#163) out of scope.
- Schema/compiler/editor authoring unchanged.
- Match index today is log-intent; reuse for install identity needs ADR (Q1) so one map survives restart — avoid third source of truth (PRD). Index cannot replace `current()` operations by itself.
- Status truth: DNR Workspace `active` iff compiler `ruleId` in reported `installedRuleIds`. Body uses native overlay, not that set.
- Unified reconciler must not remove the other kind’s numeric band.

## Open questions

| ID | Question | Owner | Note |
| --- | --- | --- | --- |
| Q1 | Reuse `rogatio.matchLogging.index` for install identity, or sibling key? | Plan / ADR | PRD recommends reuse or tight couple; one durable map. `current()` still needs compiled ops (index has no full operation). |
| Q2 | One PR vs stacked PRs? | Human at plan gate | Deferred. |
| Q3 | Contracts for this feature? | — | Skipped per PRD gate. |
