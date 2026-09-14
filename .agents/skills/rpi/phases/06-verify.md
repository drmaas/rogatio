# Phase 6 — Verify (per iteration)

Goal: close the loop after each implementation iteration so the implementation reviewer always sees a green tree. The verify subagent runs the repository's validation pipeline and fixes mechanical failures in place.

This phase repeats for every phase in `checklist.md`, immediately after `phases/05-implement.md` and before `phases/07-implement-review.md`.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: generalPurpose` (or `general-purpose` if that is the harness name). Select the model for role `verify` via `../shared/models.md` (phase → role → active tier). For **cursor**, pass `model: <slug>` (primary → alt → cross-pool); for other tiers, prefix the prompt with `[model: <id>]`.

Prompt template: `templates/verify-prompt.md`, parameterized with the current phase identifier (e.g. "Phase 1" or "Phase 2").

The subagent must:

- Read `docs/decisions/<feature>/plan.md`, `docs/decisions/<feature>/checklist.md`, and `docs/decisions/<feature>/research.md`. No other context.
- Run the repository's canonical validation command (look it up in `package.json` or `AGENTS.md`).
- Run the validation steps in this order: format → lint → typecheck → unit tests. If a step fails, stop the chain and fix the failures from that step before proceeding.
- Edit files in place to fix mechanical failures: formatting, lint (including lint suppressions only when the rule is wrong), type errors that have no semantic change, and test fixture or assertion tweaks that do not weaken the test.
- Re-run validation until the full chain passes.
- Self-review once. Confirm no behavior changed.
- Return a one-paragraph summary: which steps ran, what was fixed, the final validation result, and any failures that could not be safely fixed without changing behavior.

## Scope discipline

- The verifier may not change behavior. Production logic changes belong in the implement phase.
- If a test failure implies a production bug, stop and report. Do not paper over it.
- Do not start the next implementation phase.
- Do not amend `plan.md` or `checklist.md`.

## Human gate

No human gate. Verify is mechanical; the implementation-review gate that follows it is where the user sees findings.

## Exit conditions

- The full validation chain (format, lint, typecheck, tests) passes.
- The subagent returned its summary.
- No behavior changes were introduced.

Move to `phases/07-implement-review.md`.
