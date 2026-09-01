# Phase 1 — Research

Goal: produce `docs/rpi/<feature>/RESEARCH.md` capturing what the codebase (or web, for greenfield) tells us about the problem.

## Entry conditions

- `<feature>` slug and provider tier captured.
- Worktree created and shell is operating in it.
- The user has supplied a problem statement and any pointers (file paths, reference docs, examples).

## Subagent prompt

Use the `task` tool with `subagent_type: general-purpose`. Prefix the prompt with the model ID from `models.md` (Research row, primary).

Prompt template: `templates/research-prompt.md`, parameterized with `<feature>`, `<repo-root>`, `<worktree-path>`, `<problem-statement>`.

The subagent must:

- Read no prior context. It receives only the problem statement and pointers.
- Create `docs/rpi/<feature>/` if missing.
- Write `RESEARCH.md` with the sections defined in `artifacts.md`.
- Cite every claim with a file path, line number, or URL. No uncited assertions.
- List open questions at the bottom.
- Self-review the doc once before returning. Catch and fix obvious errors.
- Return a one-paragraph summary plus the path to the artifact.

## Human gate

No human gate after phase 1. The gate is in phase 2 (research review).

## Exit conditions

- `docs/rpi/<feature>/RESEARCH.md` exists and has the required sections.
- Subagent returned its summary.

Move to `phases/02-research-review.md`.
