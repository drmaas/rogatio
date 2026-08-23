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

## Workflow Agent Tiers

The `sdd` and `doit` skills in `.agents/skills/` define two selectable agent tiers. The tier is selected once at workflow start and applies to every delegated role.

**Free tier** is restricted to the current OpenCode Zen free catalog:

- `opencode/x-preview-f-free` (Ox Alpha Free)
- `opencode/nemotron-3-ultra-free` (Nemotron 3 Ultra Free)
- `opencode/nemotron-3.5-lightning-free` (Nemotron 3.5 Lightning Free)
- `opencode/muse-spark-1.2-contributor-free` (Muse Spark 1.2 Free)
- `opencode/hy3-free` (Hy3 Free)
- `opencode/mimo-v2.5-free` (MiMo V2.5 Free)
- `opencode/big-pickle` (Big Pickle)

Free mode never falls back to a paid model, another provider, or the session model. The `sdd` and `doit` skills pin one free model to each phase: Nemotron Ultra for reasoning-heavy discovery, architecture, and specification; MiMo for planning; Muse Spark for tests; Ox Alpha for implementation; Hy3 for verification/documentation; and Big Pickle for independent review. If a pinned model is unavailable, the workflow pauses for an explicit tier change or a confirmed replacement ID.

**Normal tier** retains the existing role-specific chains, but checks for an exact or clearly equivalent free OpenCode Zen model before using a paid normal model. The current exact equivalence is `opencode/hy3-free` for `opencode-go/hy3` verification/documentation; other free models are not automatic equivalents merely because they are available.

- Primary brainstorm, architecture, SDD specification, tests, and coding: `opencode-go/gpt-5.6-luna` → `openrouter/openai/gpt-5.6-luna` → session model.
- Adversarial brainstorm: `opencode-go/minimax-m3` → `opencode-go/minimax-m2.7` → `openrouter/anthropic/claude-opus-5` → session model.
- Implementation plans and independent review: `opencode-go/glm-5.3` → `opencode-go/glm-5.2` → `openrouter/anthropic/claude-sonnet-5` → session model.
- Verification and documentation: `opencode/hy3-free` → `opencode-go/hy3` → `openrouter/openai/gpt-5.5` → session model.

Raw brainstorm output is ephemeral. Only synthesized architecture decisions, specifications, plans, verification evidence, and final documentation are durable. Verify catalog availability once at workflow start, record the selected tier and every role/fallback, and keep real command execution as the verification evidence. Under a single-model session, keep the role passes distinct and use a fresh-context self-review.

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

## F5 Editor Architecture

**Status:** Implemented and verified in `feature/f5-editor` worktree.

F5 introduces a private `@rogatio/editor` package as the shared browser-facing editor boundary. It is a framework-free ESM package that owns a project editor's DOM view, draft state, common matcher editing, navigation, and accessible interaction model. It does not own persistence, browser-core lifecycle, permissions, extension APIs, CLI process behavior, runtime behavior, or rule actions.

F5 introduces a private `@rogatio/editor` package as the shared browser-facing editor boundary. It is a framework-free ESM package that owns a project editor's DOM view, draft state, common matcher editing, navigation, and accessible interaction model. It does not own persistence, browser-core lifecycle, permissions, extension APIs, CLI process behavior, runtime behavior, or rule actions.

### Package and Host Boundary

The dependency direction remains:

```text
schema -> compiler -> editor
```

F5 uses F2 types and the F3 diagnostic/validation contract. The editor's public browser entry point does not import the current runtime-compiled Node ESM artifacts from F2 or F3. Instead, the host supplies a synchronous validation adapter and an asynchronous save adapter. A Node host can implement the validation adapter with `compileProject`; a later browser host must supply an explicitly approved browser-safe F2/F3 adapter. This prevents Ajv or Node-only modules from leaking into the editor browser bundle while keeping F2/F3 authoritative.

The initial value must be a valid, parsed JSON project accepted by the supplied validator. The editor takes a defensive JSON snapshot and refuses to mount an invalid or hostile initial value rather than coercing, dropping, or silently repairing data. Repairing an invalid file remains a host or later workflow concern.

The conceptual public boundary is:

```ts
interface EditorOptions {
  root: HTMLElement;
  initialProject: unknown;
  validate: (value: unknown) => readonly EditorDiagnostic[];
  save: (project: EditorProjectSnapshot) =>
    | EditorSaveResult
    | Promise<EditorSaveResult>;
  onCancel?: () => void;
  ruleTypes?: readonly RuleTypeFieldExtension[];
}

interface EditorController {
  getDraft(): EditorProjectSnapshot;
  isDirty(): boolean;
  validate(): readonly EditorDiagnostic[];
  destroy(): void;
}
```

`createEditor(options)` returns a mounted controller. `getDraft()` always returns a fresh detached snapshot. Save callbacks receive a fresh snapshot and cannot mutate the controller's state through that argument. Save results are either `{ ok: true }` or a safe host error containing a stable code, optional JSON-pointer path, and safe message.

### Controller, View, and State

One controller owns the committed snapshot, draft snapshot, monotonic draft revision, route, search query, focused entity, validation state, and save state. The view is a semantic DOM projection and emits intents; it does not call F2/F3, serialize projects, or mutate shared state. DOM event delegation and keyed group/rule identities keep repeated controls from capturing stale array indexes.

The common F2 fields remain the editor's complete F5 data surface: project name and description; group ID, name, origins, and rules; and rule ID, name, URL regular expression, origins, resource types, priority, and optional method. Existing source spellings and array order are preserved unless the user edits them; F3 normalization is not written back by F5. New IDs are deterministic collision-free values selected from the current project. Array order is source order and is never inferred from priority.

Draft transitions are explicit:

- An edit increments the draft revision, leaves the committed snapshot unchanged, marks the editor dirty, and clears stale validation errors.
- Validate checks the current detached draft and renders sorted stable diagnostics without saving.
- Save validates first, captures the current revision and snapshot, and disables conflicting mutations while the host operation is pending. A success commits only when the captured revision is still current. A failure retains the exact draft and dirty state for retry. A late result after destroy is ignored.
- Cancel requires an accessible confirmation when dirty, restores the committed snapshot, clears errors, and then calls the optional host callback. Cancel is disabled while a save is pending rather than racing a host write.
- Destroy removes only editor-owned DOM and listeners and performs no save or cancel callback.

### View and Navigation

The view uses a semantic `main`, `nav`, `form`, headings, `fieldset`/`legend`, native inputs/selects/checkboxes, and a live status region. The desktop route rail contains Project and one route per group. A synchronized native select is the compact mobile navigation. Routes are internal editor state, not browser history or host persistence. Removing the current group falls back to Project and announces the change.

The contextual command bar keeps Validate, Save, and Cancel available and exposes only commands valid for the current route or focused entity, such as Add group, Add rule, move, and remove. Remove actions use a cancellable accessible alert dialog and name the affected group or rule. Reorder commands operate on the item's absolute source position even when search is active; announcements include the resulting position so hidden neighboring items cannot make the operation ambiguous.

Search is project-wide, literal, case-insensitive, and NFKC-normalized for matching only. It searches common project, group, and rule fields, reports deterministic source-order results, and navigates to the selected group or field without changing project data. It never treats user text as a regular expression. Search updates are region-level updates rather than full document replacement on every keystroke.

### Validation and Extension Boundary

The host validation adapter returns F3-compatible stable diagnostics with an error code, JSON-pointer path, and safe message. F5 sorts them deterministically, maps current paths to stable entity identities and controls, renders a summary with links, sets `aria-invalid`, and associates each error with its field. F5 never exposes raw Ajv wording or rejected input values. Extension diagnostics use the same path contract. A validator throw becomes a generic editor validation error and never permits saving.

The rule-type extension point is an empty registry in F5. Each future extension has a stable ID and label, a pure matcher, synchronous mount/cleanup, controlled field access, control registration, and synchronous validation. It receives defensive snapshots and can set only extension-owned fields through a controlled store; it never receives the live project or common-field mutators. Duplicate registrations, multiple matches, callback throws, cyclic values, malformed values, and unregistered controls fail closed with stable editor diagnostics. Unknown action data is not silently discarded or passed through: it is saveable only when a future extension and its host validator explicitly own it. F5 defines no action discriminant or action payload.

### URL Conversion

The common editor exposes `urlToExactRegex` as a pure utility. It accepts an absolute HTTP(S) URL with no surrounding whitespace, controls, credentials, or fragment. WHATWG URL serialization supplies deterministic normalization for scheme, hostname, default ports, empty paths, and percent encoding while preserving query order and duplicates. The serialized URL is escaped as a literal and wrapped in `^` and `$`; no flags, wildcard, capture, or matching execution is added. Conversion fails without changing the rule when the URL is malformed or the generated source exceeds the F2 regex limit. Fragments are rejected because browser request targets do not include them.

### Accessibility, Security, and Build Constraints

All user-controlled values are inserted as text or DOM properties, never as HTML. The editor does not evaluate user regular expressions or JavaScript, contact a network, access a filesystem, request permissions, use storage, emit telemetry, or invoke runtime/browser-core APIs. F2/F3 remain responsible for authoritative bounds and validation. Defensive snapshots reject accessors, proxies, inherited/sparse properties, symbols, cycles, and unsupported non-JSON objects without invoking hostile getters.

The view must remain keyboard complete without drag-and-drop or pointer-only commands. Error controls use stable generated IDs, labels, descriptions, focus restoration, and live announcements. Focus indicators and state must remain visible in forced colors; the layout must reflow at narrow widths and 200% zoom without clipping or requiring horizontal scrolling for core controls. CSS uses native/system colors in forced-colors mode and respects reduced-motion preferences.

The editor browser artifact must contain no `node:` imports, Node globals, filesystem code, or runtime-compiled F2/F3 imports. Build and browser checks must import the shipped browser artifact, not only source or a test double. Pure state/conversion tests belong in Vitest; controller/DOM interaction, keyboard, error association, responsive, forced-colors, zoom, and browser-package checks belong in Playwright. No DOM emulation dependency is introduced solely for F5.

### Rejected Alternatives

- A framework UI was rejected because it violates the shared framework-free boundary and adds CLI/extension packaging cost.
- Direct browser imports of current F2/F3 runtime artifacts were rejected because their Node ESM/Ajv initialization is not an approved MV3-safe boundary.
- Browser storage or browser-core callbacks inside F5 were rejected because persistence, lifecycle, permissions, and conflicts belong to later hosts.
- Full string-template rendering was rejected because it increases XSS and focus-loss risk; the view uses safe DOM construction.
- Drag-and-drop and visible-index reorder were rejected because they exclude keyboard users and become unsafe under filtering.
- An arbitrary `action: unknown` passthrough was rejected because it bypasses strict F2 validation and can lose or persist unsupported data.
