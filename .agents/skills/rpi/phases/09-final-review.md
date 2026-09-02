# Phase 9 — Final review (agent + human)

Goal: a fresh-context subagent reviews the cumulative changes on the branch as a senior engineer, fixes what it can, then the user reviews.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Final review row).

Prompt template: `templates/final-review-prompt.md`.

The subagent must:

- Read `docs/rpi/<feature>/PLAN.md`, `docs/rpi/<feature>/CHECKLIST.md`, and `docs/rpi/<feature>/RESEARCH.md`.
- Run `git diff <base-branch>..HEAD` to see every change on the branch.
- Run the repository's canonical validation command.
- Review the cumulative diff as a senior engineer. Look for: issues that only emerge when the pieces come together, inconsistencies between phases, missed acceptance criteria, scope drift, over-engineering that snuck in across phases, missing or weak tests.
- Fix what it can. Edit files in place. Do not create a separate review file.
- Self-review once.
- Return a numbered list of issues found, which were fixed, and any it could not fix safely.

## Human gate

Follow `human-gates.md`. Print the agent's numbered list and the file count changed since the start of the workflow. By default, do not print the full diff. Then `question` with options:

- Approved
- Revise
- Ignore points
- Abort

## Exit conditions

- The user replied Approved.
- All `CHECKLIST.md` items are complete or explicitly deferred.

Move to `phases/10-refactor.md` (which always begins with the opt-in question).
