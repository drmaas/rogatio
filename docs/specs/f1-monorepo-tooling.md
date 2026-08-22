# F1 - Monorepo and Tooling Bootstrap

**Synthesis model:** `opencode-go/gpt-5.6-luna`
**Inputs:** `opencode-go/gpt-5.6-luna` primary brainstorm and `opencode-go/minimax-m3` adversarial brainstorm
**Status:** Synthesized specification
**Feature:** F1
**Depends on:** None
**Enables:** F2 and all subsequent features

## Problem Statement and Goals

Rogatio is currently a planning-only repository. Later features require independently testable packages, explicit dependency boundaries, reproducible builds, strict TypeScript behavior, browser and Node tooling, and CI validation.

F1 establishes the repository foundation without implementing product behavior.

Goals:

- Create a pnpm workspace using pnpm `10.32.1`.
- Establish strict TypeScript 7 with ESM and NodeNext-compatible conventions.
- Provide Biome formatting and linting.
- Provide explicit esbuild build scripts.
- Provide Vitest unit-test infrastructure.
- Configure Playwright for later browser tests.
- Add baseline GitHub Actions validation.
- Define package boundaries and dependency direction.
- Prove the foundation with non-empty, observable smoke tests.

## Scope

F1 includes:

- Root workspace and package-manager configuration.
- Minimum package placeholders required to prove workspace resolution and dependency direction.
- Shared TypeScript, Biome, Vitest, Playwright, and esbuild configuration.
- Node-based repository scripts where cross-platform orchestration is required.
- Smoke fixtures and tests for type-checking, ESM execution, workspace imports, builds, Vitest, and Playwright setup.
- Root and package-level validation scripts.
- Frozen-lockfile CI validation.
- Documentation of supported versions, prerequisites, and script responsibilities.
- Ignoring generated output and local tooling state.

F1 does not implement domain behavior.

## Explicit Non-Goals

F1 must not implement:

- The version-1 JSON Schema or AJV validation behavior.
- Compiler operations, diagnostics, or rule semantics.
- Browser-core persistence, migrations, permissions, enablement, or runtime state.
- Editor views, controllers, or product workflows.
- Chrome manifests, extension permissions, DNR rules, or extension behavior.
- CLI commands such as `edit`, `verify`, or `runtime`.
- Native messaging, TLS, proxy, PAC, or runtime installation.
- Product traffic capture, request transformation, or body handling.
- Release publishing, semantic-release, package distribution, or version automation.
- Telemetry, hosted services, accounts, cloud sync, or credential handling.
- Documentation-site implementation.
- A custom internal tooling framework.
- Premature domain APIs or complete future-package stubs solely to demonstrate structure.

## Actors, Entry Points, and Supported Environments

### Actors

- Developers running local checks and builds.
- Contributors installing dependencies from a fresh checkout.
- CI runners validating pull requests.
- Future release automation consuming the established scripts.

### Entry Points

- `pnpm install --frozen-lockfile`
- Root package scripts for format, lint, type-check, test, build, and validation.
- Package-level scripts for package-local checks.
- GitHub Actions workflow under `.github/workflows/`.

### Supported Environments

- Node.js `24+`; F1 formally tests Node 24 in CI.
- pnpm `10.32.1`.
- Linux, Windows, and macOS development environments.
- Chrome as the current browser target for future Playwright work.
- Playwright headless execution where the required browser is installed.

F1 claims compatibility only for the tested Node 24 baseline and documented tool versions. It does not claim compatibility with future Node majors.

## Resolved Architecture and Tooling Decisions

### Repository Layout

```text
.github/
  workflows/
    checks.yml

packages/
  sanity/
    src/
    test/
    package.json

test/
  fixtures/
  helpers/

scripts/
  build.ts
  validate.ts

.biomeignore
.editorconfig
.gitignore
biome.json
package.json
playwright.config.ts
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
tsconfig.json
vitest.config.ts
```

Only a dedicated `sanity` package is required for F1. Future package directories remain documented boundaries rather than empty product stubs.

The future package boundaries are:

- `schema`
- `compiler`
- `browser-core`
- `editor`
- `extension`
- `runtime`
- `cli`

### Dependency Direction

The intended direction is:

```text
schema
  |
compiler
  |
browser-core / editor / runtime
  |
extension / cli
```

F1 enforces only the demonstrable rule that the sanity package may not introduce undeclared workspace imports or circular dependencies. It does not invent domain APIs or add a heavy dependency-policy tool.

### Package Manager

- `packageManager` is exactly `pnpm@10.32.1`.
- `pnpm-workspace.yaml` defines the workspace.
- `pnpm-lock.yaml` is committed.
- CI uses `pnpm install --frozen-lockfile`.
- The repository documents the install-script policy. Only dependencies required by the selected tooling may run install scripts; broad script allowances are prohibited.

### Runtime and Module System

- Root and packages use ESM through `"type": "module"`.
- TypeScript uses `module: "NodeNext"` and `moduleResolution: "NodeNext"`.
- Strict checking is enabled.
- Relative TypeScript imports follow NodeNext runtime conventions, including emitted `.js` extensions where required.
- Package metadata uses explicit `exports` for any importable package entry point.
- A real emitted cross-package ESM import is executed during verification.

### TypeScript

- TypeScript major version 7 is intentional and must not be substituted.
- The lockfile and package manifest pin one exact TypeScript 7 version.
- The exact patch version is an implementation prerequisite and must be recorded before bootstrap work begins.
- CI runs the pinned compiler rather than a globally installed compiler.

### Build

- esbuild is used for reproducible entry-point builds.
- Build configuration is explicit per target.
- F1 verifies at least one Node-targeted ESM build and one browser-targeted build.
- Build scripts assert that expected artifacts exist and are ignored by Git.
- No custom build framework is introduced.

### Formatting and Linting

- Biome is configured at the repository root.
- Formatting and linting are separate observable checks.
- Configuration is shared only where behavior is genuinely common.
- Package-specific exceptions must be explicit and minimal.

### Tests

- Vitest provides a non-empty smoke suite.
- Root configuration remains thin and does not force a browser environment onto Node tests.
- Package-specific environments remain available.
- Playwright is configured for future browser tests and includes a documented browser-install path.
- A Playwright smoke test launches a browser when prerequisites are available; missing prerequisites produce a clear setup failure rather than a skipped success.

### CI

A baseline workflow performs:

1. Checkout.
2. Supported Node setup.
3. pnpm `10.32.1` setup.
4. Frozen-lockfile installation.
5. Biome format check.
6. Biome lint check.
7. Strict TypeScript check.
8. Build.
9. Vitest tests.
10. Optional Playwright smoke validation according to the documented prerequisite policy.

Actions must use an explicit repository policy for version pinning. If immutable commit-SHA pinning is not yet repository policy, action versions must at least be pinned rather than floating major tags.

## Functional Requirements

- **F1-FR-001:** The repository shall declare pnpm `10.32.1` in `package.json`.
- **F1-FR-002:** The repository shall define a pnpm workspace and commit a generated lockfile.
- **F1-FR-003:** The repository shall declare a Node.js `24+` engine requirement and document the tested Node 24 baseline.
- **F1-FR-004:** The repository shall pin an exact TypeScript 7 version and use strict NodeNext ESM configuration.
- **F1-FR-005:** The repository shall provide a workspace package with an explicit package name, entry point, exports, scripts, and dependencies.
- **F1-FR-006:** A smoke package shall import another workspace entry point through a declared dependency rather than an undeclared transitive dependency.
- **F1-FR-007:** The repository shall provide root and package-level scripts for formatting, linting, type-checking, testing, and building.
- **F1-FR-008:** Biome shall provide repository formatting and linting configuration.
- **F1-FR-009:** esbuild shall produce verified Node and browser bootstrap artifacts using explicit target settings.
- **F1-FR-010:** Vitest shall execute a real smoke assertion and report a nonzero executed-test count.
- **F1-FR-011:** Playwright shall provide a documented configuration and browser prerequisite/install path.
- **F1-FR-012:** The repository shall provide a GitHub Actions workflow implementing the baseline CI sequence.
- **F1-FR-013:** Generated build output, coverage, caches, installed dependencies, and local environment files shall be ignored and absent from the committed change.
- **F1-FR-014:** Repository scripts required by CI shall run on Linux, Windows, and macOS without Bash-only assumptions.
- **F1-FR-015:** The repository shall document package boundaries, dependency direction, supported versions, install policy, and script responsibilities.
- **F1-FR-016:** F1 artifacts shall contain no product behavior or implementation from F2-F20.

## Observable Acceptance Criteria

### Happy Paths

- **F1-AC-001:** A fresh checkout with Node 24 and pnpm `10.32.1` completes `pnpm install --frozen-lockfile`.
- **F1-AC-002:** The workspace resolves the sanity package and its declared workspace dependency.
- **F1-AC-003:** `pnpm format:check` succeeds on formatted bootstrap source.
- **F1-AC-004:** `pnpm lint` succeeds without unreviewed suppressions.
- **F1-AC-005:** `pnpm typecheck` succeeds with strict TypeScript 7 NodeNext settings.
- **F1-AC-006:** `pnpm build` creates the expected Node and browser artifacts and verifies their formats.
- **F1-AC-007:** `pnpm test` executes at least one Vitest assertion and reports a nonzero test count.
- **F1-AC-008:** The Playwright smoke path launches a configured browser when browser prerequisites are installed.
- **F1-AC-009:** CI runs the same frozen install and validation commands successfully.

### Boundaries and Failures

- **F1-AC-010:** Intentionally unformatted source causes the format check to fail.
- **F1-AC-011:** An invalid TypeScript fixture causes strict type-checking to fail.
- **F1-AC-012:** An undeclared package import fails validation or type-checking.
- **F1-AC-013:** A missing expected build artifact causes the build check to fail.
- **F1-AC-014:** A missing Playwright browser reports an actionable prerequisite failure and is not reported as a successful test run.
- **F1-AC-015:** A lockfile mismatch causes frozen installation to fail.
- **F1-AC-016:** A package attempting a forbidden dependency-direction import fails the documented boundary check.

### ESM and Reproducibility

- **F1-AC-017:** Emitted Node output executes successfully under Node 24.
- **F1-AC-018:** The smoke test performs a real emitted cross-package ESM import.
- **F1-AC-019:** Repeating the build from a clean install produces equivalent expected artifacts.
- **F1-AC-020:** Build output and test coverage are ignored and are not committed.

### Security and Supply Chain

- **F1-AC-021:** Build-critical dependency versions are exact or governed by an explicit compatibility policy.
- **F1-AC-022:** Production and development dependencies are separated.
- **F1-AC-023:** CI uses a frozen lockfile and does not depend on globally installed tools.
- **F1-AC-024:** No credentials, secrets, telemetry, hosted endpoints, arbitrary binary downloads, or traffic-capture mechanisms are introduced.
- **F1-AC-025:** GitHub Actions references follow the repository's explicit pinning policy.
- **F1-AC-026:** Dependency install scripts are not broadly enabled without review.

### False-Green Protection

- **F1-AC-027:** The test command fails if no smoke tests execute.
- **F1-AC-028:** Browser prerequisites are verified rather than silently skipping browser execution.
- **F1-AC-029:** Build success requires artifact existence and expected output format.
- **F1-AC-030:** Type-checking runs with strict settings and cannot pass by suppressing the invalid-type fixture.
- **F1-AC-031:** CI executes format, lint, type-check, build, and tests rather than only installing dependencies.

## API, CLI, UI, File-Format, and Compatibility Impact

- **Public API:** None.
- **Product CLI:** None. F1 does not implement `edit`, `verify`, or `runtime`.
- **UI:** None.
- **Product file format:** None. F1 does not define `.rogatio.json`.
- **Package API:** Only bootstrap entry points needed for workspace smoke verification are established.
- **Compatibility:** New repository and tooling baseline only. No migration of existing product consumers is required.
- **Release behavior:** None.

## Non-Functional Requirements

### Security and Privacy

- Dependencies must be reviewable and lockfile-controlled.
- No credentials or persistent user data may be introduced.
- F1 must not collect traffic, telemetry, or analytics.
- Scripts must avoid arbitrary network access beyond package installation and documented tool prerequisites.

### Performance

- Root validation must remain practical for local development.
- CI caches, if used, must be keyed by the lockfile and toolchain versions.
- No optimization or coverage threshold is required beyond proving real execution.

### Accessibility

F1 has no product UI. Tooling documentation must remain readable in standard terminal and Markdown environments.

### Operations

- CI failures must identify the failing validation stage.
- Required local prerequisites and browser installation commands must be documented.
- Generated artifacts must be deterministic enough to inspect and compare.
- Supported OS limitations must be documented rather than inferred from Linux-only CI.

## Migration, Rollout, and Backward Compatibility

The repository is greenfield and planning-only. No migration is required.

Rollout consists of adding the bootstrap configuration, sanity package, smoke fixtures, documentation, lockfile, and CI workflow in one foundational change. Later features must consume the established package boundaries and scripts rather than replacing them.

No backward compatibility with pre-F1 repository structure is required.

## Assumptions

- TypeScript 7 is intentional.
- Node 24 is the tested baseline; `Node 24+` remains the declared minimum.
- Chrome is the current browser target.
- The repository will use a package-oriented workspace without a shared internal tooling package initially.
- The exact TypeScript 7 patch version will be selected and pinned before implementation.
- Playwright browser binaries may be installed separately from dependency installation.
- Full cross-platform CI on every change is not required to approve F1, but scripts must avoid known platform-specific assumptions and supported OS verification evidence must be provided.
- Future packages will define their own domain APIs after F1.

## Open Questions

- Which exact TypeScript 7 patch version is the validated baseline?
- Should CI use immutable GitHub Actions commit-SHA pinning, or is pinned release-version policy sufficient?
- Should Playwright launch be part of the mandatory default CI job or a separate browser job?
- Should CI include a Windows and macOS matrix immediately, or use scheduled/selected cross-platform validation?
- Which dependency-update automation, if any, should be adopted?
- Should TypeScript project references be introduced after F1 when real package dependency graphs exist?
- Should future tests be colocated or use package-level test directories?
- What exact Chrome version policy will apply to later browser testing?

## Expected Verification Evidence

The implementation should provide:

- `package.json` showing the exact package-manager declaration, Node engine, scripts, and dependency classification.
- `pnpm-workspace.yaml`.
- Committed `pnpm-lock.yaml`.
- TypeScript configuration showing strict NodeNext ESM behavior.
- Biome, Vitest, Playwright, and esbuild configuration.
- Sanity package source and non-empty tests.
- Invalid-type and undeclared-import fixtures.
- Node and browser build artifacts produced during verification, with no generated artifacts committed.
- A clean-install transcript using `pnpm install --frozen-lockfile`.
- Successful root validation output.
- Intentional failure evidence for formatting, invalid types, missing artifacts, lockfile mismatch, and missing browser prerequisites.
- GitHub Actions workflow and a successful CI run using the pinned toolchain.
- Documentation describing supported environments, install-script policy, package boundaries, dependency direction, and script responsibilities.
- A review confirming that no F2-F20 product behavior, release publishing, native runtime, telemetry, hosted service, credentials, or traffic capture was introduced.
