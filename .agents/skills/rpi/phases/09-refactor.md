# Phase 9 — Refactor (opt-in)

This phase only runs if the user opts in. The skill always asks first; it never auto-runs refactoring.

## Opt-in gate

At the start of this phase, call `question` with options:

- **Yes, refactor** — proceed to the subagent prompt below.
- **No, finish** — end the workflow. No further work.

The user picks. The skill does not interpret silence as a yes.

## Subagent prompt (only if user opted in)

Spawn a fresh subagent via the `task` tool with `subagent_type: general-purpose`. Prefix the model ID from `models.md` (Refactor row).

Prompt template: `templates/refactor-prompt.md`.

The subagent must:

- Read `docs/rpi/<feature>/PLAN.md`, `docs/rpi/<feature>/CHECKLIST.md`, and `docs/rpi/<feature>/RESEARCH.md`.
- Run `git diff <base-branch>..HEAD` to see every change.
- Identify high-leverage refactoring opportunities. Look for: duplicated logic introduced across phases, awkward type signatures, ad-hoc error handling that should be unified, missed abstractions that would make the next change cheaper, patterns that diverge from the rest of the codebase.
- For each candidate, document: what to refactor, expected benefit, risk, scope, test plan.
- Do not implement. Write `docs/rpi/<feature>/REFACTOR.md` only.
- Self-review once. Reject candidates whose expected benefit is small or whose risk is high.
- Return a numbered list of candidates and a recommendation per candidate.

## Human gate after the proposal

Follow `human-gates.md`. Print the agent's numbered list of refactor candidates. Then `question` with options:

- **Approved as proposed** — proceed to implement every candidate.
- **Approve some** — user lists the candidates to implement.
- **None worth pursuing** — end the workflow without refactoring.
- **Abort** — stop.

## Implementation (only if user approved candidates)

For each approved candidate, follow the implementation loop:

1. Phase 5: implement the refactor in a fresh subagent.
2. Phase 6: implementation review.
3. Phase 7: commit (asked, never auto).

Run phases 5, 6, 7 once per approved candidate. After all candidates are done, end the workflow.

## Exit conditions

- The user opted out: workflow ends.
- The user opted in and approved candidates: refactor loop runs, then workflow ends.
- The user approved no candidates: workflow ends.
