---
name: rpi
description: Run a research-plan-implement workflow with review cycles between phases. Use this skill when the user wants a markdown-driven, artifact-based engineering flow with human review gates after each agent review, fresh context per phase, and explicit over-engineering checks. Distinct from `sdd` (formal spec, single human review gate) and `doit` (lightweight, no formal gate): RPI keeps the process lightweight but insists on a research-review, plan-review, per-phase implementation-review, and final-review gate, with the human only reading after the agent has self-reviewed and fixed obvious issues. The plan-review subagent picks the feature's implementation strategy (TDD by default, Code first with justification otherwise) and records it in plan.md; a per-iteration verify step runs format, lint, typecheck, and tests before the implementation-review subagent is spawned.
compatibility: Requires Git with worktree support, the repository's existing development tools, and the ability to spawn fresh-context subagents per phase.
---

# Research, Plan, Implement, Review (RPI)

A markdown-driven engineering workflow. Each phase is a fresh-context session that writes or reads artifacts under `docs/decisions/<feature>/` (same active tree as SDD/doit). On feature release, durable artifacts are moved to the frozen trees (`docs/research/`, `docs/plans/`, `docs/workflows/` as applicable), `checklist.md` is deleted, and the `docs/decisions/<feature>/` folder is removed. After every agent review, a human review gate pauses the workflow so the user sees the agent's findings before continuing.

The 11 steps below correspond to the phases in this skill. Each phase has its own file under `phases/` with the exact prompt to send the subagent and the human-gate behavior.

1. Start with a clear problem statement. If the user did not provide one, ask for it first and do not proceed until they do. Derive the feature slug from that statement; never ask for the slug.
2. Research → `docs/decisions/<feature>/research.md` (draft; becomes `docs/research/<feature>.md` on release).
3. Research review (agent + human gate).
4. Planning → `docs/decisions/<feature>/plan.md` and `docs/decisions/<feature>/checklist.md`.
5. Plan review (agent + human gate; agent picks the feature's implementation strategy and records it in `plan.md`).
6. Implementation (per phase, tracked in `checklist.md`; default strategy TDD, read from `plan.md`).
7. Verify per phase — run format, lint, typecheck, and tests; fix mechanical failures in place.
8. Implementation review per phase (agent + human gate).
9. Commit (asked, never auto).
10. Final review (agent + human gate).
11. Refactor — only if the user opts in. Writes `docs/decisions/<feature>/refactor.md` (becomes `docs/plans/<feature>-refactor.md` on release).

The diagram from the source article, transcribed:

```
[Problem]
    |
    v
[Research]  -->  research.md
    |
    v
[Research review: agent]  -->  revise
    |
    v
[Research review: human]  <--  gate
    |
    v
[Plan]  -->  plan.md, checklist.md
    |
    v
[Plan review: agent]  -->  revise
    |
    v
[Plan review: human]  <--  gate
    |
    v
[Implement phase 1..N]  -->  edits, tests
    |
    v
[Verify phase 1..N]  -->  format, lint, typecheck, tests; fix mechanical failures
    |
    v
[Implement review: agent]  -->  revise
    |
    v
[Implement review: human]  <--  gate
    |
    v
[Commit]  <--  asked, never auto
    |
    v
[...repeat implement+verify+review+commit for each phase]
    |
    v
[Final review: agent]  -->  revise
    |
    v
[Final review: human]  <--  gate
    |
    v
[Refactor? user decides] --yes-->  refactor.md --> implement --> review
    no
    |
    v
[done]
```

## Operating rules

- Work in a dedicated feature worktree (see `worktree.md`), never the main checkout.
- Before editing with multiple worktrees, verify `git rev-parse --show-toplevel`, the current branch, `git worktree list`, and repository status; use the confirmed root for absolute paths.
- Every phase runs in a fresh-context subagent (no carry-over from prior phases). The user-visible summary is composed in the main thread, not the subagent.
- Agent review always happens before the human review gate. The agent must self-revise the artifact first; the human only reads when obvious problems are already addressed.
- Human gates are mandatory after research review, plan review, per-phase implementation review, and final review. The skill pauses and surfaces a **phase content summary** (research / plan / code / final / refactor as relevant) plus the agent's findings; it does not auto-proceed. See `human-gates.md`.
- The skill never commits, pushes, opens a PR, or deletes files without explicit per-action user authorization.
- Artifacts live at `docs/decisions/<feature>/[research|plan|checklist|refactor].md` while the feature is active. On release: `research.md` → `docs/research/<feature>.md`, `plan.md` → `docs/plans/<feature>.md`, `refactor.md` → `docs/plans/<feature>-refactor.md`, optional `workflow.md` → `docs/workflows/<feature>-workflow.md`; `checklist.md` is deleted; the `docs/decisions/<feature>/` folder is removed.
- `checklist.md` is the implementation tracker; the implementer updates it as work progresses.
- If the user did not supply a problem statement, stop and ask for one before any other workflow question. Do not invent the problem.
- Derive `<feature>` slug from the problem statement automatically (kebab-case, lowercased, concise). Never ask the user for the slug. Confirm the derived slug only if it would collide with an existing `docs/decisions/<slug>/` or worktree.
- The user picks the provider tier (`cursor` | `free` | `normal` | `freebuff`; aliases `opencode-zen`/`openrouter`→`free`, `opencode-go`→`normal`) at workflow start. The skill records it and resolves models via [`../shared/models.md`](../shared/models.md) (phase → role → tier routing).
- Prefer **cursor** when the session already runs in Cursor. Outside Cursor, prefer **free**. If no no-retention free model fits a phase, the skill pauses and asks before using a model that retains or trains on data.
- After every implementation phase, run the repository's canonical validation command. CI should run that same command, not a weaker duplicate.
- Default implementation strategy is **TDD (tests first)**. The plan-review subagent records the feature's strategy in `plan.md` under `## Implementation strategy` and may flip to Code first only when the feature genuinely cannot be tested (recorded with a one-line reason). The user can override either choice by editing `plan.md` before approving the plan-review gate, or by selecting **Revise** and naming the desired strategy. The implementer and the implementation reviewer both read the strategy from `plan.md` and verify it was followed.
- After each implementation iteration and before the implementation review, the skill runs the verify step (format → lint → typecheck → tests). The verify subagent edits files in place to fix mechanical failures. The implementation-review subagent is only spawned after verify returns green.
- Watch for over-engineering at every review pass: abstractions and helpers not asked for, error handling for impossible cases, configuration where hardcoded values would do, features or refactors beyond scope. The reviewer should flag each instance.
- Treat untrusted values and unusual object behavior defensively, including inherited properties, accessors, proxies, cycles, sparse collections, and mutable shared state when relevant.
- Keep public diagnostics and serialized output deterministic and independent of third-party wording or incidental iteration order.
- `research.md`, `plan.md`, and `refactor.md` are draft documents during the active feature. Once the corresponding human gate approves them, they are append-only: corrections are made by writing a new addendum or amending the workflow state, not by editing the approved artifact. On release they move to the frozen trees in `AGENTS.md` / `docs/decisions/README.md` and are frozen.
- RPI artifacts are decision records once approved, not behavior specs. The code is the source of truth for what the system does. See `AGENTS.md` "Source-of-truth priority".

## Agent Model Tiers

Canonical definitions: [`../shared/models.md`](../shared/models.md) (local `models.md` is a redirect stub).

Choose exactly one provider tier at workflow start (`cursor` | `free` | `normal` | `freebuff`). Prefer **cursor** in Cursor sessions, **free** otherwise. If unspecified, ask before delegating. On **cursor**, do not use Fable without explicit approval.

Map each RPI phase to a shared role, then resolve the model from the active tier:

| Phase | Role |
| --- | --- |
| Research | `reasoning` |
| Research review | `adversarial` |
| Plan | `plan` |
| Plan review | `adversarial` |
| Implementation | `coding` |
| Verify | `verify` |
| Implementation review | `review` |
| Final review | `review` |
| Refactor | `docs` |

On **cursor**, walk primary → alt → **cross-pool** when a usage pool is maxed (Cursor Models vs Other Models). On **free** / **normal**, use that file's role primary/fallback or chain. Verify availability at start; record tier, models, fallbacks, and exhausted pools. A model report is not verification evidence.

## Workflow at a glance

1. If no problem statement yet, ask for one and stop until the user provides it. Derive `<feature>` slug from that statement (do not ask). Then `question` for base branch and provider tier (`cursor` | `free` | `normal` | `freebuff`). Record all three in conversation state.
2. Run `worktree.md` to create the worktree. Refuse to proceed in the main checkout.
3. Read `artifacts.md` to confirm path layout, then `phases/01-research.md` to begin.
4. After every agent review, follow `human-gates.md`: print the gate-specific **phase summary** and the agent's review findings, then `question` for approved / revise / ignore-points / abort.
5. At the commit step (9), follow `phases/08-commit.md`: never commit; ask first and use the user's exact command.
6. After step 11, follow `phases/10-refactor.md`: ask the user whether to refactor; only proceed on yes.

## Related skills

- **`sdd`** — heavier: formal specification, single human review gate before implementation, planning and tests as first-class artifacts. Use when the change is large, cross-cutting, or has compliance/security surface.
- **`doit`** — lighter: no formal spec, no human approval gate, focuses on fast execution. Use when the change is well-scoped and bounded.
- **rpi** (this skill) — middle ground: lightweight markdown artifacts under `docs/decisions/<feature>/` (shared with SDD/doit), but review cycles after research, plan, each implementation phase, and final. Human gates are mandatory but cheap because the agent has already self-revised. Each implementation iteration runs through implementation → verify (format, lint, typecheck, tests) → review, and the plan-review subagent records the feature's implementation strategy in `plan.md` (TDD by default). On release, approved artifacts move to the frozen trees (`docs/research/`, `docs/plans/`, …) and the decisions folder is removed.

## Source

Adapted from Tyler Burleigh's *Research, Plan, Implement, Review: My Agentic Engineering Workflow* (2026-02-22). Modified to (a) use `checklist.md` instead of `PLAN-CHECKLIST.md`, (b) require an agent review before each human review gate, (c) make step 10 (refactor) opt-in, and (d) use the shared `docs/decisions/<feature>/` active tree (no separate `docs/rpi/` path) with freeze into `docs/research/`, `docs/plans/`, and `docs/workflows/`.
