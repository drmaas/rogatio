---
name: sdd
description: Run a disciplined spec-driven development workflow for non-trivial software changes. Use this skill whenever a user asks for TDD, SDD, a brainstorm-to-implementation plan, architecture or requirements work, a human review gate, independent code review, or a commit/push/PR workflow. It takes the change through an isolated worktree, model-assisted brainstorming, architecture, specification, approval, implementation planning, tests-first development, model-assisted coding and verification, fresh-context review, documentation, and release preparation.
compatibility: Requires Git with worktree support, the repository's existing development tools, and an independent review context or reviewer.
---

# Spec-Driven Development Workflow

Follow this workflow for non-trivial changes. The goal is to make the intended behavior explicit before implementation, make tests traceable to the approved behavior, and use independent review to catch problems the implementer is too close to see.

Do not silently skip stages. If a stage is not applicable, record why in the workflow notes. Keep a short status checklist and update it after each stage.

## Operating rules

- Match the repository's conventions, tooling, architecture, and naming before introducing anything new.
- Keep the work isolated in a feature worktree. Do not develop a feature in the main checkout.
- Before editing with multiple worktrees, verify `git rev-parse --show-toplevel`, the current branch, `git worktree list`, and repository status; use the confirmed root for absolute paths.
- Separate discovery from commitment: brainstorming may contain alternatives; the approved specification must contain a clear decision.
- Treat the human review gate as a real stop. Do not write the implementation plan, tests, or production code until the user approves the specification.
- Write tests from approved acceptance criteria before implementation. A test may be intentionally red at first, but it must become meaningful and pass after implementation.
- Keep the specification, architecture, plan, tests, implementation, and documentation consistent. When one changes, inspect the downstream artifacts.
- Use the project's package manager and existing scripts. Do not install a new dependency merely to satisfy this workflow without approval.
- Treat untrusted values and unusual object behavior defensively, including inherited properties, accessors, proxies, cycles, sparse collections, malformed encodings, and mutable shared state when relevant.
- Keep public diagnostics and serialized output deterministic and independent of third-party wording or incidental iteration order.
- After implementation or review fixes, rerun the repository's canonical validation command; CI should run that same authoritative command rather than a weaker duplicate.
- Before release operations, audit staged, unstaged, tracked, and untracked files for secrets, local settings, generated artifacts, unrelated changes, and accidental edits outside the worktree.
- Keep state-inspection commands clearly scoped so branch, path, and status output cannot be confused; a failed or malformed tool call is a no-op, not a reason to guess.
- Commit, push, PR creation, merge, and cleanup are separate release actions for audit purposes, but one explicit authorization for a clearly defined set remains valid for that set. Ask again only when authorization is absent, ambiguous, or the scope changes; never force-push or push directly to a protected default branch. Prompt immediately before deleting files/directories or removing worktrees.

## Agent Model Tiers

Choose exactly one tier before Stage 1 and carry that tier through every role in the workflow. If the user did not specify `free` or `normal`, ask them to choose before delegating work. Do not silently change tiers mid-workflow.

### Free tier

Free tier uses the OpenCode Zen free catalog and OpenRouter free models. Current exact model IDs are:

OpenCode Zen free:

- `opencode/x-preview-f-free` (Ox Alpha Free)
- `opencode/nemotron-3-ultra-free` (Nemotron 3 Ultra Free)
- `opencode/nemotron-3.5-lightning-free` (Nemotron 3.5 Lightning Free)
- `opencode/muse-spark-1.2-contributor-free` (Muse Spark 1.2 Free)
- `opencode/hy3-free` (Hy3 Free)
- `opencode/mimo-v2.5-free` (MiMo V2.5 Free)
- `opencode/big-pickle` (Big Pickle)

OpenRouter free:

- `openrouter/poolside/laguna-s-2.1:free` (Laguna S 2.1)
- `openrouter/thinkingmachines/inkling-small:free` (Inkling Small)
- `openrouter/dots-studio/dots-3-note-preview:free` (Dots3-Note Preview)

Free mode routes each phase to a primary model with a documented fallback. If the primary is unavailable, use the fallback rather than the session model or a paid provider. Never silently substitute an unlisted model; if both primary and fallback are unavailable, stop and ask the user to switch to normal tier or explicitly approve a replacement.

#### SDD free-phase routing

| Stage | Phase | Primary | Fallback |
| --- | --- | --- | --- |
| 1 | Brainstorm | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 2 | Architecture | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 3 | Specification | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 4 | Human review gate | No delegated model; wait for the user | |
| 5 | Implementation plan | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 6 | Tests first | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| 7 | Implementation | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| 8 | Verification and tests | `opencode/nemotron-3.5-lightning-free` | `openrouter/poolside/laguna-s-2.1:free` |
| 9 | Independent fresh-context review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| 10 | Documentation | `opencode/hy3-free` | `openrouter/dots-studio/dots-3-note-preview:free` |
| 11 | Release actions | No delegated model; require user authorization | |

The reasoning-heavy discovery and design stages (brainstorm, architecture, specification) use Nemotron 3 Ultra Free as primary because it pairs the strongest reasoning with the fastest speed in the catalog. Plan and documentation use Hy3 Free as primary. Implementation and tests use Laguna S 2.1 as primary with Inkling Small as fallback on both speed and coding score. Verification uses Nemotron 3.5 Lightning as primary for its speed, falling back to Laguna S 2.1. Review uses Nemotron 3 Ultra with Inkling Small as fallback so the reviewer stays separate from the implementation model.

### Normal tier

Normal tier retains the existing role chains, but prefers an exact or clearly equivalent free OpenCode Zen model before a paid normal model. The current exact equivalence is `opencode/hy3-free` for the existing `opencode-go/hy3` verification/documentation role. Other free models are alternatives by capability, not automatic equivalents.

- **Primary brainstorm, architecture, SDD specification, tests, and coding:** `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session model.
- **Adversarial brainstorm:** `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session model.
- **Plan writing and independent review:** `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/openai/gpt-5.5` → session model.
- **Verification and documentation:** `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session model.

### Selection and recording

At workflow start, verify the selected tier's IDs with `opencode models` or the session's provider list. Record the selected tier, the model used for each role, and every fallback in the workflow log. A model report is not verification evidence; all required commands still run for real. Under a single-model session, keep the role passes distinct and perform the fresh-context review as a deliberate self-review.

## Workflow state and artifacts

Use the repository's established locations when they exist. Otherwise use these defaults:

- Brainstorm notes: ephemeral working context only. Do not create or retain `docs/specs/<feature>-brainstorm.md` files. Preserve only the decisions that survive synthesis in the architecture, specification, plan, and workflow record.
- Architecture decision: `docs/architecture.md` (human readable), updated as boundaries change.
- Specification: `docs/specs/<feature>.md`.
- Implementation plan: `docs/plans/<feature>.md`.
- Tests: mapped to acceptance-criterion IDs where practical.
- Workflow log: stage status, review rounds, findings, decisions, and verification results.

Prefer durable documents for the architecture, specification, and plan when the change is large enough that another engineer will need to implement or review it. For a small change, the same information may be kept in the task or PR description, but still pass through every gate. If old brainstorm files exist, treat them as disposable working artifacts and prompt before deleting them.

## Stage 0 — Enter an isolated worktree

1. Verify the repository root with `git rev-parse --show-toplevel`, then inspect the current branch, worktrees, status, and available package/test scripts. If the checkout has uncommitted work, do not mix it in — ask how to proceed or branch from a clean known base.
2. Create or enter the dedicated feature worktree and branch using the repository's naming convention. Confirm the shell is operating in that worktree before editing.
3. Record base commit, branch, worktree path, intended change, and which models will serve each role. If the user supplied a worktree, verify it is the intended feature worktree before editing.

## Stage 1 — Brainstorm

Understand the problem before choosing a solution. Keep both raw outputs ephemeral; do not save brainstorm documents in the repository.

Ask the primary model to produce the brainstorm: user problem and desired outcome; affected users, callers, and systems; current behavior and limitations; constraints, invariants, security/privacy concerns, and compatibility requirements; at least two plausible approaches when the design is not obvious; trade-offs, risks, unknowns, and questions requiring user input; a provisional success definition and likely acceptance criteria.

Run an adversarial pass with a different model. Give it the primary result plus repository context and ask it to attack for omissions, false assumptions, boundary failures, platform issues, supply-chain risks, and false-green verification. The adversarial pass should challenge the primary proposal, not restate it.

Skip the adversarial pass only when the change is a pure documentation or config edit with no behavior, security, persistence, migration, public-API, or compatibility surface; record the skip reason.

Search the codebase and current documentation before proposing new abstractions. Ask focused questions for decisions that materially affect behavior, compatibility, cost, security, or architecture. Do not turn unresolved assumptions into requirements. Carry forward useful material as synthesized decisions, not retained brainstorm files.

## Stage 2 — Architecture

Have the architecture-synthesis model resolve the two brainstorm inputs, repository evidence, and user constraints into the chosen approach. Describe:

- Components/modules affected and their responsibilities.
- Public APIs, data models, schemas, state transitions, and error paths.
- Control flow and important sequence/interaction behavior.
- Persistence, migrations, caching, concurrency, and rollback behavior when relevant.
- Security boundaries, permissions, secrets, input validation, and observability.
- Extension points and how future implementations can be added without coupling core behavior.
- Testing seams and which behavior belongs in unit, integration, or end-to-end tests.
- Alternatives considered and why they were rejected.

Keep architecture decisions proportional to the change. Write durable boundary and decision updates to `docs/architecture.md` when required by the repository. Flag anything that would require a specification change or a human decision.

## Stage 3 — Write the specification

Have the specification model write the specification to `docs/specs/<feature>.md` using the synthesized architecture and the ephemeral brainstorm findings. It must be a testable specification in user and system terms. Include:

1. Problem statement and goals.
2. Scope and explicit non-goals.
3. Actors, entry points, and supported environments.
4. Functional requirements with stable IDs such as `REQ-001`.
5. Acceptance criteria with stable IDs such as `AC-001`, including happy paths, edge cases, and failure behavior.
6. API, CLI, UI, file-format, or compatibility changes.
7. Security, privacy, performance, accessibility, and operational requirements.
8. Migration, rollout, and backward-compatibility behavior.
9. Open questions and assumptions.

Every acceptance criterion should be observable and specific enough to become a test or a documented manual check. State what the system must not do when that boundary matters.

## Stage 4 — Human review gate

Present the proposed architecture and specification to the user in a concise review packet. Call out:

- Decisions made and alternatives rejected.
- Requirements and acceptance criteria.
- User-visible changes and compatibility impact.
- Risks, open questions, and items needing confirmation.

Stop and wait for explicit approval. Do not write the implementation plan or tests before approval. If the user requests changes, rerun the relevant ephemeral model pass and update the architecture or specification as appropriate, then repeat this gate. Record the approval and any conditions.

## Stage 5 — Write the implementation plan

After approval, have the plan model write the ordered plan to `docs/plans/<feature>.md`. It must be concrete enough for another engineer to execute. For each task include:

- The relevant file, module, package, or configuration area.
- The behavior or invariant being added/changed.
- Dependencies and ordering constraints.
- The acceptance-criterion IDs covered.
- The test or verification that proves completion.

Separate foundational changes from integration and cleanup. Identify generated files, migrations, feature flags, rollback steps, and documentation updates. Keep the plan aligned with the approved scope; if it is no longer aligned, return to the appropriate earlier stage instead of quietly expanding scope.

## Stage 6 — Write tests first

Have the tests-and-coding model implement the tests before production code whenever the repository permits it.

- Map tests to acceptance criteria and requirements.
- Cover normal behavior, boundaries, invalid input, failures, security constraints, and compatibility behavior.
- Use the narrowest appropriate test level: unit tests for deterministic logic, integration tests for component boundaries, and end-to-end tests for real user journeys.
- Prefer real serializers, schemas, parsers, and boundaries over excessive mocks.
- Follow the repository's existing test framework and naming conventions.
- Run the new tests before implementation when useful and record the expected red state; do not weaken assertions just to obtain green.

If tests cannot be written first for a particular integration or UI constraint, document the reason and write the closest executable contract before coding.

## Stage 7 — Write the implementation

Have the tests-and-coding model implement only the approved behavior and the plan's tasks.

- Make the smallest coherent change that satisfies the tests.
- Preserve existing behavior outside the approved scope.
- Validate untrusted input at the correct boundary and return stable, actionable errors.
- Avoid speculative abstractions and unrelated refactors.
- Keep public names, schemas, migrations, and generated artifacts synchronized.
- Update tests when implementation reveals an approved edge case that was not expressible initially; if behavior changes, return to the specification gate.

## Stage 8 — Verification and tests

Have the verification model drive the project's complete relevant verification suite, not only the new tests. The workflow must still execute real commands and capture their output; a model report alone is not evidence. At minimum, use the repository's equivalents of:

- Formatting and linting.
- Type checking or static analysis.
- Unit tests.
- Relevant integration tests.
- End-to-end browser or system tests.
- Build/package checks and migration checks when applicable.

Review the diff and test output together. Check that each acceptance criterion has evidence, no test relies on accidental implementation details, and no unrelated files or secrets are included. Fix failures before advancing. Record exact commands and results in the workflow log.

## Stage 9 — Independent fresh-context review loop

Have the independent-review model review the completed change from a fresh context — a different model than the one that implemented whenever possible. The reviewer must not rely on the implementer's unstated reasoning. Give it only the relevant request, approved specification, architecture, implementation plan, final diff, and verification results.

Use a maximum of **three review rounds**:

1. Round 1 is mandatory. Request findings ordered by severity: missing requirements, incorrect assumptions, security/privacy issues, regressions, test gaps, maintainability concerns, and documentation gaps.
2. If round 1 has no actionable findings, mark the review passed and continue.
3. Rounds 2 and 3 run only when round 1 produced findings. Classify each finding and loop back to the earliest appropriate stage:
   - Requirement or user-visible behavior issue → Brainstorm or Specification, then repeat the human review gate.
   - Architecture, boundary, migration, or API issue → Architecture and Implementation Plan; repeat the human gate if behavior or scope changes.
   - Missing or weak coverage → Tests first, then implementation and verification.
   - Implementation defect within approved behavior → Implementation, then verification.
   - Verification or release-process gap → Verification, then review.
   - Documentation-only issue → Documentation after the fix.
4. Re-run the canonical validation command and any affected tests after fixes, then start the next fresh review round.
5. Record the round number, reviewer context, findings, fixes, and evidence.

Never exceed three rounds. If actionable disagreement or findings remain after round three, stop and ask the user to decide rather than continuing an unbounded loop.

## Stage 10 — Documentation updates

Once behavior and review findings are stable, have the documentation model update the files this change actually touches. Update at minimum:

- `docs/architecture.md` when the change alters components, boundaries, data/control flow, or decisions.
- `README.md` when the change alters setup, usage, or examples visible to users.
- `AGENTS.md` orientation line when the change shifts what an agent working in the repo needs to know first.

Then update the rest of the documentation set as needed: user guides, CLI/API references, examples, configuration, migration, release, and troubleshooting docs; changelog or release notes when the repository uses them.

Document supported platforms, limitations, security behavior, and the upgrade path. Keep examples executable or consistent with the implementation. Run documentation checks, links, generated-doc builds, or package checks that the repository provides. Record final release/status changes in the established workflow documentation.

## Stage 11 — Commit, push, PR, merge, and cleanup

Before release actions, show the user the final summary, changed-file list, verification evidence, review-round result, and any known limitations. Confirm that the worktree contains only intended changes.

With explicit user approval for the defined release-action set (an existing authorization remains valid unless it is absent, ambiguous, or the scope changes):

1. Verify the active repository root, branch, worktree list, status, and recent commit-message conventions.
2. Review staged, unstaged, tracked, and untracked files and diffs; never include secrets, local settings, generated noise, or unrelated user work.
3. Create a concise conventional commit when the repository uses conventional commits, describing why the change was made.
4. Push the feature branch to the expected remote. Never force-push or push directly to a protected default branch.
5. Open or update a pull request using the repository's supported tooling. Include the problem, solution, scope, tests/verification, review-round summary, documentation changes, migrations, and known risks.
6. When merge is in scope and authorized, wait for required checks and merge without bypassing branch protections.
7. After merge, reconcile release/status documentation and verify the default branch, worktrees, local branches, and remote refs. Remove worktrees, local branches, or merged remote branches only when cleanup is in scope; prompt immediately before deleting files/directories or removing worktrees.
8. Report the commit, branch, PR, merge result, cleanup result, verification evidence, and any remaining action required from the user.

If approval for any release action is absent or ambiguous, stop after preparing the exact proposed command or PR content. Do not infer permission to commit, push, merge, deploy, or delete.

## Completion checklist

A change is complete only when:

- [ ] Work happened in the intended feature worktree.
- [ ] Primary and adversarial brainstorm passes were completed ephemerally (or the skip was recorded with reason); only synthesized architecture decisions are retained (architecture in `docs/architecture.md`).
- [ ] The specification at `docs/specs/<feature>.md` was explicitly approved by the user.
- [ ] The implementation plan at `docs/plans/<feature>.md` maps tasks to acceptance criteria.
- [ ] Each role's model was checked; fallbacks were recorded, not silently substituted.
- [ ] Tests were written first or the exception was documented.
- [ ] Relevant formatting, linting, type, unit, integration, E2E, and build checks pass.
- [ ] The canonical validation command was rerun after implementation and after later fixes; CI runs the same authoritative validation.
- [ ] Fresh-context review passed within three rounds, or unresolved findings were escalated.
- [ ] Documentation this change touches is updated (architecture, README, AGENTS as applicable).
- [ ] The user approved commit/push/PR actions before they were performed.
- [ ] The final release audit covered staged, unstaged, tracked, and untracked files; the commit and PR contain only intended changes and include verification evidence.
- [ ] After merge, release/status documentation, the default branch, worktrees, local branches, and remote refs were reconciled and verified.
