# Phase 4 — Plan review (agent + human)

Goal: a fresh-context subagent reviews `plan.md` and `checklist.md` as a senior engineer, revises them, then the user reviews the agent's self-revisions.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Plan review row).

Prompt template: `templates/plan-review-prompt.md`.

The subagent must:

- Read `docs/decisions/<feature>/plan.md`, `docs/decisions/<feature>/checklist.md`, and `docs/decisions/<feature>/research.md`. No other context.
- Review as a senior engineer. Look for: missing acceptance criteria, phases that are too large, scope creep, weak architecture rationale, missing edge cases, test gaps, over-engineering, missing risk callouts.
- Decide the feature's implementation strategy. Default is **TDD**. Flip to **Code first** only when the feature genuinely cannot be tested first (UI without harness, doc-only change, generated code with no test layer). Write the chosen value into `plan.md` under `## Implementation strategy`. If you flip to Code first, include a one-line justification on the same line. If you keep TDD, write just `TDD` with no justification.
- Edit both files in place. Do not create a separate review file.
- Self-review once.
- Return a numbered list of issues found, which were fixed, and which were left for the user to decide. Include the chosen strategy in the summary.

## Human gate

Follow `human-gates.md`. Print the agent's numbered list, the list of files touched, the self-revisions applied, and the chosen implementation strategy (read from `plan.md` `## Implementation strategy`). The user can override by editing `plan.md` before clicking Approved, or by selecting **Revise** and naming the desired strategy. Then `question` with options:

- Approved
- Revise
- Ignore points
- Abort

## Exit conditions

- The user replied Approved.
- Both `plan.md` and `checklist.md` are stable.
- `plan.md` `## Implementation strategy` is set to either `TDD` or `Code first` (with justification if Code first).

Move to `phases/05-implement.md`.
