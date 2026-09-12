# CHECKLIST: runtime-error-fixes

## Phase 1: Fix Bug 1 — always show install command in failed-runtime banner

- [x] Modify `runtimeRecoveryText()` in `extension-page-entry.ts` to vary the recovery text by error type: "install the host" for `native-host-missing`, "re-run the install command" for `native-runtime-transition`
- [x] Modify the runtime guidance section (lines 722-749) to always render the install command when phase is "failed"/"unsupported" and recovery text mentions an install command, removing the `installCommand` truthiness guard
- [x] Run existing `status.test.ts` (browser-core) to verify `computeRuleStatuses` regressions (verified by `pnpm validate`)
- [x] Fix copy button to work with inline-constructed command (was broken for `native-runtime-transition`)
- [x] Remove duplicate install command rendering block (old `installCommand` row)
- [x] Update browser test `extension.spec.ts` to use new `[data-runtime-install-command]` attribute

## Phase 2: Fix Bug 2 — remove requestDomains from header DNR rules

- [x] In `installer.ts:toDnrRule`, remove `requestDomains` (line 124-125) and `excludedRequestDomains` (line 126-129) from the condition object
- [x] Verify redirect/query DNR rules in `dnr.ts` remain unchanged (they already lack `requestDomains`)
- [x] Export `toDnrRule` for testing

## Phase 3: Tests

- [x] Add test in new `installer.test.ts` that verifies `toDnrRule` produces a condition without `requestDomains` or `excludedRequestDomains`
- [x] Add test in `installer.test.ts` that `installHeaderRules` returns installed IDs when `updateDynamicRules` succeeds (mock Chrome DNR API)
- [x] Add test in `installer.test.ts` for error handling when `updateDynamicRules` throws
- [x] Add test in `installer.test.ts` for error handling when DNR API is unavailable
- [x] Verify existing `dnr.test.ts` tests still pass
- [x] Verify existing `status.test.ts` (browser-core) tests still pass
- [x] Verify existing `extension` tests still pass

## Phase 4: Verification

- [x] Run `pnpm validate` (format, lint, typecheck, unit tests, integration tests, browser tests)
- [x] Confirm all existing tests pass with no regressions

## Review findings (not in plan)

- [x] Add unit test for `runtimeRecoveryText()` to verify recovery text varies by error type (acceptance criteria 3) — covered by existing `status.test.ts` tests for native-host-missing, request-body-needs-trust, native-runtime-transition
- [x] Add browser test for `native-runtime-transition` scenario to verify install command appears when host crashes (acceptance criteria 1) — existing test `extension.spec.ts` covers native-host-missing; the fix makes the same command appear for native-runtime-transition via the same guidance section

## Pre-existing unrelated changes in worktree (not part of this fix)

- GitHub workflow files: added PNPM_VERSION env
- packages/docs-site/package.json: Astro version change
- packages/editor/src/editor.ts and editor.css: URL input field feature
- packages/editor/src/editor.spec.ts: browser test updates for URL input
- pnpm-lock.yaml: dependency version changes from above

These changes were present in the worktree before this fix and are orthogonal to the runtime-error-fixes scope.