# Phase 2 — Research review (agent + human)

Goal: a fresh-context subagent reviews `RESEARCH.md` for accuracy and completeness, revises it, then the user reviews the agent's self-revisions.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Research review row).

Prompt template: `templates/research-review-prompt.md`.

The subagent must:

- Read `docs/rpi/<feature>/RESEARCH.md` only. No other context.
- Verify every cited file path and line number still exists at those locations.
- Check that the artifact answers the user's stated problem.
- Identify missing context: error paths, edge cases, type signatures, public APIs the plan will need.
- Identify over-research: sections that are not load-bearing for the plan.
- Edit `RESEARCH.md` in place to fix issues. Do not create a separate review file.
- Self-review once. Catch and fix obvious issues in the reviewer's own edits.
- Return a one-paragraph summary of: (a) what was wrong, (b) what was fixed, (c) what was deliberately left as open questions for the plan.

## Human gate

Follow `human-gates.md`. Print the gate header, the agent's summary, the list of files touched, and the self-revisions applied. Then `question` with options:

- Approved
- Revise (user provides notes)
- Ignore points (user lists specific findings to disregard)
- Abort

## Exit conditions

- The user replied Approved.
- The next phase reads the same `RESEARCH.md`.

Move to `phases/03-plan.md`.
