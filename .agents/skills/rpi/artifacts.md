# Artifact convention

All RPI artifacts live under `docs/decisions/<feature>/` — the same active tree as SDD and doit. Filenames are lowercase.

## Path layout

```
docs/decisions/<feature>/
  research.md     # produced in step 2
  plan.md         # produced in step 4
  checklist.md    # produced in step 4, updated throughout step 6
  refactor.md     # produced in step 11 (only if user opts in)
  workflow.md     # optional human-requested log
```

`<feature>` is a kebab-case slug, lowercased, no spaces, no leading or trailing dashes. Examples: `f5-editor`, `runtime-command-gating`, `csv-export-v2`.

If the directory does not exist, the subagent must create it before writing. Never write outside the feature directory. Never use `docs/rpi/`.

## research.md

Captures what the model found in the codebase or in web research. Sections:

- **Problem restatement** — verbatim from the user's request.
- **Codebase findings** — file paths, function signatures, current behavior, edge cases.
- **External findings** (greenfield only) — libraries considered, tradeoffs, citations.
- **Constraints and invariants** — non-negotiables discovered in the code or stated by the user.
- **Open questions** — anything the plan needs to resolve.

Update protocol: the research-review subagent edits `research.md` in place. The human gate does not edit the file; it approves or requests revisions.

On release: move to `docs/research/<feature>.md` and freeze.

## plan.md

Captures the implementation plan. Sections:

- **Implementation strategy** — `TDD` (default) or `Code first` with one-line justification. Set by the plan-review subagent; the user may override before approving.
- **Goal** — one paragraph.
- **Non-goals** — what the change explicitly does not do.
- **Architecture** — design choices and rationale.
- **Phases** — ordered list. Each phase has a one-paragraph description and points to a checklist range in `checklist.md`.
- **Risks** — known unknowns, edge cases, performance/security concerns.
- **Acceptance criteria** — observable conditions that must hold when the work is done.

On release: move to `docs/plans/<feature>.md` and freeze.

## checklist.md

Implementation tracker. Markdown checklist with phases and tasks. Example:

```
- [ ] Phase 1: <name>
  - [ ] Task 1.1
  - [ ] Task 1.2
- [ ] Phase 2: <name>
  - [ ] Task 2.1
```

Update protocol: the implementer subagent checks off tasks as they complete. The implementation-review subagent reads the checklist to see what was actually done.

The plan-review subagent writes the initial checklist when it writes `plan.md`.

On release: **delete** (not durable).

## refactor.md

Only created if the user opts into step 11. Sections:

- **Candidate** — what to refactor and why.
- **Expected benefit** — what improves.
- **Risk** — what could break.
- **Scope** — files, functions, behavior boundaries.
- **Test plan** — how to verify the refactor preserves behavior.

The refactor subagent writes the file. The user reviews the candidates and approves the ones worth pursuing. The user, not the agent, decides which candidates are in scope.

On release: move to `docs/plans/<feature>-refactor.md` and freeze.

## File hygiene

- Never commit artifacts automatically. The user reviews and commits them as part of a phase commit.
- Never delete artifacts during an active feature without asking. If a phase is abandoned, leave the file in place with a "ABANDONED — superseded by `<new feature>`" note at the top. On release, `checklist.md` is intentionally deleted as part of freeze.
- Never reference artifacts from outside the feature directory by hardcoded path. Use the slug.
