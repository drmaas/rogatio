---
name: sdd
description: Run a disciplined spec-driven development workflow for non-trivial software changes. Use this skill whenever a user asks for TDD, SDD, a brainstorm-to-implementation plan, architecture or requirements work, a human review gate, independent code review, or a commit/push/PR workflow. It takes the change through an isolated worktree, brainstorming, architecture, specification, approval, implementation planning, tests-first development, verification, up to three fresh-context review rounds, documentation, and release preparation.
compatibility: Requires Git with worktree support, the repository's existing development tools, and an independent review context or reviewer.
---

# Spec-Driven Development Workflow

Follow this workflow for non-trivial changes. The goal is to make the intended behavior explicit before implementation, make tests traceable to the approved behavior, and use independent review to catch problems the implementer is too close to see.

Do not silently skip stages. If a stage is not applicable, record why in the workflow notes. Keep a short status checklist and update it after each stage.

## Operating rules

- Match the repository's conventions, tooling, architecture, and naming before introducing anything new.
- Keep the work isolated in a feature worktree. Do not develop a feature in the main checkout.
- Separate discovery from commitment: brainstorming may contain alternatives; the approved specification must contain a clear decision.
- Treat the human review gate as a real stop. Do not write the implementation plan, tests, or production code until the user approves the specification.
- Write tests from approved acceptance criteria before implementation. A test may be intentionally red at first, but it must become meaningful and pass after implementation.
- Keep the specification, architecture, plan, tests, implementation, and documentation consistent. When one changes, inspect the downstream artifacts.
- Use the project's package manager and existing scripts. Do not install a new dependency merely to satisfy this workflow without approval.
- Before release operations, check for secrets, unrelated changes, generated artifacts, and accidental edits outside the worktree.
- Commit, push, and PR creation are separate release actions. Obtain explicit user approval immediately before performing them; never force-push.

## Workflow state and artifacts

Use the repository's established locations when they exist. Otherwise use these defaults:

- Brainstorm notes: `docs/specs/<feature>-brainstorm.md`, or the task/PR description for small changes.
- Architecture decision: `docs/architecture.md` (human readable), updated as boundaries change.
- Specification: `docs/specs/<feature>.md`.
- Implementation plan: `docs/plans/<feature>.md`.
- Tests: mapped to acceptance-criterion IDs where practical.
- Workflow log: stage status, review rounds, findings, decisions, and verification results.

Prefer durable documents for the architecture, specification, and plan when the change is large enough that another engineer will need to implement or review it. For a small change, the same information may be kept in the task or PR description, but still pass through every gate.

## Stage 0 — Enter an isolated worktree

1. Inspect the repository root, current branch, worktrees, status, recent conventions, and available package/test scripts.
2. If the current checkout has uncommitted work, do not mix it into the feature. Ask how to proceed or create the worktree from a clean, known base.
3. Create or enter a dedicated feature worktree and branch using the repository's naming convention. Confirm the shell is operating in that worktree before editing files.
4. Record the base commit, branch, worktree path, and intended change.
5. Create the workflow checklist. The checklist must show every stage in this document and the current review-round count.

If the user already provided a worktree, verify that it is the intended feature worktree rather than assuming it is safe.

## Stage 1 — Brainstorm

Understand the problem before choosing a solution.

Capture:

- The user problem and desired outcome.
- Users, callers, and affected systems.
- Current behavior and its limitations.
- Constraints, invariants, security/privacy concerns, and compatibility requirements.
- At least two plausible approaches when the design is not obvious.
- Trade-offs, risks, unknowns, and questions that require user input.
- A provisional success definition and likely acceptance criteria.

Search the codebase and current documentation before proposing new abstractions. Ask focused questions for decisions that materially affect behavior, compatibility, cost, security, or architecture. Do not turn unresolved assumptions into requirements.

## Stage 2 — Architecture

Select and explain the approach that best fits the repository.

Describe:

- Components/modules affected and their responsibilities.
- Public APIs, data models, schemas, state transitions, and error paths.
- Control flow and important sequence/interaction behavior.
- Persistence, migrations, caching, concurrency, and rollback behavior when relevant.
- Security boundaries, permissions, secrets, input validation, and observability.
- Extension points and how future implementations can be added without coupling core behavior.
- Testing seams and which behavior belongs in unit, integration, or end-to-end tests.
- Alternatives considered and why they were rejected.

Keep architecture decisions proportional to the change. Flag anything that would require a specification change or a human decision.

## Stage 3 — Write the specification

Write the specification to `docs/specs/<feature>.md`. It must be a testable specification in user and system terms. Include:

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

Stop and wait for explicit approval. Do not write the implementation plan or tests before approval. If the user requests changes, update the brainstorm, architecture, or specification as appropriate and repeat this gate. Record the approval and any conditions.

## Stage 5 — Write the implementation plan

After approval, write the ordered plan to `docs/plans/<feature>.md`. It must be concrete enough for another engineer to execute. For each task include:

- The relevant file, module, package, or configuration area.
- The behavior or invariant being added/changed.
- Dependencies and ordering constraints.
- The acceptance-criterion IDs covered.
- The test or verification that proves completion.

Separate foundational changes from integration and cleanup. Identify generated files, migrations, feature flags, rollback steps, and documentation updates. Keep the plan aligned with the approved scope; if it is no longer aligned, return to the appropriate earlier stage instead of quietly expanding scope.

## Stage 6 — Write tests first

Implement the tests before production code whenever the repository permits it.

- Map tests to acceptance criteria and requirements.
- Cover normal behavior, boundaries, invalid input, failures, security constraints, and compatibility behavior.
- Use the narrowest appropriate test level: unit tests for deterministic logic, integration tests for component boundaries, and end-to-end tests for real user journeys.
- Prefer real serializers, schemas, parsers, and boundaries over excessive mocks.
- Follow the repository's existing test framework and naming conventions.
- Run the new tests before implementation when useful and record the expected red state; do not weaken assertions just to obtain green.

If tests cannot be written first for a particular integration or UI constraint, document the reason and write the closest executable contract before coding.

## Stage 7 — Write the implementation

Implement only the approved behavior and the plan's tasks.

- Make the smallest coherent change that satisfies the tests.
- Preserve existing behavior outside the approved scope.
- Validate untrusted input at the correct boundary and return stable, actionable errors.
- Avoid speculative abstractions and unrelated refactors.
- Keep public names, schemas, migrations, and generated artifacts synchronized.
- Update tests when implementation reveals an approved edge case that was not expressible initially; if behavior changes, return to the specification gate.

## Stage 8 — Verification and tests

Run the project's complete relevant verification suite, not only the new tests. At minimum, use the repository's equivalents of:

- Formatting and linting.
- Type checking or static analysis.
- Unit tests.
- Relevant integration tests.
- End-to-end browser or system tests.
- Build/package checks and migration checks when applicable.

Review the diff and test output together. Check that each acceptance criterion has evidence, no test relies on accidental implementation details, and no unrelated files or secrets are included. Fix failures before advancing. Record exact commands and results in the workflow log.

## Stage 9 — Independent fresh-context review loop

Review the completed change from an independent fresh context. The reviewer must not rely on the implementer's unstated reasoning. Give it only the relevant request, approved specification, architecture, implementation plan, final diff, and verification results.

Use a maximum of **three review rounds**:

1. Ask for findings ordered by severity, missing requirements, incorrect assumptions, security/privacy issues, regressions, test gaps, maintainability concerns, and documentation gaps.
2. If there are no actionable findings, mark the review passed and continue.
3. If findings exist, classify each finding and loop back to the earliest appropriate stage:
   - Requirement or user-visible behavior issue → Brainstorm or Specification, then repeat the human review gate.
   - Architecture, boundary, migration, or API issue → Architecture and Implementation Plan; repeat the human gate if behavior or scope changes.
   - Missing or weak coverage → Tests first, then implementation and verification.
   - Implementation defect within approved behavior → Implementation, then verification.
   - Verification or release-process gap → Verification, then review.
   - Documentation-only issue → Documentation after the fix.
4. Re-run all affected tests and verification after fixes, then start the next fresh review round.
5. Record the round number, reviewer context, findings, fixes, and evidence.

Never exceed three rounds. If actionable disagreement or findings remain after round three, stop and ask the user to decide rather than continuing an unbounded loop.

## Stage 10 — Documentation updates

Once behavior and review findings are stable, update the documentation that users and maintainers rely on. The following three files are **always** updated to reflect the latest changes, regardless of change size:

- `docs/architecture.md` — human-readable architecture: components, boundaries, data/control flow, and decisions affected by this change.
- `README.md` — human-readable project overview, setup, usage, and examples affected by this change.
- `AGENTS.md` — a concise record of the latest changes so agents working in the repository stay oriented.

Then update the rest of the documentation set as needed:

- User guides, CLI/API references, and examples.
- Configuration, migration, release, and troubleshooting documentation.
- Changelog or release notes when the repository uses them.

Document the supported platforms, limitations, security behavior, and upgrade path. Keep examples executable or consistent with the implementation. Run documentation checks, links, generated-doc builds, or package checks that the repository provides.

## Stage 11 — Commit, push, and PR

Before release actions, show the user the final summary, changed-file list, verification evidence, review-round result, and any known limitations. Confirm that the worktree contains only intended changes.

With explicit user approval:

1. Review staged and unstaged diffs and recent commit-message conventions.
2. Stage only files belonging to this change; never include secrets, local settings, or unrelated user work.
3. Create a concise conventional commit when the repository uses conventional commits, describing why the change was made.
4. Push the feature branch to the expected remote. Never force-push or push directly to a protected default branch.
5. Open or update a pull request using the repository's supported tooling. Include the problem, solution, scope, tests/verification, review-round summary, documentation changes, migrations, and known risks.
6. Report the commit, branch, PR, and any remaining action required from the user.

If approval for any release action is absent, stop after preparing the exact proposed command or PR content. Do not infer permission to commit, push, merge, or deploy.

## Completion checklist

A change is complete only when:

- [ ] Work happened in the intended feature worktree.
- [ ] Brainstorm and architecture decisions are recorded (architecture in `docs/architecture.md`).
- [ ] The specification at `docs/specs/<feature>.md` was explicitly approved by the user.
- [ ] The implementation plan at `docs/plans/<feature>.md` maps tasks to acceptance criteria.
- [ ] Tests were written first or the exception was documented.
- [ ] Relevant formatting, linting, type, unit, integration, E2E, and build checks pass.
- [ ] Fresh-context review passed within three rounds, or unresolved findings were escalated.
- [ ] `docs/architecture.md`, `README.md`, and `AGENTS.md` are updated with the latest changes.
- [ ] Other documentation and release notes are updated as needed.
- [ ] The user approved commit/push/PR actions before they were performed.
- [ ] The commit and PR contain only intended changes and include verification evidence.
