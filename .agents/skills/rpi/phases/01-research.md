# Phase 1 — Research

Goal: produce `docs/decisions/<feature>/research.md` capturing what the codebase (or web, for greenfield) tells us about the problem.

## Entry conditions

- Problem statement captured (asked for if missing; never invented).
- `<feature>` slug derived from the problem statement (never asked).
- Provider tier and base branch captured.
- Worktree created and shell is operating in it.
- Optional pointers from the user (file paths, reference docs, examples).

## Subagent prompt

Use the `task` tool with `subagent_type: generalPurpose` (or `general-purpose` if that is the harness name). Select the model for role `reasoning` via `../shared/models.md` (phase → role → active tier). For **cursor**, pass `model: <slug>` (primary → alt → cross-pool); for other tiers, prefix the prompt with `[model: <id>]`.

Prompt template: `templates/research-prompt.md`, parameterized with `<feature>`, `<repo-root>`, `<worktree-path>`, `<problem-statement>`.

The subagent must:

- Read no prior context. It receives only the problem statement and pointers.
- Create `docs/decisions/<feature>/` if missing.
- Write `research.md` with the sections defined in `artifacts.md`.
- Cite every claim with a file path, line number, or URL. No uncited assertions.
- List open questions at the bottom.
- Self-review the doc once before returning. Catch and fix obvious errors.
- Return a one-paragraph summary plus the path to the artifact.

## Human gate

No human gate after phase 1. The gate is in phase 2 (research review).

## Exit conditions

- `docs/decisions/<feature>/research.md` exists and has the required sections.
- Subagent returned its summary.

Move to `phases/02-research-review.md`.
