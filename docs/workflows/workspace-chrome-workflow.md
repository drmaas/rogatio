> Status: frozen 2026-10-03

# Workspace chrome — workflow log

> Audience: agent
> Issue: #280

## Context

- Worktree: `/home/drmaas/Projects/github/drmaas/rogatio-workspace-chrome`
- Branch: `feature/workspace-chrome`
- Base: `452384322012a525441863f9f5d970a28d3ecfc0` (`main`)
- Graph: absent in the main checkout. Not built in this worktree.

## Model selection

| Role | Choice | Rationale |
| --- | --- | --- |
| reasoning | inherit | Spec written from the approved plan |
| adversarial | skipped | Plan gate already approved the interaction; no separate pass |
| plan | inherit | The approved plan is the implementation plan |
| coding | inherit | Same session implements tests and code |
| verify | inherit | Canonical `pnpm validate` |
| review | fresh generalPurpose, different family each round | Round 1 claude-sonnet, round 2 gpt, round 3 gemini |
| docs | inherit | Living docs in the same change |

## Stage checklist

- [x] Stage 0 — worktree
- [x] Stage 1 — brainstorm (folded into the approved plan)
- [x] Stage 2 — architecture (editor owns the breadcrumb and picker; extension owns lifecycle actions and the badge)
- [x] Stage 3 — specification
- [x] Stage 4 — human gate (plan approval, 2026-10-03)
- [x] Stage 5 — plan file (the approved plan stands; no second plan file)
- [x] Stage 6 — tests
- [x] Stage 7 — implementation
- [x] Stage 8 — verification
- [x] Stage 9 — review
- [x] Stage 10 — documentation
- [x] Stage 11 — freeze (spec and workflow moved on the feature commit; no repo plan file, the approved plan was the implementation gate)

## Decisions

- Test console sits on the command bar. It is a tool, not a group.
- Group rows open from a modal. The project page group list stays.
- Refresh, Export project, and Remove project use `EditorOptions.projectActions` so the CLI does not show them.
- Project-details Export and Remove use the active project. An unswitched dashboard selection does not redirect them.

## Verification

`pnpm validate` in this worktree, 2026-10-03, exit 0.

- Format and lint clean. Typecheck and build passed.
- Unit: 137 files, 1275 tests passed.
- Browser: 12 files passed, 3 skipped; 83 tests passed, 9 skipped.
- Expected negative typecheck fixtures (invalid type, undeclared import, forbidden direction) still fail typecheck.

## Review

Three fresh rounds. Rounds 1 and 2 had findings; those were fixed and `pnpm validate` was rerun. Round 3 had no actionable findings.

Round 1 fixed focus after a picker row, the rail sitting under the sticky top bar, dismiss-focus and picker-row tests, Test console `aria-current`, omitted and malformed `projectActions`, and two stale doc lines.

Round 2 fixed project-details Export/Remove so they follow the active project, and the viewport height chain so the workspace layout actually scrolls. Narrow widths keep the breadcrumb reachable instead of clipping it under the sidebar.

Residual, not fixed:

- The group picker sets `aria-modal` and has no tab trap, same as the existing confirm dialog.
- Host project-action buttons stay enabled while the editor is saving. The host owns those commands.
- An open picker does not refresh Enabled/Disabled if group enablement changes underneath it.
