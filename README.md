# Rogatio

Rogatio is a planned local-first tool for creating, reviewing, and running browser request and response rules from a canonical `.rogatio.json` file.

## Current Status

Feature 1, monorepo and tooling bootstrap, is implemented. Feature 2's `@rogatio/schema` package is implemented in the feature worktree and pending release. Other product packages remain intentionally unimplemented.

## Project Documents

- [`rogatio-overview.md`](rogatio-overview.md): product and technical scope.
- [`sequence.md`](sequence.md): ordered feature sequence and dependencies.
- [`docs/architecture.md`](docs/architecture.md): current planned boundaries and decisions.
- [`docs/specs/f1-monorepo-tooling.md`](docs/specs/f1-monorepo-tooling.md): Feature 1 specification.
- [`docs/plans/f1-monorepo-tooling.md`](docs/plans/f1-monorepo-tooling.md): Feature 1 implementation plan.
- [`docs/specs/f2-schema.md`](docs/specs/f2-schema.md): Feature 2 schema specification.

## Development Workflow

The planning workflow uses role-specific models with a recorded fallback chain. Preferred models are drawn from the `opencode-go` and `openrouter` providers, with the session's active model as the final fallback: primary brainstorm, architecture, specification, tests, and coding prefer `opencode-go/gpt-5.6-luna`; adversarial brainstorm prefers `opencode-go/minimax-m3`; plans and review prefer `opencode-go/glm-5.3`; verification and documentation prefer `opencode-go/hy3`. Under a single-model session (for example Freebuff), one model performs every role and the fresh-context review becomes a self-review pass. Raw brainstorm output is ephemeral and is not part of the durable project documentation.

## Foundation

Feature 1 establishes:

- pnpm `10.32.1` workspace tooling.
- Strict TypeScript 7 (pinned `7.0.2`) with ESM/NodeNext.
- Biome formatting and linting.
- esbuild builds.
- Vitest unit-test infrastructure.
- Playwright browser-test infrastructure.
- Baseline GitHub Actions validation.

## Prerequisites and Install

- Node.js 24 or newer; Node 24 is the CI baseline.
- pnpm 10.32.1.
- Chromium for browser smoke tests.

Install with the frozen lockfile:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

F1 retains pnpm's default lifecycle-script blocking. No broad install-script allowance is configured; any future exception requires review and documentation.

## Scripts

- `pnpm format:check` checks formatting; `pnpm format` writes it.
- `pnpm lint` runs Biome linting.
- `pnpm typecheck` runs the pinned strict TypeScript compiler.
- `pnpm build` creates and verifies Node and browser ESM smoke artifacts plus the Node ESM schema artifact.
- `pnpm test` builds and runs the non-empty Vitest smoke suite.
- `pnpm test:browser` builds and runs the Chromium Playwright smoke journey.
- `pnpm validate` runs the complete fail-fast validation sequence, including negative fixtures.

## F1 Verification Baseline

F1 validation is pinned to a known-good toolchain: Node `24.19.0`, pnpm `10.32.1`, and `typescript@7.0.2`. In the current session `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:browser`, and `pnpm validate` all passed, along with the `smoke`/`sanity` package tests and builds. `pnpm validate` executed two Vitest tests, three intentional TypeScript failures, three emitted artifacts, direct emitted `smoke`/`sanity` Node imports, and one Chromium test. See `docs/f1-workflow.md` for the recorded evidence.

## F1 Package Boundaries

F1 tooling verification uses `@rogatio/smoke` and `@rogatio/sanity`; F2 adds the `@rogatio/schema` validation boundary. The future `compiler -> browser-core/editor/runtime -> extension/cli` layers are documented boundaries only. No F3-F20 product API or behavior is present.

There is no installable CLI, browser extension, or runtime yet. Do not infer product behavior from the F1 bootstrap smoke packages.

## Schema Boundary

F2 adds `@rogatio/schema` as the local validation boundary for the common version-1 `.rogatio.json` envelope. It owns project/group/rule matcher data, explicit HTTP(S) site origins, bounded inputs, and frozen forbidden-header policy lists. Its verified distribution artifact is Node ESM; MV3-safe browser packaging is deferred to the extension boundary. Rule actions, compiler operations, browser integration, persistence, and runtime behavior remain out of scope until their sequence items land.
