# Rogatio

Rogatio is a planned local-first tool for creating, reviewing, and running browser request and response rules from a canonical `.rogatio.json` file.

## Current Status

Feature 1, monorepo and tooling bootstrap, Feature 2, the released `@rogatio/schema` package, Feature 3, the released `@rogatio/compiler` package, Feature 4, the released `@rogatio/browser-core` package, F5, the `@rogatio/editor` package, Feature 6, the `@rogatio/runtime` foundation package, F7, the Chrome MV3 `@rogatio/extension` shell, and F8, the `@rogatio/cli` package (providing `rogatio edit` and `rogatio verify`, with `rogatio runtime` as a documented stub), are implemented and verified in this worktree. Action-specific rule slices, packaging, and release automation remain intentionally unimplemented.

## CLI

The `@rogatio/cli` package installs the `rogatio` binary.

- `rogatio edit [path]` — launches a browser editor for a `.rogatio.json` project (creates an empty project if the file is missing). Binds a local HTTP server to `127.0.0.1` and opens your default browser; `--port <n>` fixes the port.
- `rogatio verify [path]` — validates a `.rogatio.json` file with the schema (F2) and compiler (F3). Use `-` to read from stdin and `--json` for machine-readable diagnostics. Exit codes: `0` valid, `1` invalid, `2` error.
- `rogatio runtime` — documented stub for the future native-messaging runtime (F14+); exits `1`.

See [`docs/specs/f8-cli-edit-verify.md`](docs/specs/f8-cli-edit-verify.md) for the full contract.

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
- [`docs/specs/f5-editor.md`](docs/specs/f5-editor.md): Feature 5 editor specification.
- [`docs/f5-workflow.md`](docs/f5-workflow.md): Feature 5 workflow record.
- [`docs/specs/f6-runtime-foundation.md`](docs/specs/f6-runtime-foundation.md): Feature 6 runtime foundation specification.
- [`docs/specs/f8-cli-edit-verify.md`](docs/specs/f8-cli-edit-verify.md): Feature 8 CLI `edit`/`verify` specification.
- [`docs/plans/f8-cli-edit-verify.md`](docs/plans/f8-cli-edit-verify.md): Feature 8 implementation plan.
- [`docs/f8-workflow.md`](docs/f8-workflow.md): Feature 8 workflow record (SDD stages, review, verification).
- [`docs/f6-workflow.md`](docs/f6-workflow.md): Feature 6 workflow record.
- [`docs/specs/f7-extension-shell.md`](docs/specs/f7-extension-shell.md): Feature 7 Chrome MV3 extension specification.
- [`docs/plans/f7-extension-shell.md`](docs/plans/f7-extension-shell.md): Feature 7 implementation plan.
- [`docs/f7-workflow.md`](docs/f7-workflow.md): Feature 7 workflow record.

## Development Workflow

Every workflow chooses one agent tier before it starts. **Free** uses only OpenCode Zen free models and never silently escalates to a paid model or the session model. **Normal** retains the existing role-specific chains, but checks for an exact or clearly equivalent free OpenCode Zen model first; the current exact equivalence is `opencode/hy3-free` for verification and documentation. Record the selected tier, role models, and fallbacks in the workflow log.

The current OpenCode Zen free catalog is `opencode/x-preview-f-free` (Ox Alpha Free), `opencode/nemotron-3-ultra-free` (Nemotron 3 Ultra Free), `opencode/nemotron-3.5-lightning-free` (Nemotron 3.5 Lightning Free), `opencode/muse-spark-1.2-contributor-free` (Muse Spark 1.2 Free), `opencode/hy3-free` (Hy3 Free), `opencode/mimo-v2.5-free` (MiMo V2.5 Free), and `opencode/big-pickle` (Big Pickle). Free mode uses pinned phase assignments, not fallback chains: the `sdd` and `doit` skills pin Nemotron Ultra to the reasoning-heavy discovery phases, MiMo to planning, Muse Spark to tests, Ox Alpha to implementation, Hy3 to verification/documentation, and Big Pickle to independent review. Under a single-model session, keep the role passes distinct and use a fresh-context self-review. Raw brainstorm output is ephemeral and is not part of the durable project documentation.

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
- `pnpm build` creates and verifies Node and browser ESM artifacts, including the browser-safe MV3 service worker and extension page bundles.
- `pnpm test` builds and runs the non-empty Vitest smoke suite.
- `pnpm test:browser` builds and runs the Chromium Playwright smoke journey.
- `pnpm validate` runs the complete fail-fast validation sequence, including negative fixtures.

## F1 Verification Baseline

F1 validation is pinned to a known-good toolchain: Node `24.19.0`, pnpm `10.32.1`, and `typescript@7.0.2`. The original F1 validation evidence is recorded in `docs/f1-workflow.md`.

## F7 Extension Boundary

F7 adds the private `@rogatio/extension` package with a Chrome Manifest V3 service worker, extension page, project lifecycle controls, explicit project switching, least-privilege permission review/grant, separate group activation, deterministic actionless matcher projection, stable status/badge rendering, and a shared F5 editor host. F7 deliberately does not install actionless DNR rules or implement action-specific rule slices. Its MV3 bundles use a browser-safe validator and contain no Node globals, dynamic evaluation, remote code, or Ajv runtime compiler. The `[Rogatio]` DevTools Console record is deferred to a later specification.

See [`docs/specs/f7-extension-shell.md`](docs/specs/f7-extension-shell.md) for the approved contract and [`docs/f7-workflow.md`](docs/f7-workflow.md) for validation evidence.

## F1 Package Boundaries

F1 tooling verification uses `@rogatio/smoke` and `@rogatio/sanity`; F2 adds the `@rogatio/schema` validation boundary; F3 adds the `@rogatio/compiler` matcher transformation boundary; F4 adds the `@rogatio/browser-core` core platform layer; F7 supplies the Chrome extension shell; and F8 supplies the `@rogatio/cli` boundary. Action-specific rule slices, packaging, and release automation remain outside the current implementation.

The current implementation includes the F7 extension shell and F8 CLI; browser-store packaging, action-specific rule slices, and release automation remain intentionally unimplemented.

## Editor Boundary

F5 adds the private `@rogatio/editor` package with a framework-free DOM controller and accessible view. It owns common project editing, local draft state, navigation, search, validation presentation, and host callbacks. Persistence and browser lifecycle remain host responsibilities. The browser entry uses a host-supplied F2/F3-compatible validation adapter rather than importing the current Node-only runtime artifacts directly. See [`docs/specs/f5-editor.md`](docs/specs/f5-editor.md) for the contract.

## Schema Boundary

F2 adds `@rogatio/schema` as the local validation boundary for the common version-1 `.rogatio.json` envelope. It owns project/group/rule matcher data, explicit HTTP(S) site origins, bounded inputs, and frozen forbidden-header policy lists. Its verified distribution artifact is Node ESM; MV3-safe browser packaging is deferred to the extension boundary. Rule actions, compiler operations, browser integration, persistence, and runtime behavior remain out of scope until their sequence items land.

## Compiler Boundary

F3 adds `@rogatio/compiler` as a pure Node ESM boundary from the fully validated F2 envelope to one fresh, data-only matcher operation per source rule. It normalizes and sorts effective origins, orders resource types canonically, preserves regex source, method, priority, and source order, and maps validation failures to stable diagnostics. It does not execute matching, define priority precedence, add actions, or access browser, runtime, filesystem, network, persistence, permission, or telemetry APIs. MV3-safe packaging remains deferred with the F2 browser boundary.

## Browser-Core Boundary

F4 adds `@rogatio/browser-core` as the browser-neutral core platform layer depending only on `@rogatio/schema` and `@rogatio/compiler`. It owns versioned project storage and migrations, the compare-and-swap lifecycle, per-project permission grants and group enablement, atomic rule installation with recovery, the rule status and badge model, and the in-memory runtime state model. Chrome/WebExtensions/DNR translation, editor and CLI surfaces, rule actions, and runtime persistence remain out of scope until their sequence items land. The package's Node ESM artifact is verified by the root build and validation; MV3-safe packaging is deferred to the extension boundary.
