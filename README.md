# Rogatio

Rogatio is a planned local-first tool for creating, reviewing, and running browser request and response rules from a canonical `.rogatio.json` file.

## Current Status

Feature 1, monorepo and tooling bootstrap, Feature 2, the released `@rogatio/schema` package, Feature 3, the released `@rogatio/compiler` package, and Feature 4, the released `@rogatio/browser-core` package, are complete. The editor, runtime, extension, and CLI packages remain intentionally unimplemented.

## Project Documents

- [`rogatio-overview.md`](rogatio-overview.md): product and technical scope.
- [`sequence.md`](sequence.md): ordered feature sequence and dependencies.
- [`docs/architecture.md`](docs/architecture.md): current planned boundaries and decisions.
- [`docs/specs/f1-monorepo-tooling.md`](docs/specs/f1-monorepo-tooling.md): Feature 1 specification.
- [`docs/plans/f1-monorepo-tooling.md`](docs/plans/f1-monorepo-tooling.md): Feature 1 implementation plan.
- [`docs/specs/f2-schema.md`](docs/specs/f2-schema.md): Feature 2 schema specification.
- [`docs/plans/f2-schema.md`](docs/plans/f2-schema.md): Feature 2 implementation plan.
- [`docs/specs/f3-compiler.md`](docs/specs/f3-compiler.md): Feature 3 compiler specification.
- [`docs/plans/f3-compiler.md`](docs/plans/f3-compiler.md): Feature 3 implementation plan.
- [`docs/plans/f4-browser-core.md`](docs/plans/f4-browser-core.md): Feature 4 implementation plan.
- [`docs/f4-workflow.md`](docs/f4-workflow.md): Feature 4 workflow log.

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
- `pnpm build` creates and verifies Node and browser ESM smoke artifacts plus the Node ESM schema, compiler, and browser-core artifacts.
- `pnpm test` builds and runs the non-empty Vitest smoke suite.
- `pnpm test:browser` builds and runs the Chromium Playwright smoke journey.
- `pnpm validate` runs the complete fail-fast validation sequence, including negative fixtures.

## F1 Verification Baseline

F1 validation is pinned to a known-good toolchain: Node `24.19.0`, pnpm `10.32.1`, and `typescript@7.0.2`. The original F1 validation evidence is recorded in `docs/f1-workflow.md`.

## F1 Package Boundaries

F1 tooling verification uses `@rogatio/smoke` and `@rogatio/sanity`; F2 adds the `@rogatio/schema` validation boundary; F3 adds the `@rogatio/compiler` matcher transformation boundary; F4 adds the `@rogatio/browser-core` core platform layer. The future `editor/runtime -> extension/cli` layers are documented boundaries only. No F5-F20 product API or behavior is present.

There is no installable CLI, browser extension, or runtime yet. Do not infer product behavior from the F1 bootstrap smoke packages.

## Schema Boundary

F2 adds `@rogatio/schema` as the local validation boundary for the common version-1 `.rogatio.json` envelope. It owns project/group/rule matcher data, explicit HTTP(S) site origins, bounded inputs, and frozen forbidden-header policy lists. Its verified distribution artifact is Node ESM; MV3-safe browser packaging is deferred to the extension boundary. Rule actions, compiler operations, browser integration, persistence, and runtime behavior remain out of scope until their sequence items land.

## Compiler Boundary

F3 adds `@rogatio/compiler` as a pure Node ESM boundary from the fully validated F2 envelope to one fresh, data-only matcher operation per source rule. It normalizes and sorts effective origins, orders resource types canonically, preserves regex source, method, priority, and source order, and maps validation failures to stable diagnostics. It does not execute matching, define priority precedence, add actions, or access browser, runtime, filesystem, network, persistence, permission, or telemetry APIs. MV3-safe packaging remains deferred with the F2 browser boundary.

## Browser-Core Boundary

F4 adds `@rogatio/browser-core` as the browser-neutral core platform layer depending only on `@rogatio/schema` and `@rogatio/compiler`. It owns versioned project storage and migrations, the compare-and-swap lifecycle, per-project permission grants and group enablement, atomic rule installation with recovery, the rule status and badge model, and the in-memory runtime state model. Chrome/WebExtensions/DNR translation, editor and CLI surfaces, rule actions, and runtime persistence remain out of scope until their sequence items land. The package's Node ESM artifact is verified by the root build and validation; MV3-safe packaging is deferred to the extension boundary.
