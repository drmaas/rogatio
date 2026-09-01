# Artifact convention

All RPI artifacts live under `docs/rpi/<feature>/`.

## Path layout

```
docs/rpi/<feature>/
  RESEARCH.md     # produced in step 2
  PLAN.md         # produced in step 4
  CHECKLIST.md    # produced in step 4, updated throughout step 6
  REFACTOR.md     # produced in step 10 (only if user opts in)
```

`<feature>` is a kebab-case slug, lowercased, no spaces, no leading or trailing dashes. Examples: `f5-editor`, `runtime-command-gating`, `csv-export-v2`.

If the directory does not exist, the subagent must create it before writing. Never write outside the feature directory.

## RESEARCH.md

Captures what the model found in the codebase or in web research. Sections:

- **Problem restatement** — verbatim from the user's request.
- **Codebase findings** — file paths, function signatures, current behavior, edge cases.
- **External findings** (greenfield only) — libraries considered, tradeoffs, citations.
- **Constraints and invariants** — non-negotiables discovered in the code or stated by the user.
- **Open questions** — anything the plan needs to resolve.

Update protocol: the research-review subagent edits `RESEARCH.md` in place. The human gate does not edit the file; it approves or requests revisions.

## PLAN.md

Captures the implementation plan. Sections:

- **Goal** — one paragraph.
- **Non-goals** — what the change explicitly does not do.
- **Architecture** — design choices and rationale.
- **Phases** — ordered list. Each phase has a one-paragraph description and points to a checklist range in `CHECKLIST.md`.
- **Risks** — known unknowns, edge cases, performance/security concerns.
- **Acceptance criteria** — observable conditions that must hold when the work is done.

## CHECKLIST.md

Implementation tracker. Markdown checklist with phases and tasks. Example:

```
- [ ] Phase 1: <name>
  - [ ] Task 1.1
  - [ ] Task 1.2
- [ ] Phase 2: <name>
  - [ ] Task 2.1
```

Update protocol: the implementer subagent checks off tasks as it completes them. The implementation-review subagent reads the checklist to see what was actually done.

The plan-review subagent writes the initial checklist when it writes `PLAN.md`.

## REFACTOR.md

Only created if the user opts into step 10. Sections:

- **Candidate** — what to refactor and why.
- **Expected benefit** — what improves.
- **Risk** — what could break.
- **Scope** — files, functions, behavior boundaries.
- **Test plan** — how to verify the refactor preserves behavior.

The refactor subagent writes the file. The user reviews the candidates and approves the ones worth pursuing. The user, not the agent, decides which candidates are in scope.

## File hygiene

- Never commit artifacts automatically. The user reviews and commits them as part of a phase commit.
- Never delete artifacts. If a phase is abandoned, leave the file in place with a "ABANDONED — superseded by `<new feature>`" note at the top.
- Never reference artifacts from outside the feature directory by hardcoded path. Use the slug.
