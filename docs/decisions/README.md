# Active decision records

Active decision records for current and upcoming features. Each feature has a folder `docs/decisions/<feature>/` containing at minimum `spec.md` (the approved specification) and `workflow.md` (the running workflow log). Plans live at `docs/decisions/<feature>/plan.md` when written.

## Lifecycle

1. **Draft** — created by the `sdd` or `doit` skill during planning. May be edited freely.
2. **Approved** — the user has signed off. The file is now append-only: corrections are made by writing a new `spec-NN-<topic>.md` or by amending the workflow log, not by editing the approved spec.
3. **Frozen** — the feature ships or is superseded. The files are moved (not copied, not edited) to `docs/specs/`, `docs/plans/`, and `docs/workflows/` respectively. The folder in `docs/decisions/` is removed.

## Source of truth

The code is the source of truth for system behavior, not these files. See `AGENTS.md` "Source-of-truth priority" for the ordering when sources conflict.

A decision record answers "why is it this way?" and "what was rejected?" — not "what does the system do?" If a decision record and the code disagree, the code wins; the record gets a `> Superseded by:` footer on the next review.
