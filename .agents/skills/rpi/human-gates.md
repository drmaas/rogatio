# Human review gates

After every agent review phase, the skill pauses and surfaces both (1) a **phase content summary** of the work under review and (2) the agent's review findings. The user only decides once the agent has self-revised the artifact.

## Where the gates fire

- After research review (phase 2 in `phases/02-research-review.md`).
- After plan review (phase 5 in `phases/04-plan-review.md`). The plan-review gate also surfaces the agent-chosen implementation strategy (TDD or Code first) read from `plan.md` `## Implementation strategy`. The user can override by editing `plan.md` before clicking Approved, or by selecting **Revise** and naming the desired strategy.
- After each implementation review (phase 8 in `phases/07-implement-review.md`).
- After final review (phase 10 in `phases/09-final-review.md`).
- After refactor candidate write-up when the user opted in (`phases/10-refactor.md`).

The commit step is also a gate (phase 9 in `phases/08-commit.md`), but it asks a different question (see that file).

## Gate behavior

1. In the main thread, the skill prints a structured gate packet. Format:

   ```
   === Human gate: <phase name> ===

   ## Phase summary
   <gate-specific content summary — see below; composed in the main thread from artifacts / git, not invented>

   ## Agent review
   Agent summary: <one-paragraph or numbered findings from the review subagent>
   Agent-edited files: <list, with line counts>
   Self-revisions applied: <list of changes the agent already made>
   Implementation strategy: <TDD or Code first — only on the plan-review gate>

   === end gate ===
   ```

2. The **Phase summary** is mandatory and gate-specific. The skill reads the current artifacts (and git when needed) and writes a short human-readable digest. Do not paste the full artifact or a raw dump unless the user asks for detail. Aim for roughly half a screen to one screen.

### Research-review gate

Compose from `docs/decisions/<feature>/research.md`:

- Problem restatement (1–2 sentences).
- Top codebase findings (bullets; paths when useful).
- Constraints / invariants.
- Open questions left for planning.
- Artifact path.

### Plan-review gate

Compose from `plan.md` + `checklist.md`:

- Chosen approach (1–2 sentences).
- Implementation strategy (TDD / Code first + reason if Code first).
- Phase list with one-line intent each (from checklist).
- Acceptance criteria overview (IDs or short bullets).
- Risks / deferred items called out in the plan.
- Artifact paths.

### Implementation-review gate (per checklist phase)

Compose from implementer + verify summaries, checklist progress, and `git` for this phase:

- Checklist phase id / title and what was marked done.
- What was built (behavior, not file laundry list).
- Tests added/updated and whether TDD/Code-first matched `plan.md`.
- Verify result (green / remaining failures).
- Files touched (paths only; line counts optional).
- Anything skipped or deferred.

### Final-review gate

Compose from plan + checklist + branch diff vs base:

- Outcome vs plan (what landed, what did not).
- Checklist completion state.
- High-level change set (packages/areas touched; file count).
- Remaining risks or follow-ups from the reviewer.
- Do not paste the full diff by default.

### Refactor gate (opt-in)

Compose from `refactor.md`:

- Numbered candidate list (title + one-line why each).
- Which are in-scope vs stretch.
- Artifact path.

3. By default, the skill does not dump the full artifact or full diff. If the user wants detail, follow [Diff on demand](#diff-on-demand).

4. The skill then calls `question` with options:

   - **Approved** — proceed to the next phase.
   - **Revise** — user provides notes; the skill returns to the same review subagent with the notes.
   - **Ignore points** — user lists specific findings to disregard; the skill returns to the subagent with both the user's notes and the ignore list.
   - **Abort** — stop the workflow; record the abort reason in conversation state.

5. The skill records the user's reply and the resulting action in conversation state. The skill does not write a workflow log file by default; if the user wants one, it goes under `docs/decisions/<feature>/workflow.md`.

## Diff on demand

When the user requests detail, the skill prints:

- For markdown artifacts: the unified diff of the artifact since the user's last approval of that artifact, or the full current artifact if shorter and clearer.
- For implementation / final reviews: `git diff <base-branch>..HEAD` for files in scope, capped at 1000 lines.

The skill never edits an artifact at a human gate. Edits are delegated to the next subagent invocation.

## Termination

The loop terminates only when the user replies **Approved**. The skill does not auto-advance on agent self-declaration of "no issues found" — the user has the final say.
