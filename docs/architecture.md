# Rogatio Architecture

**Status:** F1 bootstrap implemented; product packages remain intentionally unimplemented.

## Product Boundary

Rogatio is a local-first tool for creating, reviewing, and running browser request and response rules. The repository `.rogatio.json` file is canonical. The CLI, Chrome extension, and optional local runtimes exchange changes only through explicit import/export or controlled runtime connections. Rogatio has no accounts, hosted runtime, cloud sync, telemetry, or retained traffic history.

## Planned Package Layers

The planned workspace boundaries follow the implementation sequence:

```text
schema
  |
compiler
  |
browser-core / editor / runtime
  |
extension / cli
```

- `schema` owns the version-1 file format and validation.
- `compiler` converts validated source into browser-neutral operations and diagnostics.
- `browser-core` owns project lifecycle, storage, permissions, enablement, runtime state, and diagnostics.
- `editor` provides the shared framework-free DOM controller and accessible view.
- `runtime` provides bounded local runtime components.
- `extension` provides the Chrome MV3 boundary and browser-specific translation.
- `cli` hosts the public `edit`, `verify`, and `runtime` commands.

These packages are planned boundaries only. F1 must not implement their domain behavior.

## F1 Bootstrap Architecture

F1 establishes a pnpm `10.32.1` workspace with strict TypeScript 7 and ESM/NodeNext conventions, Biome formatting and linting, esbuild builds, Vitest tests, Playwright browser-test configuration, and baseline GitHub Actions validation.

The implementation plan uses two non-domain packages, `smoke` and `sanity`, to prove workspace resolution and emitted cross-package imports without creating future product package stubs. Build output, coverage, browser reports, dependencies, and local environment files remain generated or local-only artifacts.

The planned root validation sequence is:

1. Frozen dependency installation.
2. Biome format check.
3. Biome lint.
4. Strict TypeScript check.
5. Node and browser esbuild builds.
6. Vitest smoke tests.
7. Boundary and negative-fixture checks.
8. Playwright Chromium smoke validation where prerequisites are installed.

F1 uses explicit target-specific build settings rather than a custom internal build framework. Repository orchestration should use Node-based scripts so supported operating systems do not depend on Bash behavior.

## Workflow Model Roles

The `sdd` and `doit` skills in `.agents/skills/` define per-role model preferences and the fallback chain. Preferred models are drawn from the `opencode-go` and `openrouter` providers, with the session's active model as the final fallback when a preferred variant is unavailable.

- Primary brainstorm, architecture, SDD specification, tests, and coding: `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session model.
- Adversarial brainstorm: `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session model.
- Implementation plans and independent review: `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/anthropic/claude-sonnet-5` → session model.
- Verification and documentation: `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session model.

Raw brainstorm output is ephemeral. Only synthesized architecture decisions, specifications, plans, verification evidence, and final documentation are durable. Model availability is checked once at workflow start; a preferred model being unavailable triggers a recorded fallback rather than blocking the whole workflow. Under a single-model session (for example Freebuff), one model performs every role and the fresh-context review becomes a deliberate self-review pass that re-reads the final diff without the implementer's working notes.

## Compatibility Baseline

- Node.js `24+` is the declared minimum; Node 24 is the F1 CI baseline.
- pnpm is exactly `10.32.1`.
- TypeScript major version 7 is required; the exact patch version was a blocking F1 decision, now resolved as `typescript@7.0.2` and recorded in `docs/f1-workflow.md`.
- The current browser target is Chrome; the exact browser version policy remains open.
- Linux, Windows, and macOS are supported development platforms; the CI matrix policy is an F1 decision gate.

## Security and Privacy Boundaries

F1 introduces only development and validation tooling. It must not add credentials, telemetry, hosted endpoints, traffic capture, native messaging, proxies, TLS handling, or persistent user data. Dependencies are controlled by the committed pnpm lockfile, exact or explicitly governed tool versions, separated development dependencies, and a reviewed install-script policy. Generated files and secrets must not enter version control.

## Decision Gates

The F1 plan carried four gates that were resolved before the affected implementation tasks:

- **G1:** exact validated TypeScript 7 patch version.
- **G2:** GitHub Actions immutable SHA pinning versus pinned release-version policy.
- **G3:** mandatory separate Playwright CI job versus another documented browser-job policy.
- **G4:** full cross-platform matrix versus Ubuntu-per-change plus scheduled or manual Windows/macOS verification.

The decisions belong in this document and in the F1 implementation record. Open questions must not be silently converted into product requirements.

## F1 Decisions and Current State

F1 decisions are:

- **G1:** Pin `typescript@7.0.2`, validated against the strict NodeNext repository typecheck, the `smoke`/`sanity` package builds, and the emitted-module execution checks in `pnpm validate`.
- **G2:** Pin GitHub Actions to release versions (`checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`) until immutable SHA pinning becomes repository policy.
- **G3:** Run Chromium in a separate mandatory browser job; local and CI runs fail clearly when Chromium is not installed.
- **G4:** Run Ubuntu checks on every push and pull request; run Windows and macOS smoke checks on the weekly schedule or manual dispatch.

The repository now contains the F1 bootstrap plus planning documents. The durable F1 specification and plan are stored at:

- `docs/specs/f1-monorepo-tooling.md`
- `docs/plans/f1-monorepo-tooling.md`

No raw brainstorm documents are retained. No product implementation, release automation, credentials, telemetry, hosted endpoint, native runtime, or traffic capture has been introduced.
