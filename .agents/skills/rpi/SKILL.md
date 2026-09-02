---
name: rpi
description: Run a research-plan-implement workflow with review cycles between phases. Use this skill when the user wants a markdown-driven, artifact-based engineering flow with human review gates after each agent review, fresh context per phase, and explicit over-engineering checks. Distinct from `sdd` (formal spec, single human review gate) and `doit` (lightweight, no formal gate): RPI keeps the process lightweight but insists on a research-review, plan-review, per-phase implementation-review, and final-review gate, with the human only reading after the agent has self-reviewed and fixed obvious issues. The plan-review subagent picks the feature's implementation strategy (TDD by default, Code first with justification otherwise) and records it in PLAN.md; a per-iteration verify step runs format, lint, typecheck, and tests before the implementation-review subagent is spawned.
compatibility: Requires Git with worktree support, the repository's existing development tools, and the ability to spawn fresh-context subagents per phase.
---

# Research, Plan, Implement, Review (RPI)

A markdown-driven engineering workflow. Each phase is a fresh-context session that writes or reads artifacts under `docs/rpi/<feature>/`. After every agent review, a human review gate pauses the workflow so the user sees the agent's findings before continuing.

The 11 steps below correspond to the phases in this skill. Each phase has its own file under `phases/` with the exact prompt to send the subagent and the human-gate behavior.

1. Start with a clear problem statement.
2. Research → `docs/rpi/<feature>/RESEARCH.md`.
3. Research review (agent + human gate).
4. Planning → `docs/rpi/<feature>/PLAN.md` and `docs/rpi/<feature>/CHECKLIST.md`.
5. Plan review (agent + human gate; agent picks the feature's implementation strategy and records it in `PLAN.md`).
6. Implementation (per phase, tracked in `CHECKLIST.md`; default strategy TDD, read from `PLAN.md`).
7. Verify per phase — run format, lint, typecheck, and tests; fix mechanical failures in place.
8. Implementation review per phase (agent + human gate).
9. Commit (asked, never auto).
10. Final review (agent + human gate).
11. Refactor — only if the user opts in. Writes `docs/rpi/<feature>/REFACTOR.md`.

The diagram from the source article, transcribed:

```
[Problem]
    |
    v
[Research]  -->  RESEARCH.md
    |
    v
[Research review: agent]  -->  revise
    |
    v
[Research review: human]  <--  gate
    |
    v
[Plan]  -->  PLAN.md, CHECKLIST.md
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
[Refactor? user decides] --yes-->  REFACTOR.md --> implement --> review
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
- Human gates are mandatory after research review, plan review, per-phase implementation review, and final review. The skill pauses and surfaces the agent's findings; it does not auto-proceed.
- The skill never commits, pushes, opens a PR, or deletes files without explicit per-action user authorization.
- Artifacts live at `docs/rpi/<feature>/[RESEARCH|PLAN|CHECKLIST|REFACTOR].md`. `<feature>` is a stable kebab-case slug chosen at workflow start.
- `CHECKLIST.md` is the implementation tracker; the implementer updates it as work progresses.
- The user picks the provider tier (opencode-go, opencode-zen, openrouter, or freebuff) at workflow start. The skill records it in workflow state and uses the per-phase routing table in `models.md`.
- Free tier is preferred. If no no-retention free model fits a phase, the skill pauses and asks the user before using a model that retains or trains on data.
- After every implementation phase, run the repository's canonical validation command. CI should run that same command, not a weaker duplicate.
- Default implementation strategy is **TDD (tests first)**. The plan-review subagent records the feature's strategy in `PLAN.md` under `## Implementation strategy` and may flip to Code first only when the feature genuinely cannot be tested (recorded with a one-line reason). The user can override either choice by editing `PLAN.md` before approving the plan-review gate, or by selecting **Revise** and naming the desired strategy. The implementer and the implementation reviewer both read the strategy from `PLAN.md` and verify it was followed.
- After each implementation iteration and before the implementation review, the skill runs the verify step (format → lint → typecheck → tests). The verify subagent edits files in place to fix mechanical failures. The implementation-review subagent is only spawned after verify returns green.
- Watch for over-engineering at every review pass: abstractions and helpers not asked for, error handling for impossible cases, configuration where hardcoded values would do, features or refactors beyond scope. The reviewer should flag each instance.
- Treat untrusted values and unusual object behavior defensively, including inherited properties, accessors, proxies, cycles, sparse collections, and mutable shared state when relevant.
- Keep public diagnostics and serialized output deterministic and independent of third-party wording or incidental iteration order.

## Agent Model Tiers

Choose exactly one provider tier at workflow start (see `models.md`). The provider picks the model catalog; the per-phase routing table in `models.md` picks the model within that catalog.

The user picks from:

- **opencode-go** — paid OpenCode Go models.
- **opencode-zen** — free OpenCode Zen models (preferred when available).
- **openrouter** — OpenRouter free models.
- **freebuff** — freebuff coding agent (when the user wants the freebuff harness).

OpenCode Zen and OpenCode Go models must be free. Avoid models that retain data or train on data. If no no-retention model fits a phase, pause and ask the user before delegating to one that does.

The free-tier phase routing mirrors `sdd` and `doit`:

| Phase | Primary | Fallback |
| --- | --- | --- |
| Research | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Research review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Plan | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Plan review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Implementation | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Verify | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Implementation review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Final review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Refactor | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |

The implementer uses a cheaper model; planning, review, and refactor use stronger reasoning models. The implementer and its reviewer use different models where possible to avoid correlated blind spots.

Verify model availability once with `opencode models` at workflow start. Record the chosen provider, the model that served each phase, and every fallback. A model report is not verification evidence; all required commands still run for real.

## Workflow at a glance

1. Run `question` to capture `<feature>` slug, base branch, and provider tier. Record in conversation state.
2. Run `worktree.md` to create the worktree. Refuse to proceed in the main checkout.
3. Read `artifacts.md` to confirm path layout, then `phases/01-research.md` to begin.
4. After every agent review, follow `human-gates.md`: print the agent's summary, then `question` for approved / revise / ignore-points / abort.
5. At the commit step (9), follow `phases/08-commit.md`: never commit; ask first and use the user's exact command.
6. After step 11, follow `phases/10-refactor.md`: ask the user whether to refactor; only proceed on yes.

## Related skills

- **`sdd`** — heavier: formal specification, single human review gate before implementation, planning and tests as first-class artifacts. Use when the change is large, cross-cutting, or has compliance/security surface.
- **`doit`** — lighter: no formal spec, no human approval gate, focuses on fast execution. Use when the change is well-scoped and bounded.
- **rpi** (this skill) — middle ground: lightweight markdown artifacts, but review cycles after research, plan, each implementation phase, and final. Human gates are mandatory but cheap because the agent has already self-revised. Each implementation iteration runs through implementation → verify (format, lint, typecheck, tests) → review, and the plan-review subagent records the feature's implementation strategy in `PLAN.md` (TDD by default).

## Source

Adapted from Tyler Burleigh's *Research, Plan, Implement, Review: My Agentic Engineering Workflow* (2026-02-22). Modified to (a) use `CHECKLIST.md` instead of `PLAN-CHECKLIST.md`, (b) require an agent review before each human review gate, (c) make step 10 (refactor) opt-in, and (d) standardize artifacts under `docs/rpi/<feature>/`.
