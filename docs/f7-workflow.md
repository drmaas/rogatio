# F7 Workflow Log

## Scope and Preflight

- **Feature:** F7 - Chrome MV3 extension shell
- **Base commit:** `bb23854` (`feat(f8): add @rogatio/cli with edit and verify commands (#7)`); F7 was rebased onto `origin/main` before this review-fix pass.
- **Branch:** `feature/f7-extension-shell`
- **Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-f7`
- **Workflow:** SDD
- **Selected tier:** Normal
- **Model policy:** The user requested the Freebuff session model, `openai/gpt-5.6-luna`, for every role. This was recorded as the explicit session-model fallback for all SDD passes; catalog availability was checked with `opencode models`.
- **Implementation authorization:** The user's request to use SDD to implement F7, plus approval of the revised specification, authorizes implementation within the approved F7 scope.
- **Release authorization:** Not granted. Commit, push, PR, merge, and cleanup remain pending explicit user approval.
- **Implementation status:** Complete in the feature worktree; generated build and browser artifacts remain local-only.

## Stage Status

- [x] Stage 0 - isolated worktree and model availability preflight
- [x] Stage 1 - primary and adversarial brainstorming; raw outputs remain ephemeral
- [x] Stage 2 - architecture synthesis and durable architecture update
- [x] Stage 3 - F7 specification written
- [x] Stage 4 - human review gate approved after scope revision
- [x] Stage 5 - implementation plan written
- [x] Stage 6 - tests first; focused F7 suite ran red with five missing production modules
- [x] Stage 7 - implementation
- [x] Stage 8 - verification and canonical validation
- [x] Stage 9 - fresh-context review
- [x] Stage 10 - documentation completion
- [ ] Stage 11 - release actions pending user authorization

## Brainstorm and Adversarial Synthesis

The primary pass identified the extension as a downstream Chrome boundary over F4/F5: service-worker-owned persistence and browser APIs, extension-page editor hosting, explicit switch semantics, least-privilege permissions, actionless matcher projection without browser mutation, and stable status/badge projection. The adversarial pass challenged loading F2/F3 Node/Ajv artifacts under MV3 CSP, broad permission requests, accidental switch-on-selection, duplicated F4 lifecycle logic, DNR numeric-ID determinism, malformed Chrome API values, conflict loss, and scope creep into later rule actions or runtimes.

## Architecture Decisions

- `@rogatio/extension` is private and depends downstream on F4/F5 plus their browser-neutral upstream packages.
- Chrome API access is isolated in narrow adapters injected into F4 repository/install seams.
- MV3 outputs are bundled browser artifacts; Node globals and the runtime-compiled Ajv entry are forbidden.
- F7 translates only the existing common matcher operation. Action-specific operations remain deferred.
- Project selection is local pending UI state. Only explicit Switch invokes F4 project switching.
- Permission review/grant and group activation are separate explicit workflows.
- The `[Rogatio]` DevTools Console record is explicitly deferred from F7 by user-approved scope revision and is not implemented or tested here.

## Approval Record

- **Initial review:** User requested revision.
- **Revision 1:** Defer the DevTools Console record entirely from F7.
- **Approval 1:** User approved the revised specification and explicit deferral; implementation planning began.
- **Revision 2:** User chose to defer DNR installation for actionless F3 matcher operations rather than invent a browser-affecting action.
- **Approval 2:** User approved the revised behavior: actionless matcher projection only, `unsupported` status for enabled rules, and no DNR installation until later action slices.

## Verification Evidence

Tests-first evidence: after `pnpm install --frozen-lockfile --ignore-scripts`, the focused command `pnpm exec vitest run --config vitest.config.ts` from `packages/extension` executed five suites and failed as expected because `src/extension-page.js`, `src/permissions.js`, `src/projection.js`, `src/protocol.js`, and `src/service-worker.js` did not yet exist. The initial root-invocation attempt was corrected because Vitest resolved its root from the repository checkout and matched no package tests.

Final verification completed in the feature worktree:

- `pnpm exec vitest run --config vitest.config.ts` from `packages/extension`: 6 files and 15 tests passed after the final regression additions.
- `pnpm format:check`: passed.
- `pnpm lint`: passed with no warnings.
- `pnpm exec tsc --noEmit --pretty false`: passed.
- `pnpm build`: emitted 10 ESM artifacts and copied the MV3 manifest/page.
- `pnpm validate`: passed all format, lint, typecheck, build, 21 Vitest files / 155 tests, emitted-module checks, dependency-boundary checks, negative fixtures, and 13 Chromium tests.
- `pnpm test:browser`: passed all 13 Chromium tests independently.

The MV3 artifact scan found no Node globals, dynamic evaluation, Ajv runtime compiler, or package imports in the service-worker and extension-page bundles. The fresh-context review also added regression coverage for undeclared permission rejection, separate group activation, F4 status/badge reuse, and permission-summary reset on active-project changes.

After rebasing F7 onto `origin/main` at `bb23854` (F8), the review-fix pass added browser-validator parity for backslash origins and duplicate collections, null-prototype protocol snapshots, and removal of caller-supplied status inputs. The focused F7 suite then passed 7 files / 22 tests, and the extension package typecheck passed. Root `pnpm validate` passed formatting and linting but stops at the F8 CLI's existing unresolved workspace imports and implicit-any errors in `packages/cli/src/server/routes.ts`; no F7 validation failure was reached or observed in that post-rebase run.

## Review Rounds

One fresh-context review round completed. It found and corrected stale F4 status/badge duplication, Chrome permission-to-storage synchronization, stale permission-summary UI state after switching, and missing service-worker regression coverage. A subsequent independent staged-change review corrected Chrome-storage mutation serialization, empty-project badge clearing, state status projection/rendering, conflict payload preservation, message-failure rendering, permission-review revision freshness, browser-validator strictness, matcher-projection validation, and the README’s stale extension status. The post-rebase independent review additionally corrected F2 browser-validator parity and protocol/status-input trust boundaries. No unresolved F7 findings remain within the approved scope; the combined root validation remains blocked by the inherited F8 CLI typecheck defects.

## Release State

No commit, push, PR, merge, or worktree cleanup has been authorized or performed.
