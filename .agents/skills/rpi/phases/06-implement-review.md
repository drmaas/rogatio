# Phase 6 — Implementation review (agent + human)

Goal: a fresh-context subagent reviews the implementation of the just-completed phase against `PLAN.md`, revises where the agent is confident, then the user reviews.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Implementation review row).

Prompt template: `templates/implement-review-prompt.md`.

The subagent must:

- Read `docs/rpi/<feature>/PLAN.md`, `docs/rpi/<feature>/CHECKLIST.md`, and `docs/rpi/<feature>/RESEARCH.md`.
- Run `git diff <base-branch>..HEAD -- <files touched in the current phase>` to see the actual changes.
- Run the repository's canonical validation command.
- Review the diff as a senior engineer. Look for: type errors, missing tests, edge cases the plan called out that were missed, scope creep, off-plan refactors, dead code, leaked secrets or local settings.
- Fix the issues it finds. Edit files in place. Do not create a separate review file.
- Update `CHECKLIST.md` if it discovers tasks that were claimed complete but are not.
- Self-review once.
- Return a numbered list of issues found, which were fixed, and any it could not fix safely.

## Human gate

Follow `human-gates.md`. Print the agent's numbered list and the list of files touched. By default, do not print the full diff. The user can request it. Then `question` with options:

- Approved
- Revise
- Ignore points
- Abort

## Exit conditions

- The user replied Approved.
- The implementation matches the plan for the current phase.

Move to `phases/07-commit.md`.
