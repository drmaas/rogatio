# F2 Workflow Log

## Scope and Approval

- **Feature:** F2 - `schema` package
- **Base commit:** `a7c90b7`
- **Branch:** `feature/f2-schema`
- **Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-f2`
- **Implementation authorization:** The user's sequential F1/F2/F3 request authorizes implementation, subject to the SDD specification approval gate.
- **Release authorization:** The user explicitly authorized commit, push, pull request, merge, and worktree cleanup for F1, F2, and F3. Worktree deletion was confirmed immediately before removing the F2 worktree.

## Stage Status

- [x] Stage 0 - isolated worktree and model availability preflight
- [x] Stage 1 - primary and adversarial brainstorming; raw outputs remain ephemeral
- [x] Stage 2 - architecture synthesis in `docs/architecture.md`
- [x] Stage 3 - proposed specification in `docs/specs/f2-schema.md`
- [x] Stage 4 - human approval for implementation scope; approved by the user in this session
- [x] Stage 5 - implementation plan in `docs/plans/f2-schema.md`
- [x] Stage 6 - tests first; schema tests were written before implementation
- [x] Stage 7 - implementation
- [x] Stage 8 - verification and evidence
- [x] Stage 9 - independent fresh-context review; rounds completed: 3 of 3
- [x] Stage 10 - documentation updates after behavior stabilizes
- [x] Stage 11 - release actions

## Model Roles

- Luna (`opencode-go/gpt-5.6-luna`): primary brainstorm, architecture/specification synthesis, tests, and implementation.
- Minimax M3 (`opencode-go/minimax-m3`): adversarial brainstorm.
- GLM 5.3 (`opencode-go/glm-5.3`): implementation plan and independent review.
- Hy3 (`opencode-go/hy3`): verification and documentation.
- Model availability was verified at workflow start with `opencode models opencode-go`; no fallback was needed.

## Brainstorm Synthesis

The primary proposal was a strict `@rogatio/schema` package with a draft-2020-12 schema, an Ajv-compiled validator, typed helpers, origin/regex formats, and shared policy constants. The adversarial pass identified the main risks as inventing action semantics too early, accepting origin patterns that become broad browser permissions, relying only on JSON Schema for cross-record invariants, mutating caller data through Ajv defaults/coercion, and exposing mutable policy arrays.

Two alternatives were considered:

- A custom validator would make semantic checks easy but would duplicate JSON Schema tooling and leave later consumers without a standard schema artifact. Rejected.
- A standalone generated Ajv validator would reduce runtime compilation but would add a code-generation artifact and synchronization workflow before the package contract is stable. Deferred; F2 uses a strict compiled validator at module initialization and exposes the schema.

The chosen boundary validates only the common matcher envelope. Action-specific schemas and behavior remain with later vertical slices, while unknown properties are rejected so they cannot be mistaken for supported actions.

## Architecture Decisions

- The package is a runtime dependency boundary: Ajv belongs in `packages/schema`, not as an undeclared root-only dependency.
- Structural validation uses Ajv draft 2020-12 with all errors, strict mode, no coercion, no defaults, and no removal of additional properties.
- Semantic checks run after Ajv for globally unique IDs, effective origins, and total rule count; errors retain stable JSON-pointer paths.
- Origins are explicit HTTP(S) origins rather than host-permission patterns; wildcard and path-bearing values are rejected.
- Common limits and forbidden-header policies are exported from one package and frozen at runtime.

## Approval Gate

The implementation plan, tests, and production code must not be written until the user explicitly approves `docs/specs/f2-schema.md` and the architecture decisions above.

Approval recorded: the user selected "Approve and continue" for the F2 schema specification and architecture decisions. The approved implementation plan is `docs/plans/f2-schema.md`.

Tests-first evidence: after adding only package metadata and the lockfile, `pnpm exec vitest run packages/schema/test/schema.test.ts` executed the new suite and failed at the missing `../src/index.js` implementation import. No schema production code existed at that point; the red result was expected.

## Implementation Evidence

- Added the private ESM `@rogatio/schema` workspace package with exact runtime dependency `ajv@8.17.1`.
- Added the draft-2020-12 common project schema, typed constants, documented bounds, origin and regex formats, and frozen forbidden-header policies.
- Added strict, non-mutating Ajv validation plus semantic checks for globally unique IDs, effective origins, and the project-wide rule limit.
- Added JSON-shaped input hardening for inherited root/object properties, sparse or inherited array entries, cycles, and overrideable collection iterators. The exported structural validator and detailed validation API use the same guard.
- Integrated a Node ESM schema artifact into the existing root build and direct emitted-module validation without adding compiler, browser, editor, extension, CLI, runtime, telemetry, or network behavior.

## Verification Evidence

Final `pnpm validate` passed in this worktree:

- `pnpm install --frozen-lockfile` passed.
- Format and lint checks passed across 33 files.
- Strict TypeScript typecheck passed.
- Root build emitted and checked four ESM artifacts.
- Vitest passed 16 tests across three files, including 14 schema tests.
- The three negative TypeScript fixtures failed with their expected diagnostics.
- The Chromium Playwright smoke test passed (1 test).

## Independent Review

- **Round 1:** Found runtime-compiled Ajv/MV3 boundary risk, permissive origin spellings, inherited root properties, and stale documentation. Fixed the origin lexical checks and credential rejection, enabled Ajv own-property validation, added regression tests and schema artifact checks, and documented the approved Node-only F2 target with MV3 standalone packaging deferred.
- **Round 2:** Found sparse arrays with inherited indices could bypass Ajv own-property validation. Added a cycle-safe dense-array/own-entry precheck and regression coverage.
- **Round 3:** Initially found overrideable array iterators in semantic validation and an exported-validator bypass. Replaced iterator-based traversal with indexed access, guarded the exported validator, added iterator/direct-validator coverage, reran verification, and received a PASS. No actionable scope, dependency, generated-file, secret, or F3-leakage findings remain.

## Release Evidence

- Commit `f81f2ad` (`feat(f2): add schema validation package`) was pushed in `feature/f2-schema` through PR #2.
- PR #2 (`https://github.com/drmaas/rogatio/pull/2`) passed its required checks and merged into `main` as `87f96a2c48e1b7a967c24e5604df4308365a50b1`.
- The F2 worktree was removed after confirmation and its local feature branch was deleted.
