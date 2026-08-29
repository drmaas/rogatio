# F18 Workflow Log

**Feature:** F18 - E2E and Integration Test Suite
**Base branch:** `main` @ `c3fb505`
**Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/f18-e2e-tests`
**Branch:** `feature/f18-e2e-tests`
**Started:** 2026-08-26
**Completed:** 2026-08-26

## Model tier

- **Tier:** Single-model session, selected by the user ("use ONLY the current freebuff
  model for all tasks"). The session model is `z-ai/glm-5.2` (Freebuff).
- Every SDD role (brainstorm, adversarial pass, architecture, specification, plan,
  tests, implementation, verification, independent review, documentation) is performed
  by the session model as a distinct pass; the fresh-context review is a deliberate
  self-review per the SDD single-model rule. No other model was invoked.

## Stage status

| Stage | Status | Evidence or next action |
| --- | --- | --- |
| 0 Worktree | Done | Clean worktree + `feature/f18-e2e-tests` branch created from main; `pnpm install` green. |
| 1 Brainstorm | Done (ephemeral) | Primary + adversarial passes completed; feasibility spikes run (see below); no brainstorm file retained. |
| 2 Architecture | Done | F18 section added to `docs/architecture.md` (123 lines). |
| 3 Specification | Done | `docs/specs/f18-e2e-tests.md` written. |
| 4 Human review gate | Approved | User approved the F18 specification and architecture. |
| 5 Plan | Done | `docs/plans/f18-e2e-tests.md` written. |
| 6 Tests first | Done | Integration, browser, and regression tests authored before final implementation. |
| 7 Implementation | Done | Permission, editor, CLI packaging, query-DNR, and activation wiring repairs completed. |
| 8 Verification | Done | `pnpm validate` passed: 73 Vitest files / 550 tests; 15 Playwright passes, 3 gated skips; build/typecheck/artifact checks passed. |
| 9 Independent review | Done | Fresh-context diff review found and corrected stale expectations, formatting, and documentation drift. |
| 10 Documentation | Done | Workflow, specification status, architecture, and README synchronized. |
| 11 Release | Ready | Worktree audited; commit/merge remains user-authorized work only. |

## Stage 1 findings (synthesized)

Feasibility was proven with real spikes in the worktree (scripts under `spike-*.mjs`,
ephemeral, to be removed before release):

1. The real built extension loads and runs in headless Chromium
   (`channel: "chromium"`, `--disable-extensions-except`, `--load-extension`); the
   service worker, extension page, and editor all mount.
2. The extension lifecycle (import, review, statuses, badge, activation, switch, export,
   remove) works end-to-end in the real browser.
3. The Chrome optional-host-permission prompt is un-automatable: `chrome.permissions.request`
   never resolves when a prompt is required (headless and headed); pre-seeding
   `granted_permissions` in the profile is rejected (Secure Preferences MAC);
   `--enable-automation` does not help; Playwright upstream issue #32755 documents the
   gap. The spec therefore treats the grant click as a manual check and proves the
   permission flow at the injected-adapter seam.
4. Real DNR accepts the extension's translated redirect rule shape.
5. `pnpm pack` of all `@rogatio/*` packages + `npm install --offline` produces a working
   installed `rogatio` binary after repairs.

The spikes surfaced real product defects, all folded into the F18 scope as repairs with
regression tests:

- Bare origin patterns rejected by `chrome.permissions` (`chrome.ts`).
- User gesture lost across the service-worker message round trip (`extension-page-entry.ts`,
  `service-worker.ts`).
- Editor `normalizeExtensions` threw when hosts re-registered built-in rule types
  (`editor.ts`).
- Packed CLI binary missing shebang + POSIX-only `isDist` check (`cli/src/index.ts`).
- Enabled+granted redirect/query rules were never installed into DNR
  (`service-worker.ts`).

Repairs were applied and regression-tested; the temporary spike files were removed before
validation. The optional permission prompt remains a documented manual boundary.

## Adversarial pass

Attacked the proposal for false-green tests, flakiness, port/path/platform issues, and
supply-chain risk. Outcomes incorporated: re-acquire service workers on restart; random
ports; cross-platform `process.execPath` spawning; no registry interaction in packaged
install; extension id derived from the path at runtime; grant flow never fake-greened;
explicit manual-check boundary; no new dependencies; deterministic assertions.

## Verification evidence

- `pnpm validate` passed on 2026-08-26.
- `pnpm test:browser` passed independently: 15 passed, 3 F17 capability-gated skips.
- Packaged CLI and CLI edit HTTP integration tests passed independently.

## Verification policy (canonical)

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:browser
pnpm validate
```