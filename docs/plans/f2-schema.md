# F2 - Schema Implementation Plan

**Approved specification:** `docs/specs/f2-schema.md`
**Scope guardrail:** Implement only the common version-1 schema and shared validation policy. Do not add rule actions, compiler behavior, browser integration, persistence, CLI, runtime, telemetry, or network behavior.

## Ordered Tasks

### T1 - Add the workspace package

- **Files:** `packages/schema/package.json`, `packages/schema/tsconfig.json`, root `pnpm-lock.yaml`.
- **Behavior/Invariants:** Add an ESM `@rogatio/schema` package with explicit source/type and built/import exports. Declare exact Ajv `8.17.1` as a package runtime dependency; do not broaden install-script permissions.
- **Acceptance coverage:** F2-FR-001, F2-AC-016, F2-AC-017.
- **Verification:** Frozen install, package metadata inspection, package typecheck and build.

### T2 - Define common types, bounds, enumerations, and JSON Schema

- **Files:** `packages/schema/src/types.ts`, `packages/schema/src/limits.ts`, `packages/schema/src/schema.ts`.
- **Behavior/Invariants:** Model the approved root/project/group/rule matcher envelope, version `1`, strict additional-property rejection, documented collection/string/priority bounds, resource types, and methods. Keep action-specific fields out of F2.
- **Acceptance coverage:** F2-FR-002, F2-FR-003, F2-AC-001 through F2-AC-005 and F2-AC-010.
- **Verification:** Schema-focused tests and strict TypeScript checking.

### T3 - Implement origin, regex, and header policy helpers

- **Files:** `packages/schema/src/origins.ts`, `packages/schema/src/headers.ts`.
- **Behavior/Invariants:** Accept only explicit HTTP(S) origins; validate bounded case-sensitive ECMAScript regex patterns; expose frozen forbidden-header lists and case-insensitive request/response matching.
- **Acceptance coverage:** F2-FR-004, F2-FR-005, F2-FR-008, F2-AC-004, F2-AC-006, F2-AC-007, F2-AC-014.
- **Verification:** Unit tests for valid/boundary/invalid origins, regex syntax and case behavior, and header policy.

### T4 - Compile Ajv validation and semantic result APIs

- **Files:** `packages/schema/src/validation.ts`, `packages/schema/src/index.ts`.
- **Behavior/Invariants:** Compile draft-2020-12 schema with strict/all-errors/no-coercion/no-defaults/no-removal settings. Add stable semantic errors for duplicate IDs, empty effective origins, and total rule count. Expose typed boolean, detailed-result, assertion, schema, and compiled-validator APIs without mutating input.
- **Acceptance coverage:** F2-FR-006, F2-FR-007, F2-FR-009, F2-AC-008 through F2-AC-013 and F2-AC-015.
- **Verification:** Unit tests with arbitrary unknown values, deep-frozen input, duplicates, and project-wide bounds.

### T5 - Write and run tests first

- **Files:** `packages/schema/test/schema.test.ts`.
- **Behavior/Invariants:** Establish executable contracts before implementation for valid documents, failures, boundaries, semantic checks, non-mutation, and policy exports.
- **Acceptance coverage:** All F2 acceptance criteria except integration criteria.
- **Verification:** Run the new test file before production code and record the expected missing-module red state; rerun after implementation.

### T6 - Integrate build and root validation

- **Files:** `scripts/build.ts`, `scripts/validate.ts`, root `package.json` only if required by the package API.
- **Behavior/Invariants:** Build a non-empty ESM schema artifact with declared Ajv dependency, validate it by direct import, and include schema checks in root validation without weakening existing F1 checks.
- **Acceptance coverage:** F2-AC-016, F2-AC-017, F2-AC-018.
- **Verification:** `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm validate`.

### T7 - Final documentation and scope audit

- **Files:** `README.md`, `docs/architecture.md`, `AGENTS.md`, `docs/f2-workflow.md`.
- **Behavior/Invariants:** Mark F2 complete only after verification/review, document the package boundary and usage, record exact evidence and review findings, and confirm no future feature behavior entered the change.
- **Acceptance coverage:** F2-AC-018 and documentation/security requirements.
- **Verification:** `git diff --check`, generated-artifact/secret scan, clean intended-file review, and documentation consistency check.

### T8 - Independent review and release

- **Files:** Final diff and workflow log; no code unless review finds an approved in-scope defect.
- **Behavior/Invariants:** Complete one fresh-context GLM review (additional rounds only if actionable findings occur), rerun affected verification, then commit, push, update/create the PR, merge after required checks, and clean the worktree only after user confirmation.
- **Acceptance coverage:** Full specification and SDD completion checklist.
- **Verification:** Review report, CI checks, merged PR metadata, and local main synchronization.

## Generated and Local-Only Files

Do not commit `node_modules/`, package `dist/`, build manifests, coverage, Playwright output, browser binaries, caches, environment files, or secrets. The lockfile is source-controlled; the compiled build artifact is generated and ignored.
