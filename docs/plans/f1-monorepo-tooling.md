# F1 Implementation Plan - Monorepo and Tooling Bootstrap

**Plan model:** `opencode-go/glm-5.3`
**Specification:** `docs/specs/f1-monorepo-tooling.md`
**Inputs:** `opencode-go/gpt-5.6-luna` primary brainstorm and `opencode-go/minimax-m3` adversarial brainstorm
**Status:** Draft implementation plan for F1 only
**Scope guardrail:** No F2-F20 product behavior, no schema/compiler code, no native runtime, no release publishing, telemetry, hosted services, credentials, or traffic capture. No modifications to `docs/specs/`.

## 0. Preflight and Worktree Isolation

### T1 - Preflight verification and G1 resolution

- **Files:** None modified. Record G1 decision (exact TypeScript 7 patch) for T4 and T12.
- **Behavior/Invariants:** Verify the repository is planning-only: clean `git status`, no root `package.json`, `pnpm-lock.yaml`, or `node_modules`; only docs and planning files exist. Resolve Gate G1: query the npm registry for a validated TypeScript 7 release, confirm it compiles a trivial strict NodeNext ESM sample, and record the exact version. Do not substitute another major.
- **Depends on:** Nothing.
- **Covers:** F1-FR-004 (prerequisite recording), F1-AC-005, F1-AC-021.
- **Verification:** Capture the baseline file list and selected TypeScript version in the F1 PR description; the sample compile exits 0.

### T2 - Worktree isolation

- **Files:** None in the main checkout.
- **Behavior/Invariants:** All F1 implementation work happens in an isolated worktree, for example `git worktree add ../rogatio-f1 -b feature/f1-monorepo-tooling`. The main checkout remains untouched until merge. Preserve the existing uncommitted `.agents/skills/doit/SKILL.md` change as unrelated user work.
- **Depends on:** T1.
- **Covers:** Process isolation for all F1 requirements.
- **Verification:** The feature worktree is confirmed with `git status`; the main checkout shows no F1 files.

## 1. Foundational Configuration

### T3 - Root workspace and package-manager configuration

- **Files:** `package.json`, `pnpm-workspace.yaml`, generated `pnpm-lock.yaml`, `.gitignore`, `.editorconfig`, `.node-version`.
- **Behavior/Invariants:** Root `package.json` declares `private: true`, `type: module`, `packageManager: pnpm@10.32.1`, `engines.node: >=24`, and exact-pinned development dependencies. There are no production dependencies at the root. The workspace is `packages/*`. `.node-version` contains `24`. Retain pnpm 10's default lifecycle-script blocking; do not add broad install-script permissions without a documented review. `.gitignore` covers dependencies, build output, coverage, Playwright reports/results, environment files, and local OS state. `.editorconfig` enforces LF, UTF-8, and a final newline.
- **Depends on:** T2 and resolved G1.
- **Covers:** F1-FR-001, F1-FR-002, F1-FR-003, F1-FR-013; F1-AC-001, F1-AC-020, F1-AC-021, F1-AC-022, F1-AC-026.
- **Verification:** From a fresh feature worktree, `corepack enable` followed by `pnpm install --frozen-lockfile` succeeds after the lockfile is committed. A deliberate lockfile mutation makes frozen installation fail; restore the lockfile afterward for evidence of F1-AC-015.

### T4 - TypeScript 7 configuration

- **Files:** `tsconfig.base.json`, `tsconfig.json`.
- **Behavior/Invariants:** The base configuration enables `strict`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`, `verbatimModuleSyntax`, `isolatedModules`, `noEmit`, and consistent filename casing. The root configuration includes scripts, test helpers, browser tests, and package source/tests while excluding negative fixtures and generated output. Do not introduce project references until real package dependency graphs exist. Use the exact G1 TypeScript pin.
- **Depends on:** T3.
- **Covers:** F1-FR-004, F1-FR-007, F1-FR-014; F1-AC-005, F1-AC-030.
- **Verification:** `pnpm typecheck` exits 0 on bootstrap source. A temporary type error makes it exit nonzero; revert the probe.

### T5 - Biome formatting and linting

- **Files:** `biome.json`, `.biomeignore`.
- **Behavior/Invariants:** Configure separate observable format and lint checks with minimal overrides. Do not add suppressions to bootstrap source. Ignore generated output and negative fixtures when those fixtures are intentionally invalid inputs rather than style targets.
- **Depends on:** T3.
- **Covers:** F1-FR-007, F1-FR-008; F1-AC-003, F1-AC-004, F1-AC-010, F1-AC-031.
- **Verification:** `pnpm format:check` and `pnpm lint` pass on formatted source. A temporary formatting defect makes `pnpm format:check` fail; revert the probe.

## 2. Sanity Packages and Smoke Fixtures

The implementation uses two non-domain packages, `smoke` and `sanity`, only to prove workspace resolution and an emitted cross-package import. Do not create future product package stubs or product APIs.

### T6 - Workspace packages `smoke` and `sanity`

- **Files:** `packages/smoke/package.json`, `packages/smoke/src/index.ts`, `packages/sanity/package.json`, `packages/sanity/src/index.ts`, `packages/sanity/test/`, and per-package TypeScript/script configuration.
- **Behavior/Invariants:** `@rogatio/smoke` exports only a trivial non-domain function. `@rogatio/sanity` declares `@rogatio/smoke` as a `workspace:*` production dependency and composes it through an explicit package entry point. Both packages provide typecheck, test, and build scripts. Relative imports use `.js` extensions where required by NodeNext. No domain APIs or future product packages are created.
- **Depends on:** T3 and T4.
- **Covers:** F1-FR-005, F1-FR-006, F1-FR-007, F1-FR-016; F1-AC-002, F1-AC-022.
- **Verification:** `pnpm --filter @rogatio/sanity test` runs only sanity tests. `pnpm typecheck` resolves the declared cross-package import. Removing the declared dependency makes typechecking fail; restore it afterward.

### T7 - Vitest smoke suite

- **Files:** `vitest.config.ts`, `packages/sanity/test/smoke.test.ts`.
- **Behavior/Invariants:** Keep root Vitest configuration thin with a Node environment, package test inclusion, and `passWithNoTests: false`. Do not force a browser environment onto Node tests. Assert the real composed package behavior and execute at least one emitted cross-package ESM import after the build step. The root test script builds before tests so emitted output exists deterministically.
- **Depends on:** T6 and T8.
- **Covers:** F1-FR-007, F1-FR-010; F1-AC-007, F1-AC-017, F1-AC-018, F1-AC-027.
- **Verification:** `pnpm test` exits 0 and reports at least one executed test. A temporary test-pattern change that matches nothing must fail; revert the probe.

### T8 - esbuild build pipeline

- **Files:** `scripts/build.ts`; generated `packages/smoke/dist/node/index.js`, `packages/smoke/dist/browser/index.js`, and a build manifest.
- **Behavior/Invariants:** Use a Node-based esbuild API script rather than a custom build framework. Produce explicit Node ESM and browser ESM targets from the smoke package. Assert that both artifacts exist, are non-empty, have the expected module format, and are represented in a reproducibility manifest. Missing or malformed output fails the build.
- **Depends on:** T6.
- **Covers:** F1-FR-009, F1-FR-013, F1-FR-014; F1-AC-006, F1-AC-013, F1-AC-017, F1-AC-019, F1-AC-020, F1-AC-029.
- **Verification:** `pnpm build` exits 0 with expected artifacts. Deleting a required artifact before a verification run produces a named failure. Two clean builds produce equivalent manifest hashes. `git check-ignore` confirms generated artifacts are ignored.

### T9 - Validation script and negative fixtures

- **Files:** `scripts/validate.ts`, invalid-type fixture, undeclared-import fixture, forbidden-direction fixture, and shared test helpers.
- **Behavior/Invariants:** Run labeled, fail-fast stages for format, lint, typecheck, build, Vitest, boundary validation, negative-fixture checks, artifact/ignore checks, and the Playwright stage. Scan workspace manifests and source imports for undeclared workspace imports and forbidden dependency direction without adding a heavy dependency-policy tool. Keep invalid fixtures outside the main typecheck and Biome inputs. The validator must verify that each negative fixture fails for the intended reason; passing unexpectedly is a validation failure.
- **Depends on:** T4, T5, T7, and T8.
- **Covers:** F1-FR-007, F1-FR-014, F1-FR-015; F1-AC-004, F1-AC-011, F1-AC-012, F1-AC-016, F1-AC-027, F1-AC-028, F1-AC-030, F1-AC-031.
- **Verification:** `pnpm validate` exits 0 end-to-end when browser prerequisites are installed. Temporarily changing a negative fixture so it no longer fails makes the validator fail; restore the fixture.

## 3. Browser Test Bootstrap

### T10 - Playwright configuration and smoke journey

- **Files:** `playwright.config.ts`, `test/browser/smoke.spec.ts`, browser fixture, `scripts/serve-smoke.ts`, and browser prerequisite helper.
- **Behavior/Invariants:** Configure a Chromium-only Playwright project. Verify the browser executable exists and throw an actionable installation error rather than silently skipping. Use a repository-owned dependency-free static server bound to `127.0.0.1` to serve the browser artifact and fixture. The smoke page loads the browser build as a module and the test asserts the real browser execution result. Keep this as tooling verification, not product behavior.
- **Depends on:** T8 and T9.
- **Covers:** F1-FR-011, F1-FR-009; F1-AC-008, F1-AC-014, F1-AC-028.
- **Verification:** After the documented Chromium installation, `pnpm test:browser` passes with an executed test. With an empty Playwright browser path, it fails with the documented installation command.

## 4. Continuous Integration

### T11 - GitHub Actions baseline workflow

- **Files:** `.github/workflows/checks.yml`.
- **Behavior/Invariants:** Implement the baseline sequence with named stages: checkout, Node setup, pnpm setup, frozen install, format, lint, typecheck, build, Vitest, and browser validation according to G2-G4. Use lockfile-keyed dependency caches and a separate browser job if G3 selects that option. Add cross-platform verification according to G4. Do not publish, use secrets, or perform privileged operations. Action references follow the selected repository pinning policy.
- **Depends on:** T3-T10 and resolved G2, G3, and G4.
- **Covers:** F1-FR-012, F1-FR-014; F1-AC-001, F1-AC-009, F1-AC-023, F1-AC-025, F1-AC-031.
- **Verification:** Capture a green branch workflow run using the pinned toolchain. A temporary type error must fail at the typecheck stage; revert the probe. Confirm no globally installed tools are used.

## 5. Documentation

### T12 - README, architecture, and AGENTS updates

- **Files:** `README.md`, `docs/architecture.md`, `AGENTS.md`.
- **Behavior/Invariants:**
  - `README.md` documents the project status, prerequisites, frozen install, Playwright browser setup, root scripts, package boundaries, supported environments, and install-script policy.
  - `docs/architecture.md` documents repository layout, the toolchain compatibility matrix, NodeNext conventions, dependency layers and enforcement, generated-artifact policy, CI topology, and G1-G4 decisions.
  - `AGENTS.md` records the latest bootstrap rules: run `pnpm validate`, never commit generated files, exact-pin and review new dependencies, do not broaden install-script permissions without documentation, use NodeNext `.js` extensions, preserve layer and undeclared-import checks, and keep F1 free of product behavior.
- **Depends on:** T11 and G1-G4 decisions.
- **Covers:** F1-FR-003, F1-FR-015; F1-AC-001, F1-AC-025, F1-AC-026.
- **Verification:** Review every documented command against the specification and execute each command at least once verbatim.

## 6. Final Hardening and Evidence

### T13 - End-to-end verification and failure evidence

- **Files:** No additional source-controlled files; evidence is recorded in the PR description and CI links.
- **Behavior/Invariants:** From a clean secondary clone, capture frozen install, full validation, intentional failures for formatting, invalid types, undeclared imports, forbidden direction, missing build artifact, lockfile mismatch, and missing Playwright browser, repeat-build equality, green CI, scope review, and a clean status without generated files. Confirm no `.rogatio.json`, extension manifest, native proxy/TLS code, telemetry, credentials, hosted endpoints, or release automation entered the change.
- **Depends on:** All prior tasks.
- **Covers:** F1-FR-016 and remaining evidence for all acceptance criteria.
- **Verification:** Complete a PR checklist with evidence for every criterion and record reviewer confirmation.

## 7. Decision Gates

- **G1 - Exact TypeScript 7 patch, blocking before T4:** Select and validate one exact TypeScript 7 release. Record it in `package.json`, the lockfile, and the architecture compatibility matrix. If compatibility fails, stop and surface the decision; never silently substitute another major.
- **G2 - Actions pinning policy, before T11:** Choose immutable commit-SHA pinning or pinned release versions. Prefer commit-SHA pinning with version comments and record the policy in `docs/architecture.md` and `AGENTS.md`.
- **G3 - Playwright CI placement, before T11:** Choose a mandatory separate browser job or an explicitly documented local-only/browser-specific job. Prefer a separate mandatory browser job with cached Chromium so the browser contract is tested without slowing the base job.
- **G4 - Cross-platform matrix, before T11:** Choose full per-change verification or Ubuntu-per-change plus scheduled/manual Windows and macOS verification. Record the selected policy and provide supported-OS evidence without claiming more coverage than CI actually supplies.

All four decisions are recorded in `docs/architecture.md` and the F1 PR description.

## 8. Generated Files

Never commit `node_modules/`, package `dist/` output, coverage, Playwright reports/results, environment files, browser binaries, or the pnpm store. Verify ignore rules with `git check-ignore`. Commit only source, configuration, lockfile, fixtures, and documentation.

## 9. Rollback and Cleanup Boundaries

- Before merge, remove only the isolated feature worktree and branch after confirming with the user; never use destructive cleanup in the main checkout.
- Review any ignored-artifact cleanup before running it and follow the repository rule to prompt before deleting files or directories.
- Post-merge rollback is a `git revert`; there are no data migrations, published artifacts, or external state changes in F1.
- If G1 changes after bootstrap, update the version, lockfile, and compatibility matrix together.
- Do not edit or delete `docs/specs/`, `sequence.md`, or `rogatio-overview.md` as part of F1 implementation.

## 10. Task Dependency Summary

```text
T1 (preflight + G1)
  -> T2 (worktree)
      -> T3 (workspace) -> T4 (TypeScript) -> T6 (packages) -> T8 (build) -> T7 (Vitest)
                       -> T5 (Biome) -------------------------> T9 (validation)
                                                               -> T10 (Playwright)
T3-T10 + G2/G3/G4 -> T11 (CI) -> T12 (docs) -> T13 (hardening/evidence)
```

The critical path is T1 -> T2 -> T3 -> T6 -> T8 -> T9 -> T10 -> T11 -> T12 -> T13. T4 and T5 can proceed in parallel after T3; T7 finalizes after T8.
