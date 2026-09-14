# Phase 7 — Implementation review (agent + human)

Goal: a fresh-context subagent reviews the implementation of the just-completed phase against `plan.md`, revises where the agent is confident, then the user reviews.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: generalPurpose` (or `general-purpose` if that is the harness name). Select the model for role `review` via `../shared/models.md` (phase → role → active tier). For **cursor**, pass `model: <slug>` (primary → alt → cross-pool); for other tiers, prefix the prompt with `[model: <id>]`.

Prompt template: `templates/implement-review-prompt.md`.

The subagent must:

- Read `docs/decisions/<feature>/plan.md`, `docs/decisions/<feature>/checklist.md`, and `docs/decisions/<feature>/research.md`.
- Read `## Implementation strategy` from `plan.md`. Verify the implementation actually followed it. TDD means tests exist for every acceptance criterion in the phase and were written before or alongside the production change with at least one recorded red state in the implementer's summary. Code first means tests exist for every acceptance criterion. Flag mismatches.
- Run `git diff <base-branch>..HEAD -- <files touched in the current phase>` to see the actual changes.
- Run the repository's canonical validation command.
- Review the diff as a senior engineer. Look for: type errors, missing tests, edge cases the plan called out that were missed, scope creep, off-plan refactors, dead code, leaked secrets or local settings.
- Fix the issues it finds. Edit files in place. Do not create a separate review file.
- Update `checklist.md` if it discovers tasks that were claimed complete but are not.
- Self-review once.
- Return a numbered list of issues found, which were fixed, and any it could not fix safely.

## Human gate

Follow `human-gates.md`. Print the **implementation** phase summary (checklist phase, what was built, tests, verify result, files touched) plus the agent's numbered list. By default, do not print the full diff. The user can request it. Then `question` with options:

- Approved
- Revise
- Ignore points
- Abort

## Exit conditions

- The user replied Approved.
- The implementation matches the plan for the current phase.

Move to `phases/08-commit.md`.
