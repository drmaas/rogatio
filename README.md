# Rogatio

Rogatio is a planned local-first tool for creating, reviewing, and running browser request and response rules from a canonical `.rogatio.json` file.

## Current Status

Feature 1, monorepo and tooling bootstrap, is implemented in this worktree. Product packages remain intentionally unimplemented.

## Project Documents

- [`rogatio-overview.md`](rogatio-overview.md): product and technical scope.
- [`sequence.md`](sequence.md): ordered feature sequence and dependencies.
- [`docs/architecture.md`](docs/architecture.md): current planned boundaries and decisions.
- [`docs/specs/f1-monorepo-tooling.md`](docs/specs/f1-monorepo-tooling.md): Feature 1 specification.
- [`docs/plans/f1-monorepo-tooling.md`](docs/plans/f1-monorepo-tooling.md): Feature 1 implementation plan.

## Development Workflow

The planning workflow uses `opencode-go/gpt-5.6-luna` for primary brainstorming, architecture synthesis, specification synthesis, and coding; `opencode-go/minimax-m3` for adversarial brainstorming; `opencode-go/glm-5.3` for plans and review; and `opencode-go/hy3` for verification and documentation. Raw brainstorm output is ephemeral and is not part of the durable project documentation.

Required model identifiers are checked before delegated work, and unavailable roles block work rather than being silently substituted.

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
- `pnpm build` creates and verifies Node and browser ESM smoke artifacts.
- `pnpm test` builds and runs the non-empty Vitest smoke suite.
- `pnpm test:browser` builds and runs the Chromium Playwright smoke journey.
- `pnpm validate` runs the complete fail-fast validation sequence, including negative fixtures.

## F1 Verification Baseline

F1 validation is pinned to a known-good toolchain: Node `24.19.0`, pnpm `10.32.1`, and `typescript@7.0.2`. In the current session `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:browser`, and `pnpm validate` all passed, along with the `smoke`/`sanity` package tests and builds. `pnpm validate` executed two Vitest tests, three intentional TypeScript failures, three emitted artifacts, direct emitted `smoke`/`sanity` Node imports, and one Chromium test. See `docs/f1-workflow.md` for the recorded evidence.

## F1 Package Boundaries

Only `@rogatio/smoke` and `@rogatio/sanity` exist for F1 tooling verification. The future `schema -> compiler -> browser-core/editor/runtime -> extension/cli` layers are documented boundaries only. No F2-F20 product API or behavior is present.

There is no installable CLI, browser extension, or runtime yet. Do not infer product behavior from the F1 bootstrap smoke packages.
