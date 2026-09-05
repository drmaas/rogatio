# Agent Orientation

## Repository State

Read `rogatio-overview.md` and `docs/architecture.md` before changing scope. Respect the documented package boundaries and non-goals; do not expand scope beyond the current feature without an explicit change.

## Codebase Structure

Strict TS 7, ESM/NodeNext monorepo, pnpm 10.32.1, Node 24. Built with esbuild (`scripts/build.ts`); linted/formatted by Biome; tested by Vitest (unit) and Playwright (browser journeys); docs site uses Astro 7 + Starlight.

Dependency direction (no cycles, no skipping):

```
schema → compiler → { editor, dry-run, browser-core } → { cli, extension }
                                                          ↑
                              runtime (depends on schema + compiler only)
```

Package roles — when reading code, start here to know which boundary you are in:

- `packages/schema` — version-1 JSON Schema (draft 2020-12, `additionalProperties: false`), AJV validation, origins, bounds, forbidden-header lists, semantic validation. No actions, no consumers.
- `packages/compiler` — pure transform: validated source → browser-neutral `MatcherOperation` / `RedirectOperation` / `QueryOperation` / `MockOperation` / `RequestBodyOperation` + stable diagnostics. No I/O, no matching execution.
- `packages/browser-core` — browser-neutral core: versioned project storage, migrations, per-project permissions/enablement, compare-and-swap lifecycle, atomic install with recovery, in-memory runtime state model, rule statuses (`active | disabled | needs permission | needs proxy | unsupported | error`), badge math. Platform-specific work enters through injected `StorageAdapter` / `RuleInstallerAdapter` ports.
- `packages/editor` — framework-free DOM editor (view + controller + draft state). Public boundary is `createEditor(options) → EditorController`; host supplies `validate` and `save` adapters. Browser bundle must contain no `node:` imports or Ajv — hosts wire validation through the `browser-schema`/compiler adapter.
- `packages/extension` — Chrome MV3 boundary: service worker, popup, management page, DNR projection (`extension/src/dnr.ts`, `projection.ts`), native-session bridge, popup model. Owns Chrome API adapters and the browser-safe `browser-schema.ts` mirror.
- `packages/cli` — public surface: `rogatio edit | verify | test | runtime`. Hosts the editor over a loopback HTTP server (`127.0.0.1`, random port, CSRF token). `runtime` subcommands: `install | uninstall | host`.
- `packages/runtime` — private Node ESM runtime foundation: loopback mock/response server (`policy`, `protocol`, `outbound`, `confined-file`), macOS native-messaging host (`lifecycle`, `revalidate`, `interception`, `pac`, `proxy`, `tls`, `x509`, `trust`), capability-based activation gate. Owns the F23 unified native host.
- `packages/dry-run` — pure offline rule matcher: `dryRunProject(operations, cases)` with 4-dimension results (regex, origin, method, resourceType) and `previewAction` seam. No network, no FS, no permission, no runtime.
- `packages/sanity` / `packages/smoke` — small focused test/utility packages; check `packages/<name>/README.md` before assuming role.
- `packages/docs-site` — Astro/Starlight docs site. Excluded from root `tsc`/`biome` (see `tsconfig.json` `exclude`, `.biomeignore`); isolated by design.

Workspace-wide files: `scripts/build.ts` (esbuild build), `scripts/validate.ts` (canonical pre-commit/CI gate, also `pnpm validate`), `scripts/serve-smoke.ts` (smoke HTTP server), `scripts/release-*.mjs` (semantic-release plugins), `biome.json`, `tsconfig.base.json`, `playwright.config.ts`, `vitest.config.ts`, `pnpm-workspace.yaml`, `build-manifest.json` (canonical artifact list asserted by the validator).

Test layout: per-package `packages/<name>/test/` and `packages/<name>/src/**/__tests__/` for unit; `test/integration/` for cross-package/process journeys on built artifacts; `test/browser/` for real-Chromium Playwright journeys; `test/fixtures/` for shared fixtures; `samples/basic/` for a runnable `.rogatio.json` example.

Quick orientation rule: locate the feature in `docs/architecture.md` (which package owns it, what it must not do), then read that package's `src/index.ts`/`types.ts`, then the test that exercises the seam you are about to touch.

## Documentation Map

- `rogatio-overview.md` — product scope, functionality, platform support, and non-goals.
- `docs/architecture.md` — package boundaries, per-package decisions, and rejected alternatives.
- `README.md` and `packages/*/README.md` — user-facing overview and usage.
- `CONTRIBUTING.md` — setup, branching, coding standards, commit/issue policy, and validation workflow.
- `.agents/skills/` — operational workflows (`sdd`, `doit`, `rpi`).

## Durable Documentation

- The code is the source of truth for what the system does. Decision records (specs, plans, workflow logs) describe *why* a feature is the way it is, *what was rejected*, and *what was approved* — not what the system currently does.
- New decision records go under `docs/decisions/<feature>/` (`spec.md`, `plan.md`, `workflow.md`). On release or supersession they are moved (not copied, not edited) to `docs/specs/<feature>.md`, `docs/plans/<feature>.md`, or `docs/workflows/<feature>-workflow.md` and frozen. Once frozen, they are read-only; if a record goes stale, write a new one with a `> Superseded by:` footer.
- Only `docs/architecture.md`, `README.md`, `packages/*/README.md`, and `packages/docs-site/` describe current behavior and must be kept in sync with the code. Decision records are append-only and do not require synchronization on behavior changes.
- Raw brainstorm output is ephemeral; do not create or retain brainstorm documents. Prompt before deleting existing brainstorm files.

## Agent Model Tiers

Every workflow must choose one agent tier at the start and use it for every delegated role. If the user did not specify `free` or `normal`, ask them to choose before delegating work:

- **Free:** Route each phase to its documented primary model, falling back to the documented fallback only when the primary is unavailable. Never silently substitute an unlisted free model, a paid model, or the session model; the free catalog spans both OpenCode Zen free and OpenRouter free. If both primary and fallback are unavailable, stop and ask the user to switch tiers or explicitly approve a replacement.
- **Normal:** Use the existing role-specific model chains below. Before using a paid normal model, check whether the exact model or a clearly equivalent free OpenCode Zen model is available; prefer that free equivalent. Do not substitute a merely convenient or unrelated free model and call it equivalent. Normal mode may fall back through its existing provider chain and finally the session model.

The free catalog spans the current OpenCode Zen free provider and OpenRouter free models:

OpenCode Zen free:

- `opencode/x-preview-f-free` (Ox Alpha Free)
- `opencode/nemotron-3-ultra-free` (Nemotron 3 Ultra Free)
- `opencode/nemotron-3.5-lightning-free` (Nemotron 3.5 Lightning Free)
- `opencode/muse-spark-1.2-contributor-free` (Muse Spark 1.2 Free)
- `opencode/hy3-free` (Hy3 Free)
- `opencode/mimo-v2.5-free` (MiMo V2.5 Free)
- `opencode/big-pickle` (Big Pickle)

OpenRouter free:

- `openrouter/poolside/laguna-s-2.1:free` (Laguna S 2.1)
- `openrouter/thinkingmachines/inkling-small:free` (Inkling Small)
- `openrouter/dots-studio/dots-3-note-preview:free` (Dots3-Note Preview)

Free mode routes each phase to a primary model with a documented fallback. If the primary is unavailable, use the fallback rather than the session model or a paid provider; never silently substitute an unlisted model. Phase-to-model routing is defined per workflow in the `sdd` and `doit` skills. The canonical phase routing is:

| Phase | Primary | Fallback |
| --- | --- | --- |
| Brainstorm / architecture | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Specification | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Plan | `opencode/hy3-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Tests authoring | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Implementation (code) | `openrouter/poolside/laguna-s-2.1:free` | `openrouter/thinkingmachines/inkling-small:free` |
| Verification / debug loop | `opencode/nemotron-3.5-lightning-free` | `openrouter/poolside/laguna-s-2.1:free` |
| Independent review | `opencode/nemotron-3-ultra-free` | `openrouter/thinkingmachines/inkling-small:free` |
| Documentation | `opencode/hy3-free` | `openrouter/dots-studio/dots-3-note-preview:free` |

Normal-tier role chains remain:

- Primary brainstorm, architecture, SDD specification, tests, and coding: `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session model.
- Adversarial brainstorm: `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session model.
- Implementation plans and independent review: `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/anthropic/claude-sonnet-5` → session model.
- Verification and documentation: `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session model.

Verify model availability once at workflow start with `opencode models` or the session's provider list. Record the selected tier and the model that served each role; record normal-tier fallbacks as notes, while free-tier unavailability pauses the workflow. A missing preferred model is never an excuse to silently widen scope or skip a stage. Under a single-model session, keep the role passes distinct and use a fresh-context self-review.

The `sdd` and `doit` skills repeat the operational tier-selection rules and role defaults so they remain usable when loaded independently.

## Repository Rules

- Preserve the documented pnpm `10.32.1`, Node 24 baseline, TypeScript 7, and ESM/NodeNext constraints unless the specification is explicitly revised.
- Keep package boundaries and dependency direction explicit.
- Do not commit generated build output, coverage, browser binaries, dependency directories, environment files, or secrets.
- Every commit must reference an open issue (`#<NN>` or `Closes #<NN>`) and follow Conventional Commits format; the `.husky/commit-msg` hook enforces both. Before committing, reuse an existing issue or create one automatically, and confirm the issue number with the user rather than inventing one. See `CONTRIBUTING.md`.
- Releases are cut by semantic-release on merge to `main` (conventional-commit driven): `fix:` bumps the patch, `feat:` the minor, and `!` / `BREAKING CHANGE:` a major. Version 2.0.0 therefore requires a breaking-change footer or `!` marker on a commit that merges to `main`.
- Review new dependencies and install-script permissions before adding them.
- Use cross-platform Node-based scripts instead of Bash-only orchestration.
- Verify real test execution, emitted builds, and browser prerequisites; do not accept false-green checks.
- Run the repository's canonical validation command (`pnpm validate`) before declaring work complete; it is the same fail-fast sequence CI runs.
- Keep negative fixtures outside normal typecheck and Biome inputs, and preserve their intended failures.
- Treat build manifests, package output, coverage, browser reports, browser binaries, and dependencies as generated or local-only.
- Before editing with multiple worktrees, verify `git rev-parse --show-toplevel`, the current branch, `git worktree list`, and repository status; never guess an absolute path.
- Treat untrusted input and unusual object behavior defensively, including inherited properties, accessors, proxies, cycles, sparse collections, and mutable shared state.
- For code that consumes untrusted structured data, include adversarial tests for those behaviors and other relevant malformed inputs.
- Keep public diagnostics and serialized output stable and independent of third-party wording or incidental iteration order.
- CI should run the same authoritative validation used locally rather than a weaker manually duplicated subset.
- Keep the editor as a framework-free, browser-safe DOM boundary: use host-supplied validation and save ports, preserve detached draft state, and do not import Node-only validation artifacts into browser output.

## Source-of-truth priority

When a claim about the system conflicts across sources, trust them in this order:

1. The code in `packages/`, `samples/`, and the repository root.
2. The tests in `packages/*/test/`, `packages/*/src/**/__tests__/`, and the workspace test scripts.
3. `docs/architecture.md` — package boundaries, per-package decisions, and rejected alternatives.
4. `README.md` and `packages/*/README.md` — user-facing overview and usage.
5. Decision records under `docs/specs/`, `docs/plans/`, `docs/workflows/`, and `docs/decisions/` — what was decided, by whom, when, and what was rejected. They describe the decision, not the system.

Do not use a decision record to answer "what does the system do?" Use it to answer "why is it this way?" and "what was rejected?" If a decision record and the code disagree, the code wins; the disagreement is captured on the next review by adding a `Superseded by` footer to the frozen record.

## Workflow

**Enter the worktree FIRST.** Before ANY specification, architecture, brainstorm output, plan, test, or code change — create or enter the feature worktree and confirm the shell is operating in it. No edits happen in the main checkout.

Use a dedicated feature worktree for implementation. Before declaring an implementation complete, run `pnpm validate` and record evidence against the relevant acceptance criteria. Before release, audit staged, unstaged, tracked, and untracked files for unrelated changes, generated output, local settings, and secrets. A single explicit user authorization for a clearly defined set of commit, push, PR, merge, or cleanup actions remains valid for that set; ask again only when authorization is absent, ambiguous, or scope changes. Never force-push or push directly to a protected default branch. After merge, reconcile release/status documentation and verify the default branch, worktrees, and remote refs are in the intended final state.

Always prompt before deleting files or directories.

## Worktree Convention

All implementation work uses a dedicated git worktree created with `git worktree add`, never the `opencode-worktree` plugin.

- Worktrees always live at `/home/drmaas/.local/share/opencode/worktree/<repo name>/<branch name>`.
- Create a worktree with `git worktree add -b <branch> /home/drmaas/.local/share/opencode/worktree/<repo name>/<branch name> <baseBranch>`.
- After creating, run the project setup in the new worktree (e.g. `pnpm install`) and confirm the shell is operating there.
- Tear down with `git worktree remove /home/drmaas/.local/share/opencode/worktree/<repo name>/<branch name>` (auto-commit your changes first).
- Exception: the pre-existing manual worktree `~/Projects/github/drmaas/rogatio-f7` (branch `feature/f7-extension-shell`) remains in place.
