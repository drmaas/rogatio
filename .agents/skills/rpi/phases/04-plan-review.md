# Phase 4 — Plan review (agent + human)

Goal: a fresh-context subagent reviews `PLAN.md` and `CHECKLIST.md` as a senior engineer, revises them, then the user reviews the agent's self-revisions.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Plan review row).

Prompt template: `templates/plan-review-prompt.md`.

The subagent must:

- Read `docs/rpi/<feature>/PLAN.md`, `docs/rpi/<feature>/CHECKLIST.md`, and `docs/rpi/<feature>/RESEARCH.md`. No other context.
- Review as a senior engineer. Look for: missing acceptance criteria, phases that are too large, scope creep, weak architecture rationale, missing edge cases, test gaps, over-engineering, missing risk callouts.
- Edit both files in place. Do not create a separate review file.
- Self-review once.
- Return a numbered list of issues found, which were fixed, and which were left for the user to decide.

## Human gate

Follow `human-gates.md`. Print the agent's numbered list, the list of files touched, and the self-revisions applied. Then `question` with options:

- Approved
- Revise
- Ignore points
- Abort

## Exit conditions

- The user replied Approved.
- Both `PLAN.md` and `CHECKLIST.md` are stable.

Move to `phases/05-implement.md`.
