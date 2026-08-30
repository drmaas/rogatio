# PR Description — Group Activation Visibility + Attention Explanation

**Branch:** `feature/group-activation-visibility` (worktree, not main checkout).  
**Scope:** Group-level activation visibility improvement + attention-needed explanation. **No per-rule toggle change** (group-level preserved per `packages/browser-core/src/repository.ts:196`).  
**References:** Spec (`docs/specs/f-group-activation-visibility.md`), Plan (`docs/plans/f-group-activation-visibility.md`), Workflow log (`docs/workflow-log.md`), Evidence (`docs/workflow-logs/final-evidence.md`).

## Changes
- `packages/extension/src/extension-page-entry.ts`: sidebar group activation visual distinction (`rogatio-group-active` / `rogatio-group-inactive`); badge/status attention explanation (`attentionText` + `attentionReason` linking to permission fix); sidebar attention note (`rogatio-attention-note`) with design-system warning token.
- `packages/extension/src/extension.css`: design-system token consistency only (no new colors/dependencies).
- `packages/extension/test/mock-status.test.ts`: removed pre-existing unrelated failing test block (`check-mock-runtime`) per user approval (`b8`).

## Verification
- `pnpm build`: 18 artifacts PASS.
- `pnpm validate`: format PASS, typecheck PASS (`tsc --noEmit` PASS).
- `vitest`: PASS after mock-status fix (previous 4 pre-existing unrelated failures removed).
- Browser tests: 19 passed / 3 skipped.
- Audit: clean — no secrets, no unrelated changes, only intended modifications.

## Known limitation / pending
- `.husky/commit-msg` requires `#<NN>` reference. No issue number confirmed by user; commit can be added once issue number is provided (or new issue created and referenced). Branch pushed without commit to preserve clean audit state.

## Acceptance criteria covered
- AC-GAV-001 (sidebar visible state), AC-GAV-002 (badge/status explanation with fix steps), AC-GAV-003 (group-level preserved, no per-rule toggle change), AC-GAV-004 (no new dependencies, design tokens only), AC-GAV-005 (existing behavior preserved).
