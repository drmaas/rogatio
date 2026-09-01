# Phase 5 — Implementation (loop per phase)

Goal: execute one phase of `CHECKLIST.md`, in a fresh-context subagent, and update the checklist.

This phase repeats for every phase in `CHECKLIST.md`. Each iteration is its own fresh subagent.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Implementation row).

Prompt template: `templates/implement-prompt.md`, parameterized with the current phase identifier (e.g. "Phase 1" or "Phase 2").

The subagent must:

- Read `docs/rpi/<feature>/PLAN.md`, `docs/rpi/<feature>/CHECKLIST.md`, and `docs/rpi/<feature>/RESEARCH.md`. No other context.
- Implement only the tasks for the current phase. Do not start the next phase.
- Check off tasks in `CHECKLIST.md` as they complete. Do not delete unchecked items; the reviewer needs to see what was skipped.
- Run the repository's canonical validation command after the phase. Record the output.
- Stop and report if any acceptance criterion cannot be met. Do not invent workarounds.
- Self-review once. Catch and fix obvious issues.
- Return a one-paragraph summary: what was done, validation result, anything skipped or deferred.

## Scope discipline

- The implementer may not introduce abstractions, helpers, or configuration that the plan did not call for.
- The implementer may not start the next phase, even if it has time.
- The implementer may not amend `PLAN.md` or `CHECKLIST.md` beyond checking off its own tasks.

## Human gate

No human gate in the implementer step. The gate is in phase 6 (implementation review).

## Exit conditions

- All tasks for the current phase are checked off or explicitly deferred.
- Repository validation command passed.
- Subagent returned its summary.

Move to `phases/06-implement-review.md`.
