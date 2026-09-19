# PRD — dnr-install-reconcile

> Status: frozen 2026-09-18


**Audience:** hybrid  
**Status:** approved — research next  
**Contracts preference:** skip  
**PRD gate:** Approved with recommendations (Q1→plan/ADR; Q2→plan gate; Q3→skip)  
**Feature:** `dnr-install-reconcile`  
**Base branch:** `main`  
**Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-dnr-install-reconcile`

## Problem

Redirect and query rules in an active sample project often show `error` after the Manifest V3 (MV3) service worker restarts. The message is “enabled with granted site access but is not installed.” Site access is already granted.

Header and body rules still look fine. Header rules use a different install path than redirect and query. That split is why only some Declarative Net Request (DNR) kinds fail after restart. The same false “not installed” class can hit headers later unless all DNR kinds share one install and status authority.

The UI tells the user to re-activate the group or restart the runtime. Those steps often do not fix it. Users cannot tell whether Chrome still enforces the rules.

## User

Extension users who enable Rogatio rule groups, including the sample project. They expect Workspace status to match what Chrome actually enforces.

## Outcome

For every DNR-backed rule kind (redirect, query, header):

1. Workspace status matches Chrome’s installed dynamic rules after worker restart.
2. Failed installs show a real Chrome reason when Chrome provides one.
3. Recovery advice matches actions that actually clear the bad state.
4. A browser test proves: activate sample → worker restart → DNR rules stay `active`.
5. Body rules stay on the native-runtime status path. They are `needs runtime` until native phase `started`, then `active`. This feature does not treat body as DNR-installed.

## Scope

- One extension reconciler for redirect, query, and header DNR installs.
- Durable `current()` / installed-id reporting that still works after the service worker restarts.
- Install and replace must use Chrome’s live DNR set plus Rogatio-owned ids. Do not trust only in-memory ids that die with the worker.
- Shared install-failure diagnostics for DNR kinds.
- Attention and recovery copy that matches steps that actually work.
- Unit and browser proof for restart consistency on the sample project journey.

## Non-goals

- Changing body-rule semantics or logging body matches (#163).
- Changing schema, compiler operation shapes, or editor authoring UX.
- Moving DNR install logic into `browser-core`. Chrome work stays behind the extension adapter.
- Store / packed-extension match-logging gaps.
- Redesigning badge math beyond attention copy that depends on accurate statuses.
- Multi-project DNR id collision redesign beyond what the reconciler needs to stay correct.

## Requirements

Each row traces to an Outcome number.

| ID | Requirement | Outcome |
| --- | --- | --- |
| R1 | After an MV3 service-worker restart, enabled+granted redirect and query rules report `active` when still present in Chrome dynamic rules, or they reinstall cleanly without a duplicate-id failure. | 1 |
| R2 | Header rules use the same install and reconcile authority as redirect and query. One notion of “installed.” | 1 |
| R3 | When a DNR add or update fails, Workspace surfaces `extension.dnr-error` (or equivalent) with Chrome’s reason for that rule when Chrome provides one. | 2 |
| R4 | Attention copy must not treat “re-activate the group” or “restart the runtime” as the primary fix when those steps cannot clear orphaned DNR ids. Prefer guidance that works (for example reload the extension), or automatic reconcile that makes those steps unnecessary. | 3 |
| R5 | Browser journey: import or activate sample → force worker restart → reopen management → redirect, query, and header sample rules are `active` given prior grants and enablement. | 4 |
| R6 | Body rules remain `needs runtime` until native phase `started`, then `active`. This feature must not mark them installed via DNR. | 5 |

## Metrics

Omit. No sourced baseline or owner date for install-error rates.

## Open questions

| ID | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| Q1 | Reuse `rogatio.matchLogging.index` for install identity, or a sibling storage key? | Plan / ADR | Reuse or tightly couple to the existing durable index so one map survives restart. Avoid a third source of truth. |
| Q2 | Ship as one PR or stacked PRs per slice? | Human at plan gate | One feature branch. Prefer one PR if review load is acceptable, else stacked PRs. |
| Q3 | Contracts (`docs/contracts.md`) for this feature? | Human at contracts gate after PRD approval | Skip unless a machine-readable extension contract already exists and needs a section. |
