# Rogatio Architecture

**Status:** F1 bootstrap, F2 schema, F3 compiler, and F4 browser-core are released.

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

These packages are planned boundaries only. F1 must not implement their domain behavior. F2 is limited to the common version-1 file contract and shared validation policy; F3 is limited to compiling that common envelope into matcher operations.

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

The repository contains the F1 bootstrap and its durable specification and plan:

- `docs/specs/f1-monorepo-tooling.md`
- `docs/plans/f1-monorepo-tooling.md`

No raw brainstorm documents are retained. F1 introduced no product behavior, release automation, credentials, telemetry, hosted endpoint, native runtime, or traffic capture. The F2 schema and F3 compiler packages below are the only product implementations currently present.

## F2 Schema Architecture

F2 introduces `@rogatio/schema` as the authoritative validation boundary for the common version-1 `.rogatio.json` envelope. The package owns the root project metadata, named groups, explicit HTTP(S) origins, and common rule matcher fields: stable IDs, labels, case-sensitive URL regular expressions, resource types, priority, and optional method. It does not implement action payloads or any consumer behavior; later rule slices extend the version-1 schema with their own action fields.

The schema is draft 2020-12 with strict additional-property rejection. Ajv compiles it with all-errors reporting and with coercion, defaults, and property removal disabled. A small semantic validation layer supplements JSON Schema for globally unique IDs, non-empty effective origins, and the total rule bound. All errors use stable JSON-pointer paths and no rejected document is persisted or sent over the network.

Origin validation accepts only explicit `http` and `https` origins with a hostname and optional valid port. Credentials, paths, query strings, fragments, wildcard hosts, and other schemes are rejected. Bounds and browser-neutral resource/method enumerations are exported from the package. Request and response forbidden-header lists are frozen and matched case-insensitively for later header-rule slices.

The verified F2 distribution target is a Node ESM artifact because Ajv compiles its validator at module initialization. Browser and MV3 consumers must receive a later approved standalone/browser packaging strategy rather than loading this runtime-compiled entry under an extension CSP.

## F3 Compiler Architecture

F3 adds `@rogatio/compiler` as a pure, Node ESM transformation boundary from validated F2 projects to browser-neutral matcher operations. Because the F2 envelope intentionally contains no action fields, F3 emits one data-only matcher operation per source rule. Later rule slices add action-specific compiler operations; F3 does not invent a no-op action or a browser-specific representation.

The public `compileProject(value: unknown)` entry point invokes the complete F2 structural and semantic validation boundary before compiling. Invalid input returns a discriminated failure with stable compiler diagnostics and an empty operation list. A valid project produces fresh, serializable output: group and rule traversal order is preserved, group and rule origins are normalized, unioned, deduplicated, and sorted deterministically, resource types use the shared canonical order, the exact regex source is retained with empty flags, and method and priority values pass through unchanged. The compiler does not sort by priority or expand a rule into an origin/resource-type Cartesian product.

Compiler diagnostics use stable codes, severity, JSON-pointer paths, and structured parameters rather than exposing Ajv message text as an API contract. The package depends only on `@rogatio/schema`, has no browser or downstream-package dependency, and inherits the verified Node ESM distribution target. It performs no matching, action transformation, browser permission/DNR translation, filesystem, network, persistence, runtime, telemetry, or traffic-capture work.

## F4 Browser-Core Architecture

F4 adds `@rogatio/browser-core` as the browser-neutral core platform layer between `compiler` and the future extension/CLI surfaces. It owns versioned project storage, migrations, per-project permissions and enablement, compare-and-swap lifecycle, atomic rule installation with recovery, the in-memory runtime state model, rule status and badge computation, and stable core diagnostics. Every platform-specific capability enters through narrow injected adapters, so the same logic runs under Vitest and inside the future Chrome MV3 service worker. The verified distribution target remains Node ESM with `@rogatio/schema` and `@rogatio/compiler` externalized; MV3 packaging stays a later extension-boundary decision.

Storage is a single versioned envelope (`version`, a project record keyed by stable id, and `activeProjectId`) persisted through a `StorageAdapter` whose `compareAndSwap` is the atomicity authority. Reads defensively snapshot raw storage and validate envelope structure; unknown versions, structural violations, cycles, symbols, accessors, and proxies fail closed with `core.storage-corrupt` and no writes. Project data is fully validated through the F2/F3 boundary at write time. Repository operations are read-modify-compare-and-swap: non-explicit operations retry on transient CAS failure, while editor-style saves and strict imports carry an expected revision and return a `conflict` result preserving the committed project for an explicit refresh path.

The repository maintains the documented product invariants: at most 64 uniquely named projects, exactly one active project whenever any exist (the first created/imported project activates; removing the active project activates the most recently updated remaining project, tie-broken by id), creation/import/update and browser save reset group enablement to all-disabled, and grants are restricted to declared effective origins and pruned when data changes. Switching restores the destination project's saved enablement without touching permission or runtime state.

Rule statuses derive from compiled operations, saved enablement, granted origins, and the installed rule ids reported by the installer adapter: disabled groups are `disabled`, enabled rules with un-granted origins are `needs permission`, enabled and granted rules missing from the installed set are `error` with `core.rule-not-installed`, and installed rules are `active`. The `needs proxy` and `unsupported` statuses are part of the defined model and populate only when runtime-dependent rule kinds land in later slices. The badge is a pure function of statuses: the active rule count plus an attention flag. `InstallService` atomically replaces the installed set through the `RuleInstallerAdapter`, treats identical sets as a no-op, rolls back to the previous set on failure with `core.install-failed` / `core.recovery-failed`, and serializes concurrent applies. Mock (`disconnected/checking/connected/failed` with last-check) and native (`stopped/starting/started/failed`) runtime phases are modeled in memory with a guarded transition table; runtime state is not persisted until the runtime slices define their semantics.
