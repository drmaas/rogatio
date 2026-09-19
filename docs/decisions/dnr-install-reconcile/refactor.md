# Refactor proposals — dnr-install-reconcile

**Audience:** hybrid  
**Status:** candidates 1–2 implemented — awaiting commit / freeze  
**Feature:** `dnr-install-reconcile`  
**Base:** `main` / `origin/main`  
**Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-dnr-install-reconcile`  
**Inputs:** `plan.md`, `checklist.md`, `research.md`, `git diff main..HEAD`

## Verdict

Feature already folded headers into one reconciler, extracted `dnr-harness.ts`, and updated `architecture.md` for ADR 0008–0010. Leftover leverage is small: shared CDP SW helpers, and one install authority in the service worker so `takeInstallErrors` has a single consumer.

## Candidates

### 1. Shared CDP service-worker helpers (browser tests)

| | |
| --- | --- |
| **What** | Move `stopExtensionServiceWorkerViaCdp`, `waitForWorkerTarget`, `extensionWorkerTargetCount`, and related types out of both `test/browser/header-match-probe.test.ts` and `test/browser/dnr-install-reconcile.test.ts` into one module (e.g. `test/browser/cdp-service-worker.ts`). Keep probe-only helpers (`absenceHolds`, match listeners) in the probe file. |
| **Benefit** | ~100 lines duplicated today (file comment: “Copied from header-match-probe”). Next SW-restart journey reuses one proven stop/`gone`/`alive` seam; fixes land once. |
| **Risk** | Low — test-only move; behavior already asserted in P4 and probe Q4. |
| **Scope** | `test/browser/` only. No product code. |
| **Test plan** | Run `header-match-probe` and `dnr-install-reconcile` browser tests; confirm CDP stop still fails closed on inconclusive results. |
| **Recommendation** | **pursue** |

### 2. Single DNR install authority in `service-worker.ts`

| | |
| --- | --- |
| **What** | Drop residual `options.installer.install(dnrManagedOps(...))` before/around `state()` on `start-native-runtime`, `stop-native-runtime`, and grant/revoke. Rely on `projectState` (already used by `set-group-enabled`) for hydrate → sameSet → install → `takeInstallErrors` → overlay. Keep `dnrManagedOps` as the shared desired-set filter. |
| **Benefit** | Three call sites still reinstall then call `state()`, which may install again. Side installs clear `lastInstallErrors` on a second `install()` and can skip overlay take when `sameSet` is already true. One path matches ADR 0009 “full desired set” and ADR 0010 overlay read. |
| **Risk** | Medium — confirm native start/stop and permission flows still land DNR before UI reads state; watch double-`current()` cost (already paid inside `projectState`). |
| **Scope** | `packages/extension/src/service-worker.ts` + existing unit coverage (`hydrate-status`, `permission-grant`, native/runtime tests if any). |
| **Test plan** | Focused: set-group-enabled full-desired (already in `hydrate-status`); permission grant/revoke install; start/stop native still leave redirect/query/header installed and body on runtime overlay. Then `pnpm validate`. |
| **Recommendation** | **pursue** |

### 3. Replace consume-once `takeInstallErrors` overlay channel

| | |
| --- | --- |
| **What** | If candidate 2 does not land, or a second install caller must remain: stop relying on clear-on-read. Prefer returning per-rule errors from the extension-only installer surface (without widening `RuleInstallerAdapter` / ADR 0010), or `peek` + explicit clear inside `projectState` only. |
| **Benefit** | Removes footgun where a non-`projectState` `install()` leaves errors unread or a later `install()` wipes them before overlay. |
| **Risk** | Medium — touches `dnr.ts`, duck-type helpers, and diagnostic unit tests; easy to over-design relative to ADR 0010’s “no adapter change.” |
| **Scope** | `dnr.ts`, `service-worker.ts`, `dnr.test.ts` / permission diagnostic tests. |
| **Test plan** | Total-fail and partial-success overlay units; grant path that installs then projects state still shows `extension.dnr-error` + `params.reason`. |
| **Recommendation** | **defer** — pursue only if candidate 2 leaves a multi-caller, or a bug appears where overlay reasons vanish. Prefer 2 first. |

### 4. Further `dnr-harness` extraction

| | |
| --- | --- |
| **What** | Expand harness beyond `chromeHeldInstaller` / `desiredNumericId` into `match-index.test.ts` local `dnrApi` fixtures, or more install-probe helpers. |
| **Benefit** | Marginal — harness already shared by `dnr.test.ts`, `hydrate-status.test.ts`, `permission-grant.test.ts`. |
| **Risk** | Low benefit / churn; match-index fixtures intentionally exercise storage/index shapes differently. |
| **Scope** | extension unit tests. |
| **Test plan** | N/A if skipped. |
| **Recommendation** | **skip** |

### 5. `architecture.md` currency pass

| | |
| --- | --- |
| **What** | Feature diff already documents unified reconciler, index-as-identity (ADR 0008), hydrate in `projectState`, wholesale index write, and attention/overlay copy. Optional polish: name `hydrateInstalled` / `takeInstallErrors` as extension-private duck-typed seams next to the installer bullet. |
| **Benefit** | Small clarity for the next reader; not a behavior refactor. |
| **Risk** | Negligible. |
| **Scope** | `docs/architecture.md` only. |
| **Test plan** | Docs-only; no code gate. |
| **Recommendation** | **defer** — optional freeze polish, not a refactor sprint. Do not treat as incomplete product docs. |

## Rejected (self-review)

| Idea | Why reject |
| --- | --- |
| Split `dnr.ts` “god reconciler” into many modules | Plan risk: oversized cleanup out of scope; unified path is the feature. |
| Widen `RuleInstallerAdapter` / move DNR into `browser-core` | Explicit non-goals; ADR 0010. |
| Rewrite attention / badge math | Attention already extracted to pure `attention.ts`; badge redesign out of scope. |
| Large architecture rewrite | Currency already applied in this branch; leftover is naming duck-typed seams. |

## Suggested order if opted in

1. Candidate **1** (CDP helpers) — isolated, test-only.  
2. Candidate **2** (single install authority) — product clarity + overlay correctness.  
3. Candidate **3** only if **2** insufficient.  
4. Candidate **5** at freeze if desired.

## Summary table

| # | Candidate | Recommendation |
| --- | --- | --- |
| 1 | Shared CDP SW helpers | **pursue** |
| 2 | Single install path via `projectState` | **pursue** |
| 3 | Non-consume-once install errors | **defer** |
| 4 | More `dnr-harness` | **skip** |
| 5 | `architecture.md` seam naming | **defer** |
