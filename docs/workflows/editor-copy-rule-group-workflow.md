> Status: frozen 2026-09-20

# Editor copy rule / copy group — workflow log

Audience: agent  
Issue: #196  
Workflow: doit

## Stage checklist

| Stage | Status |
| --- | --- |
| 0 Worktree | done — `~/Projects/github/drmaas/rogatio-editor-copy-rule-group`, `feature/editor-copy-rule-group`, base `a12f4b2` |
| 1 Brainstorm + adversarial | done — recommendations locked by user |
| 2 Architecture + plan | done — this folder |
| 3 Tests first | done — `packages/editor/test/copy.test.ts` |
| 4 Implementation | done — `copyRule`/`copyGroup` + UI + commands |
| 5 Verify | done — `pnpm validate` exit 0 (945 unit, 54 browser) |
| 6 Fresh review | done — REVIEW PASSED (optional test/docs nits addressed) |
| 7 Docs | done — architecture + overview + docs-site editor guide |
| 8 Freeze / release | pending |

## Model lock

| Role | Model | Rationale |
| --- | --- | --- |
| reasoning / plan / coding / verify / docs | `inherit` | Claude/GPT quota exhausted; parent Composer |
| adversarial / review | `cursor-grok-4.6-high-fast` | Different family from authoring |

## Notes

- Graphify absent; recommend install later; did not block.
- No formal spec (doit). Durable: notes.md, plan.md, workflow.md.
- Browser Chrome for Testing installed locally via `pnpm browser:install` for validate.

## Review round 1

- Result: REVIEW PASSED
- Optional: add validate/save after copy; update overview/docs-site copy inventory — addressed in Stage 7 follow-up
