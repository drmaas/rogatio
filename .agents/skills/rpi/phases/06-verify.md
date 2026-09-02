# Phase 6 — Verify (per iteration)

Goal: close the loop after each implementation iteration so the implementation reviewer always sees a green tree. The verify subagent runs the repository's validation pipeline and fixes mechanical failures in place.

This phase repeats for every phase in `CHECKLIST.md`, immediately after `phases/05-implement.md` and before `phases/07-implement-review.md`.

## Subagent prompt

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Verify row).

Prompt template: `templates/verify-prompt.md`, parameterized with the current phase identifier (e.g. "Phase 1" or "Phase 2").

The subagent must:

- Read `docs/rpi/<feature>/PLAN.md`, `docs/rpi/<feature>/CHECKLIST.md`, and `docs/rpi/<feature>/RESEARCH.md`. No other context.
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
- Do not amend `PLAN.md` or `CHECKLIST.md`.

## Human gate

No human gate. Verify is mechanical; the implementation-review gate that follows it is where the user sees findings.

## Exit conditions

- The full validation chain (format, lint, typecheck, tests) passes.
- The subagent returned its summary.
- No behavior changes were introduced.

Move to `phases/07-implement-review.md`.
