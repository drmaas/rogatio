# Human review gates

After every agent review phase, the skill pauses and surfaces the agent's findings to the user. The user only reads once the agent has self-revised the artifact.

## Where the gates fire

- After research review (phase 2 in `phases/02-research-review.md`).
- After plan review (phase 5 in `phases/04-plan-review.md`). The plan-review gate also surfaces the agent-chosen implementation strategy (TDD or Code first) read from `PLAN.md` `## Implementation strategy`. The user can override by editing `PLAN.md` before clicking Approved, or by selecting **Revise** and naming the desired strategy.
- After each implementation review (phase 8 in `phases/07-implement-review.md`).
- After final review (phase 10 in `phases/09-final-review.md`).

The commit step is also a gate (phase 9 in `phases/08-commit.md`), but it asks a different question.

## Gate behavior

1. The skill prints the agent's summary in the main thread. Format:

   ```
   === Human gate: <phase name> ===
   Agent summary: <one-paragraph summary>
   Agent-edited files: <list, with line counts>
   Self-revisions applied: <list of changes the agent already made>
   Implementation strategy: <TDD or Code first — only on the plan-review gate>
   === end gate ===
   ```

   On the plan-review gate, the `Implementation strategy` line shows the value from `PLAN.md` `## Implementation strategy`. The user may override by editing `PLAN.md` before clicking Approved, or by selecting **Revise** and naming the desired strategy.

2. By default, the skill does not dump the full diff. If the user wants detail, the skill prints the diff on demand.

3. The skill then calls `question` with options:

   - **Approved** — proceed to the next phase.
   - **Revise** — user provides notes; the skill returns to the same review subagent with the notes.
   - **Ignore points** — user lists specific findings to disregard; the skill returns to the subagent with both the user's notes and the ignore list.
   - **Abort** — stop the workflow; record the abort reason in conversation state.

4. The skill records the user's reply and the resulting action in conversation state. The skill does not write a workflow log file by default; if the user wants one, it goes under `docs/rpi/<feature>/workflow.md`.

## Diff on demand

When the user requests detail, the skill prints:

- For markdown artifacts: the unified diff of the artifact since the user's last approval of that artifact.
- For implementation reviews: `git diff <base-branch>..HEAD` for files touched in the reviewed phase, capped at 1000 lines.

The skill never edits an artifact at a human gate. Edits are delegated to the next subagent invocation.

## Termination

The loop terminates only when the user replies **Approved**. The skill does not auto-advance on agent self-declaration of "no issues found" — the user has the final say.
