# Active decision records

Single active home for **all** feature workflows (`sdd`, `rpi`, `doit`). Each feature uses `docs/decisions/<feature>/` with **lowercase** filenames.

Typical files (write only what the workflow needs):

| File | Used by | Durable? |
| --- | --- | --- |
| `research.md` | RPI | yes → `docs/research/` |
| `spec.md` | SDD | yes → `docs/specs/` |
| `plan.md` | SDD, RPI, doit | yes → `docs/plans/` |
| `workflow.md` | SDD, optional elsewhere | yes → `docs/workflows/` |
| `refactor.md` | RPI (opt-in) | yes → `docs/plans/<feature>-refactor.md` |
| `checklist.md` | RPI implementer tracker | **no** — delete on release |
| `notes.md` | doit (optional) | yes → fold into plan or delete if ephemeral |

## Lifecycle

1. **Draft** — created during planning. May be edited freely until the relevant human approval gate.
2. **Approved** — append-only for that artifact. Corrections use an addendum or workflow log entry, not silent rewrites.
3. **Frozen** — the feature ships or is superseded. Move durable files to the frozen trees below and **delete** `docs/decisions/<feature>/`. Never leave shipped drafts in this directory.

### Freeze destinations

| Active file | Frozen path |
| --- | --- |
| `research.md` | `docs/research/<feature>.md` |
| `spec.md` | `docs/specs/<feature>.md` |
| `plan.md` | `docs/plans/<feature>.md` |
| `workflow.md` | `docs/workflows/<feature>-workflow.md` |
| `refactor.md` | `docs/plans/<feature>-refactor.md` |
| `checklist.md` | deleted |

Add a `> Status: frozen <YYYY-MM-DD>` header when moving.

## Source of truth

The code is the source of truth for system behavior, not these files. See `AGENTS.md` "Source-of-truth priority".

A decision record answers "why is it this way?" and "what was rejected?" — not "what does the system do?"
