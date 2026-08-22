# Rogatio

Rogatio is a planned local-first tool for creating, reviewing, and running browser request and response rules from a canonical `.rogatio.json` file.

## Current Status

The repository is in the planning and foundation stage. Feature 1, monorepo and tooling bootstrap, has a synthesized specification and implementation plan, but the workspace and product packages have not been implemented yet.

## Project Documents

- [`rogatio-overview.md`](rogatio-overview.md): product and technical scope.
- [`sequence.md`](sequence.md): ordered feature sequence and dependencies.
- [`docs/architecture.md`](docs/architecture.md): current planned boundaries and decisions.
- [`docs/specs/f1-monorepo-tooling.md`](docs/specs/f1-monorepo-tooling.md): Feature 1 specification.
- [`docs/plans/f1-monorepo-tooling.md`](docs/plans/f1-monorepo-tooling.md): Feature 1 implementation plan.

## Development Workflow

The planning workflow uses role-specific models with a recorded fallback chain. Preferred models are drawn from the `opencode-go` and `openrouter` providers, with the session's active model as the final fallback: primary brainstorm, architecture, specification, tests, and coding prefer `opencode-go/gpt-5.6-luna`; adversarial brainstorm prefers `opencode-go/minimax-m3`; plans and review prefer `opencode-go/glm-5.3`; verification and documentation prefer `opencode-go/hy3`. Under a single-model session (for example Freebuff), one model performs every role and the fresh-context review becomes a self-review pass. Raw brainstorm output is ephemeral and is not part of the durable project documentation.

## Planned Foundation

Feature 1 will establish:

- pnpm `10.32.1` workspace tooling.
- Strict TypeScript 7 with ESM/NodeNext.
- Biome formatting and linting.
- esbuild builds.
- Vitest unit-test infrastructure.
- Playwright browser-test infrastructure.
- Baseline GitHub Actions validation.

Until Feature 1 is implemented, there is no installable CLI, browser extension, or runtime. Do not infer product behavior from the planned bootstrap smoke packages.
