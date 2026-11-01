# Workspace group enable — workflow log

Audience: agent

## Context

- Worktree: `/home/drmaas/Projects/github/drmaas/rogatio-workspace-group-enable`
- Branch: `feature/workspace-group-enable`
- Base: `9e79f9c` (main)

## Model selection

| Role | Choice | Rationale |
| --- | --- | --- |
| reasoning | parent / inherit | claude-fable usage-capped; primary pass in-session |
| adversarial | `cursor-grok-4.6-high-fast` | Different family; gpt/claude capped |
| plan | inherit | Bounded host-only change |
| coding | inherit | Same |
| verify | inherit | Same |
| review | `cursor-grok-4.6-high-fast` (locked) | Different family from coding |
| docs | inherit | Same |

## Stage checklist

- [x] 0 Worktree
- [x] 1 Brainstorm + adversarial (Q1/Q2 → recommendations)
- [x] 2 Architecture note + plan
- [x] 3 Tests first
- [x] 4 Implementation
- [x] 5 Verification (`pnpm validate` exit 0; 909 unit + 53 browser)
- [x] 6 Review (round 1 fixes + round 2 active-project remount guard; closed)
- [x] 7 Docs (`docs/architecture.md` sidebar order + dirty soft-refresh)
- [ ] 8 Release gate

## Review rounds

### Round 1
- Finding: `checkNativeAISupport` remounted during dirty soft-refresh → fixed (no `renderShell` in helper).
- Finding: refresh failure ignored `remountEditor: false` → fixed.
- Finding: dirty test missed started runtime → strengthened.

### Round 2
- Finding: soft-patch across active-project change could save draft to wrong project → force `renderShell` when active id changes.

## Verification evidence

- `pnpm validate` — success after review fixes (format, lint, typecheck, build, vitest 909, browser 53 passed / 4 skipped)
- Unit: `packages/extension/test/workspace-enablement-refresh.test.ts`
- Browser: design-system activation order + dirty toggle with runtime started

## Decisions locked

- Promote sidebar Group activation; no editor API; keep save-clears-enablement.
- Dirty editor → soft chrome refresh (no remount).
