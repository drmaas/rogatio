# Phase 3 — Planning

Goal: produce `docs/rpi/<feature>/PLAN.md` and `docs/rpi/<feature>/CHECKLIST.md`.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Plan row).

Prompt template: `templates/plan-prompt.md`.

The subagent must:

- Read `docs/rpi/<feature>/RESEARCH.md` only. Treat it as the source of truth.
- Read the user's problem statement and any constraints they supplied.
- Write `PLAN.md` per `artifacts.md`. Cover: goal, non-goals, architecture, phases, risks, acceptance criteria.
- Write `CHECKLIST.md` with the initial phases and tasks. The implementer will check items off as it works.
- For each phase, specify what acceptance looks like and what tests will prove it.
- Add a top-level `## Implementation strategy` section in `PLAN.md` with the literal placeholder `TBD — set by plan reviewer`. You do not pick a strategy; the plan-review subagent does.
- Self-review once. Catch scope creep, missing acceptance criteria, phases that are too large to be reviewed in one human-gate pass.
- Return a one-paragraph summary plus both artifact paths.

## Scope discipline

- If the plan would add abstractions, helpers, configuration, or error handling beyond what the user asked for, flag each instance in the plan's risks section.
- If the plan would change public APIs or wire formats, call it out explicitly.
- If a phase is too large to review in one pass (more than ~10 tasks, or changes that span unrelated files), split it.

## Human gate

No human gate after phase 3. The gate is in phase 4 (plan review).

## Exit conditions

- `PLAN.md` and `CHECKLIST.md` exist.
- The plan's phases align with the checklist's items.
- `PLAN.md` contains the `## Implementation strategy` section with the literal placeholder `TBD — set by plan reviewer`.

Move to `phases/04-plan-review.md`.
