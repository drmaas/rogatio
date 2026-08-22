# F3 - Compiler Implementation Plan

**Approved specification:** `docs/specs/f3-compiler.md`
**Scope guardrail:** Implement only the validated common matcher IR and stable compiler diagnostics. Do not add actions, matching execution, browser translation, permissions, persistence, CLI, runtime, telemetry, network behavior, or downstream package stubs.

## Ordered Tasks

### T1 - Add the workspace package boundary

- **Files:** `packages/compiler/package.json`, `packages/compiler/tsconfig.json`, `packages/compiler/vitest.config.ts`, root `pnpm-lock.yaml`.
- **Behavior/Invariants:** Add a private ESM `@rogatio/compiler` package with an explicit source/type and built/import export. Declare only `@rogatio/schema: workspace:*` as a product dependency.
- **Acceptance coverage:** F3-FR-001, F3-AC-012, F3-AC-013.
- **Verification:** Package metadata inspection, frozen install, and dependency-direction checks.

### T2 - Write compiler contracts as tests first

- **Files:** `packages/compiler/test/compiler.test.ts`, `test/fixtures/forbidden-direction.ts`.
- **Behavior/Invariants:** Establish golden output, origin normalization, canonical resource ordering, exact regex/method/priority preservation, source order, duplicate matcher identity, failure atomicity, stable diagnostics, purity, determinism, and absence of future behavior before production source exists. Update the negative fixture to reference a downstream package that must remain absent.
- **Acceptance coverage:** F3-AC-001 through F3-AC-011 and F3-AC-014.
- **Verification:** Run the focused test before implementation and record the expected missing-module red result.

### T3 - Implement the public IR and diagnostic types

- **Files:** `packages/compiler/src/types.ts`, `packages/compiler/src/diagnostics.ts`.
- **Behavior/Invariants:** Export the documented `NormalizedMatcher`, `MatcherOperation`, `CompilerDiagnostic`, `CompilerDiagnosticCode`, and discriminated `CompileResult` types. Keep output data-only and diagnostics stable.
- **Acceptance coverage:** F3-FR-003, F3-FR-004, F3-FR-009, F3-AC-002, F3-AC-009.
- **Verification:** Strict typecheck and contract tests.

### T4 - Implement validation mapping and deterministic compilation

- **Files:** `packages/compiler/src/compile.ts`, `packages/compiler/src/index.ts`.
- **Behavior/Invariants:** Invoke complete F2 validation, map issues to stable diagnostics, fail atomically, normalize and sort effective origins, order resource types canonically, preserve regex/method/priority semantics, preserve source operation order, avoid iterator/mutation/aliasing hazards, and return an invariant diagnostic for impossible post-validation failures.
- **Acceptance coverage:** F3-FR-002 through F3-FR-010, F3-AC-001 through F3-AC-011.
- **Verification:** Focused compiler tests, strict TypeScript, format, and lint.

### T5 - Integrate build and root validation

- **Files:** `scripts/build.ts`, `scripts/validate.ts`.
- **Behavior/Invariants:** Add a Node ESM compiler artifact with `@rogatio/schema` externalized, directly execute the emitted compiler module, check compiler/schema dependency direction, preserve all F1/F2 artifact and negative-fixture checks, and do not add browser bundling.
- **Acceptance coverage:** F3-FR-001, F3-FR-011, F3-FR-012, F3-AC-012 through F3-AC-014.
- **Verification:** `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm validate`.

### T6 - Synchronize documentation and audit scope

- **Files:** `README.md`, `docs/architecture.md`, `AGENTS.md`, `docs/f3-workflow.md`.
- **Behavior/Invariants:** Record released F2 and implemented F3 status, package boundaries, Node-only target, diagnostic/output contract, verification evidence, review findings, and explicit absence of F4+ behavior. Keep durable docs synchronized; retain no raw brainstorm output.
- **Acceptance coverage:** F3-AC-012 through F3-AC-014 and security/operational requirements.
- **Verification:** Documentation consistency review, `git diff --check`, generated-artifact/secret scan, and final scope audit.

### T7 - Independent review and release

- **Files:** Final diff and workflow log; no code unless review finds an approved in-scope defect.
- **Behavior/Invariants:** Complete fresh-context review within the three-round limit, rerun affected verification after any fix, then commit, push, create/update the PR, merge after required checks, and remove the worktree only after user confirmation.
- **Acceptance coverage:** Full specification and SDD completion checklist.
- **Verification:** Review report, CI checks, merged PR metadata, local main synchronization, and clean final worktree list.

## Generated and Local-Only Files

Do not commit `node_modules/`, package `dist/`, build manifests, coverage, Playwright output, browser binaries, caches, environment files, or secrets. The lockfile and durable F3 specification, plan, architecture, and workflow log are source-controlled.
