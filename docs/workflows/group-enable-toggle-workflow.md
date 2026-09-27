> Status: frozen 2026-09-27

# Group enable toggle workflow

Audience: agent

## Stage checklist

- [x] Stage 0 — worktree `feature/group-enable-toggle` at `/home/drmaas/Projects/github/drmaas/temp/rogatio-group-enable-toggle`, base `1cda80f` (`main`).
- [x] Stage 1 — brainstorm. User approved the heading-button recommendation before implementation.
- [x] Stage 2 — plan and notes recorded in this folder.
- [x] Stage 3 — tests written with the implementation.
- [x] Stage 4 — implementation.
- [x] Stage 5 — `pnpm validate` exit 0 after review fixes. Unit tests 1058 passed. Browser tests 55 passed, 8 skipped.
- [x] Stage 6 — fresh review, `grok-4.7-high-fast`, three rounds. Round 3: no actionable findings.
- [x] Stage 7 — living docs updated.
- [ ] Stage 8 — release gate. No commit until the user asks.

## Model lock

- reasoning: in-thread synthesis. Fit: bounded UI. Complexity: one editor port. Constraint: harness allowlist. Chosen: orchestrator.
- adversarial / review: different family from the author. Chosen for Stage 6: `grok-4.7-high-fast`.
- plan / coding / docs: `composer-2.5-fast` via the orchestrator.
- verify: repository `pnpm validate`, not a model report.

## Review

Round 1 (`grok-4.7-high-fast`) found: drop `aria-pressed`; fix popup contrast and forced colors; failure copy must follow enable vs disable; do not send an unsaved group id; scope the status pill to the summary; update quick start. Applied.

Round 2 found: index-based saved ids break after copy; popup still set `aria-pressed`. Applied. Saved id is a `WeakMap` from the live draft group object. Copied groups have no button until save.

Round 3: no actionable findings.

`pnpm validate` exit 0 after round 2 fixes (2026-09-27).

## Adversarial notes applied before coding

- Dirty refresh must not remount, or the heading button disappears and the route resets. Decision: `shouldRemountEditorAfterGroupEnablement()` returns false.
- CLI must not grow a browser-only control. Decision: optional port.
- Popup status text such as Disabled must not be the button label. Decision: separate `[data-group-status]` pill.
- Do not rename runtime activation or the `set-group-enabled` command.
