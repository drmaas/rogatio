# F5 - Editor Package

**Synthesis model:** `opencode-go/gpt-5.6-luna`
**Adversarial model:** `opencode-go/gpt-5.6-luna` (fresh adversarial pass)
**Status:** Implemented and verified
**Feature:** F5
**Depends on:** F2, F3
**Enables:** F7, F8, and later rule-type editor slices

## Problem Statement and Goals

F2 defines the common version-1 `.rogatio.json` envelope and F3 provides a stable browser-neutral matcher boundary, but there is no shared editor for users or future CLI/extension hosts. F5 establishes the smallest complete editor boundary that can be hosted by both without committing the repository to a UI framework, browser lifecycle API, persistence implementation, or action-specific rule behavior.

Goals:

- Provide a private, framework-free `@rogatio/editor` ESM package with a DOM controller and accessible view.
- Edit all F2 project metadata, group data, and common matcher fields.
- Create, reorder, and remove groups and rules while preserving stable IDs and source order.
- Convert an absolute HTTP(S) URL into a deterministic exact-match regular-expression source.
- Keep committed and draft project state detached and revision-aware.
- Validate drafts through a host-supplied F2/F3-compatible adapter, show field-level errors, and save only after successful validation.
- Provide project-wide literal search, Project/group destinations, a contextual command bar, desktop route rail, and compact mobile navigation.
- Expose a controlled rule-type field extension point for later vertical slices without defining action data in F5.
- Support keyboard operation, screen readers, forced colors, narrow layouts, and 200% zoom without a DOM-emulation runtime dependency.

## Scope

F5 includes:

- The private `@rogatio/editor` package boundary and browser-safe ESM entry point.
- A controller that owns a detached committed snapshot, detached draft snapshot, route, search state, validation state, save state, and focus identity.
- Project name and description editing.
- Group ID, name, origins, create, source-order reorder, and remove behavior.
- Rule ID, name, URL regular expression, origins, resource types, priority, optional method, create, source-order reorder, and remove behavior.
- Explicit Validate, Save, and Cancel commands with stable host error handling.
- Field-level and summary-level diagnostic rendering from stable JSON-pointer paths.
- A pure URL-to-exact-regex conversion utility.
- Project-wide common-field search and route navigation.
- Accessible semantic DOM, scoped responsive CSS, desktop route rail, compact mobile navigation, and contextual commands.
- A controlled rule-type field extension registry with no F5 action implementation.
- Tests and build checks specified in this document; implementation is gated on Stage 4 approval.

## Explicit Non-Goals

F5 does not implement:

- `browser-core` storage, migrations, compare-and-swap, permissions, enablement, conflicts, runtime state, diagnostics, or badge state.
- Chrome, WebExtensions, Declarative Net Request, extension manifests, browser permissions, or browser-specific translation.
- CLI process management, filesystem reads/writes, `edit`, `verify`, or `runtime` commands.
- Any local storage, network access, telemetry, hosted service, account, or retained traffic history.
- Rule actions or action-specific behavior for redirects, query parameters, headers, mocks, body transformations, runtimes, proxies, TLS, or dry runs.
- A fixed action discriminant, action schema, or opaque `action: unknown` passthrough.
- Repair-mode editing for an invalid initial document.
- Browser history, deep-link routing, merge behavior, or external committed-state updates.
- A UI framework, Web Components requirement, shadow DOM contract, CSS framework, or DOM emulation dependency.

## Actors, Entry Points, and Environments

### Actors

- A user editing a local project with a keyboard, pointer, touch device, screen reader, forced-colors setting, or enlarged viewport.
- A future CLI editor host that supplies a validated project and owns file persistence.
- A future Chrome extension host that supplies a browser-safe validation adapter and owns browser lifecycle.
- Later rule-type packages that register their own fields and validation through the F5 extension point.
- A host adapter providing F2/F3-compatible validation and safe save results.

### Entry Points

- `createEditor(options)` mounts the editor into a supplied `HTMLElement`.
- `EditorController.validate()` performs the same validation as the visible Validate command and returns the current diagnostics.
- The visible Validate, Save, Cancel, CRUD, reorder, search, navigation, and URL conversion controls.
- `urlToExactRegex(value)` converts a URL without mutating a rule.
- `EditorController.getDraft()` returns a fresh detached snapshot for host inspection or testing.

### Supported Environments

- Browser DOM environments supported by the current Chrome target and by future CLI/extension hosts that provide a conforming `Document`.
- Node.js `24+`, pnpm `10.32.1`, strict TypeScript 7, ESM/NodeNext, and esbuild remain the repository build baseline.
- F5 source has no Node runtime requirement in its browser entry. Node-only F2/F3 artifacts may be used by a Node host adapter, not imported by the browser entry.
- The editor supports multiple instances in one document when each instance has its own root and options.

## Public API and Data Contracts

The following is the normative shape; names may be adjusted only if the same contracts and stable behavior remain.

```ts
export interface EditorDiagnostic {
  readonly code: string;
  readonly severity: "error";
  readonly path: string; // JSON Pointer; "" is the root.
  readonly message: string; // safe, stable, user-facing text.
}

export type EditorProjectSnapshot = Readonly<RogatioProject> &
  Readonly<Record<string, unknown>>;

export type EditorSaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly path?: string;
      readonly message?: string;
    };

export interface EditorOptions {
  readonly root: HTMLElement;
  readonly initialProject: unknown;
  readonly validate: (
    value: unknown,
  ) => readonly EditorDiagnostic[];
  readonly save: (
    project: EditorProjectSnapshot,
  ) => EditorSaveResult | Promise<EditorSaveResult>;
  readonly onCancel?: () => void;
  readonly ruleTypes?: readonly RuleTypeFieldExtension[];
}

export interface EditorController {
  getDraft(): EditorProjectSnapshot;
  isDirty(): boolean;
  validate(): readonly EditorDiagnostic[];
  destroy(): void;
}

export class EditorInitializationError extends Error {
  readonly diagnostics: readonly EditorDiagnostic[];
}

export interface RuleTypeFieldExtension {
  readonly id: string;
  readonly label: string;
  readonly matches: (
    rule: Readonly<Record<string, unknown>>,
  ) => boolean;
  readonly mount: (
    context: RuleTypeFieldContext,
  ) => RuleTypeFieldMount;
  readonly validate: (
    rule: Readonly<Record<string, unknown>>,
    rulePath: string,
  ) => readonly EditorDiagnostic[];
}

export interface RuleTypeFieldContext {
  readonly document: Document;
  readonly container: HTMLElement;
  readonly rulePath: string;
  readonly getField: (name: string) => unknown;
  readonly setField: (name: string, value: unknown) => void;
  readonly deleteField: (name: string) => void;
  readonly registerControl: (
    fieldPath: string,
    control: HTMLElement,
  ) => void;
}

export interface RuleTypeFieldMount {
  destroy(): void;
}

export type UrlConversionResult =
  | { readonly ok: true; readonly source: string }
  | {
      readonly ok: false;
      readonly code: "editor.invalid-url" | "editor.url-too-long";
    };

export function createEditor(options: EditorOptions): EditorController;
export function urlToExactRegex(value: string): UrlConversionResult;
```

`createEditor` defensively validates and snapshots `initialProject` before changing the root. An invalid or hostile initial value raises a stable initialization error containing safe diagnostics; it is not partially rendered or coerced. The host can use F2/F3 to report the invalid document before opening F5. Draft values are JSON-like own-data snapshots. F5 never returns its live internal object.

An extension receives a frozen defensive rule snapshot and a container owned by F5. Field names passed to its controlled store must be extension-owned; attempts to write common F2 fields are rejected. The extension must register each field control with its JSON-pointer suffix so F5 can associate diagnostics and focus. Matching, mounting, validation, and cleanup are synchronous and deterministic. F5 accepts one matching extension per rule and takes no action-specific dependency on the extension's data shape.

The reference Node adapter is conceptually:

```ts
const validate = (value: unknown) => {
  const result = compileProject(value);
  return result.ok ? [] : result.diagnostics;
};
```

The browser host must replace that adapter with an approved browser-safe boundary. F5 does not assume that a TypeScript type proves validation and does not call the current Node-only F2/F3 runtime modules from its browser entry.

## Functional Requirements

- **F5-REQ-001:** The workspace shall contain a private `@rogatio/editor` ESM package with explicit exports and a browser-safe entry that has no framework runtime dependency or Node built-in import.
- **F5-REQ-002:** `createEditor` shall require a root element, an initial project value, a synchronous validation adapter, an explicit save adapter, and optional cancel and rule-type adapters. It shall not own persistence or host navigation.
- **F5-REQ-003:** The editor shall validate the initial value at the boundary, reject hostile or invalid initial values without partial rendering, and keep detached committed and draft snapshots without mutating caller-owned data.
- **F5-REQ-004:** The editor shall edit project name and optional description with the F2 bounds and expose stable control paths for errors.
- **F5-REQ-005:** The editor shall create, edit, reorder, and remove groups, including IDs, names, origins, and child-rule relationships.
- **F5-REQ-006:** The editor shall create, edit, reorder, and remove rules and expose every F2 common matcher field: ID, name, URL regular expression, origins, resource types, priority, and optional method.
- **F5-REQ-007:** Structural commands shall preserve stable IDs, source array order, priority values, source spellings, and the relative order of unaffected records. New IDs shall be deterministic and collision-free within the project.
- **F5-REQ-008:** `urlToExactRegex` shall convert only valid absolute HTTP(S) URLs without credentials or fragments into an escaped, case-sensitive, anchored literal source and shall reject malformed or over-limit input without changing draft state.
- **F5-REQ-009:** Validate and Save shall run the host adapter against a fresh current snapshot. F5 shall map stable diagnostic paths to fields and a summary, sort diagnostics deterministically, and never expose raw validator wording or rejected values.
- **F5-REQ-010:** Save shall call the host exactly once per accepted user activation, only after validation succeeds. It shall commit the captured snapshot and clear dirty state only after a current save succeeds.
- **F5-REQ-011:** Save failures, thrown adapter errors, and stale asynchronous completions shall not lose or replace newer draft data. The exact draft remains retryable, and a pending save prevents conflicting edits or Cancel races.
- **F5-REQ-012:** Cancel shall be a local discard operation. When dirty it shall require a named, cancellable confirmation, restore the committed snapshot, clear validation state, and then notify the optional host callback. It shall never save.
- **F5-REQ-013:** Search shall be project-wide, literal, NFKC-normalized and case-insensitive for matching, deterministic in source order, and limited to common project/group/rule fields in F5. It shall not mutate data or execute a user query as a regular expression.
- **F5-REQ-014:** Navigation shall expose Project and one stable-ID route per group through a desktop route rail and synchronized compact mobile control. Route removal or invalidation shall fall back to Project and announce the result.
- **F5-REQ-015:** The contextual command bar shall expose only applicable commands, including Validate, Save, Cancel, Add group, Add rule, reorder, and remove. Every command shall have a stable accessible name, disabled state, reason where applicable, and focus result.
- **F5-REQ-016:** Remove commands shall use an accessible, keyboard-cancellable confirmation surface naming the target and shall not use an irreversible one-click deletion path.
- **F5-REQ-017:** The rule-type extension point shall support stable registration, matching, synchronous field mounting/cleanup, controlled extension-field reads/writes, control registration, and validation without giving extensions a live project reference or common-field mutator.
- **F5-REQ-018:** F5 shall reject duplicate extension registrations, ambiguous matches, extension callback failures, malformed extension values, and unowned unknown data without silently discarding or persisting it.
- **F5-REQ-019:** The view shall use semantic landmarks, headings, labels, descriptions, fieldsets, native controls, stable error associations, `aria-invalid`, and live status/error regions. It shall be fully operable by keyboard without drag-and-drop.
- **F5-REQ-020:** The view shall remain usable at narrow widths and 200% zoom, provide a compact mobile navigation mode, preserve visible focus, and render meaningful borders/state in forced-colors mode without relying on color alone.
- **F5-REQ-021:** F5 shall not access filesystem, network, browser permissions, storage, runtime, telemetry, or host lifecycle APIs. All user data shall be rendered through safe DOM properties/text nodes and never interpolated into HTML.
- **F5-REQ-022:** The browser build shall prove that Node-only F2/F3 runtime imports and Node globals are absent. Browser checks shall exercise the shipped artifact, not only source or a stub.
- **F5-REQ-023:** The implementation shall use keyed, region-level updates and stable entity identity so ordinary input, focus, selection, composition, and scroll position are not lost through unrelated rerenders. It shall remain practical at the F2 maximum of 4,096 rules.
- **F5-REQ-024:** Multiple editor instances shall have isolated state, listeners, styles, registries, IDs, routes, and diagnostics.

## Observable Acceptance Criteria

### Mounting and Draft Safety

- **F5-AC-001:** A valid F2 project mounts in a supplied root and exposes labeled project, group, and common rule controls; an invalid, cyclic, sparse, accessor-backed, proxy-backed, inherited, symbol-bearing, or unsupported initial value fails closed without invoking hostile getters or partially changing the root.
- **F5-AC-002:** Editing any field, creating/removing/reordering records, and changing search or route state does not mutate the original input. `getDraft()` and save arguments are detached from the controller and from each other.
- **F5-AC-003:** Reverting a field to its committed value makes `isDirty()` false; route/search changes alone do not make the project dirty.

### Common Editing and Order

- **F5-AC-004:** Project name and description edits preserve F2 field paths and permit the documented boundary values; invalid blanks, types, and lengths remain in the draft but are reported on validation.
- **F5-AC-005:** Add group appends a valid-identity draft record with a deterministic unused ID, focuses its name or first invalid field, and exposes editable ID/name/origins/rules without changing existing records.
- **F5-AC-006:** Add rule appends a common matcher draft with a deterministic unused ID, default resource type and priority, and visible required fields for its URL regex and effective origin.
- **F5-AC-007:** Group and rule edits preserve group-origin inheritance semantics and map effective-origin diagnostics to the rule origins control.
- **F5-AC-008:** Move commands use absolute source positions, preserve all unaffected record order and IDs, do not sort by priority, and produce correct results while search hides neighboring records.
- **F5-AC-009:** Remove confirmation names the target; cancel leaves the exact draft unchanged, while confirmation removes only the requested record and falls back from a removed route safely.

### URL Conversion and Validation

- **F5-AC-010:** A valid absolute HTTP(S) URL is serialized by the defined URL policy, regex metacharacters are escaped, the source is wrapped in `^` and `$`, no flags or captures are added, and the rule changes only after an explicit conversion command.
- **F5-AC-011:** Credentials, fragments, surrounding whitespace, control characters, non-HTTP(S) schemes, malformed URLs, and generated sources above `LIMITS.maxUrlRegexLength` are rejected with a safe field error and no draft mutation.
- **F5-AC-012:** Validate renders a summary and field-level errors for root, group, rule, and nested array paths from the F3-compatible adapter; each error has a stable ID, links to a control when one exists, sets `aria-invalid`, and is announced without exposing rejected values or Ajv prose.
- **F5-AC-013:** Validation results are deterministic by path, code, and message. A validation throw produces a stable root error, no save call, and a retryable draft.
- **F5-AC-014:** A valid draft causes Save to invoke the host once with a detached snapshot. Dirty state clears only after a successful current result; a host rejection or thrown error preserves the exact draft, displays a safe retryable error, and permits a later save.
- **F5-AC-015:** Delayed save results cannot commit over a newer revision; pending save state prevents edit/Cancel races, and destroy ignores late results without mutating the DOM or invoking callbacks.
- **F5-AC-016:** Dirty Cancel requires confirmation, restores the last committed snapshot, clears errors, and calls `onCancel` only after discard. Clean Cancel does not change data and calls `onCancel` once when supplied.

### Search, Navigation, and Commands

- **F5-AC-017:** Search matches the documented common fields literally with deterministic case-insensitive NFKC matching, reports result counts, preserves draft data, and navigates a selected result to its stable group/field.
- **F5-AC-018:** Desktop and mobile navigation expose the same Project/group destinations, synchronize selection, preserve route identity across rename/reorder, and recover to Project after group removal.
- **F5-AC-019:** The command bar changes with context, exposes applicable command names and disabled reasons, returns focus to the affected stable control after mutations, and provides a non-pointer path for every command.

### Accessibility and Compatibility

- **F5-AC-020:** Keyboard-only interaction can reach and operate metadata, CRUD, reorder, search, route, URL conversion, validation, save, cancel, and confirmation controls without a pointer or shortcut-only requirement.
- **F5-AC-021:** A browser accessibility inspection and screen-reader-oriented Playwright journey find one main landmark, labeled navigation, a logical heading hierarchy, labeled controls, associated descriptions/errors, live validation/save status, and visible focus after rerender.
- **F5-AC-022:** At a narrow mobile viewport and at 200% zoom the editor reflows to compact navigation without clipping core controls or requiring horizontal scrolling; forced-colors mode retains visible boundaries, focus, errors, and command states without color-only meaning.
- **F5-AC-023:** Two mounted instances can be edited, searched, validated, and destroyed independently without shared state, IDs, listeners, style removal, or diagnostics.

### Boundaries, Performance, and Build

- **F5-AC-024:** Extension registration and field journeys prove controlled writes, defensive snapshots, duplicate/ambiguous registration rejection, callback failure isolation, stable extension diagnostics, and no common-field or validation bypass.
- **F5-AC-025:** A maximum-size project within F2 limits can mount, search, reorder, validate, and render errors within the approved performance budget without full-document replacement on each keystroke. The benchmark records the agreed budget rather than treating a skipped browser run as success.
- **F5-AC-026:** The shipped browser artifact imports and runs in the Playwright browser fixture with no Node globals/imports, no runtime-compiled F2/F3 import, and no network or filesystem request. Node Vitest covers pure conversion/state behavior; Playwright covers DOM behavior.
- **F5-AC-027:** Package dependency checks prove `schema -> compiler -> editor`, no downstream-package or action-specific behavior enters F5, and existing F1-F3 validation remains intact.

## API, UI, File-Format, and Compatibility Impact

- **Package API:** Adds the private `@rogatio/editor` package and its controller, diagnostic, save, URL conversion, and extension types. No F2 or F3 API changes are required.
- **Host API:** Hosts must provide validation and save callbacks. A host owns serialization, persistence, navigation closure, and browser lifecycle. F5 passes a detached project snapshot, not a file handle or storage object.
- **UI:** Adds a framework-free accessible editor view with Project/group destinations, common field forms, search, command bar, desktop rail, mobile navigation, and confirmation/error surfaces.
- **File format:** F5 writes no file and introduces no version or migration. It edits the existing version-1 common envelope. Action-specific fields remain outside F5 unless an approved later extension and validator own them.
- **Compatibility:** The browser entry targets the current Chrome environment and portable standard DOM/CSS APIs. Node 24 and the repository's pnpm/TypeScript/ESM baseline remain unchanged. The current Node-only F2/F3 artifacts are not browser-compatible entry points.
- **Public product behavior:** No `edit` CLI, extension, browser-core, runtime, permission, or storage behavior is shipped by F5 alone.

## Security, Privacy, Accessibility, Performance, and Operations

### Security and Privacy

- Treat initial projects, field values, diagnostics, and extension values as untrusted structured data.
- Use defensive own-data snapshots and reject accessors, proxies, inherited/sparse records, cycles, symbols, and unsupported objects without invoking getters or mutating the source.
- Use text nodes and property assignment for all user content. Internal DOM IDs are generated by the controller and are never derived directly from unescaped user IDs.
- Do not use `innerHTML` with user values, `eval`, `Function`, dynamic script loading, network requests, filesystem APIs, storage, permissions, telemetry, or runtime calls.
- Do not execute user regexes for search or preview. URL conversion only escapes a URL; F2/F3 remain the validation authority.
- Do not echo credentials, rejected values, raw Ajv messages, or third-party exception text in public diagnostics.
- Treat extensions as trusted shipped code but isolate their state and callback failures; they receive controlled snapshots and cannot mutate the live common model.

### Accessibility and Responsive Behavior

- Use native form controls, explicit labels, descriptions, legends, headings, landmarks, and stable error associations.
- Announce validation, save, search counts, route changes, and structural changes through concise live status; errors use an alert summary and field descriptions without duplicate noisy announcements.
- Maintain logical tab order, visible `:focus-visible`, keyboard-cancellable confirmation, focus restoration after keyed updates, and IME-safe input handling.
- Do not make color, icon, hover, drag, or a keyboard shortcut the only way to understand or operate a state.
- Use CSS media queries based on available layout size so 200% zoom can enter the mobile navigation mode. Forced colors use system colors and visible borders.
- Respect reduced-motion preferences and avoid fixed-height content that clips errors or controls.

### Performance and Operations

- Keep search and field input literal and bounded by F2 limits. Use keyed region updates instead of replacing the complete editor tree for each keystroke.
- The implementation must benchmark the maximum 4,096-rule project. The exact latency budget is a Stage 4 decision; the initial verification target is a p95 of 250 ms for search/ordinary local commands in the reference Chromium run and a p95 of 1 second for initial mount.
- Validation and save status must be explicit. Missing browser prerequisites or a missing browser-safe adapter are failures, not skipped success.
- F5 has no process, deployment, secret, migration, or external operational state.

## Migration, Rollout, and Rollback

F5 is a greenfield package and does not change the version-1 file format. There is no data migration, storage migration, or compatibility shim. A host must validate a project before opening the editor; a later action extension must provide its own schema/compiler compatibility before F5 can own those fields.

Rollout adds the package and its browser artifact, tests, and documentation after approval. A rollback removes or reverts the editor package and host wiring; existing `.rogatio.json` data is unaffected. The host save adapter is responsible for atomic persistence and for returning a safe failure result. F5 never claims to roll back a host write that already succeeded.

## Assumptions and Open Questions

- The current F2/F3 Node ESM artifacts remain unsuitable for direct browser/MV3 loading. The selected F5 mitigation is an injected adapter; the browser-safe packaging strategy remains a decision for the browser host boundary.
- The initial editor opens only a valid project. The human must decide whether a future CLI flow needs an in-editor repair mode for invalid files.
- URL conversion rejects fragments and canonicalizes through WHATWG URL serialization. The human must confirm that request matching should reject fragments rather than preserve them as literal text.
- Save is synchronous to start and may complete asynchronously; F5 blocks conflicting edits and Cancel while pending. The human must decide whether later browser-core conflict/abort signals require a dedicated host protocol.
- The extension contract is intentionally data-shape-neutral. Later rule slices must decide their canonical action namespace, extension versioning, unknown-field round-trip policy, and whether extension fields participate in search.
- Routes are internal editor state and do not own browser history or deep links. A host may wrap them later; the human must confirm this is sufficient for CLI and extension shells.
- The initial performance target is p95 250 ms for search/local commands and p95 1 second for mount at the documented maximum. The human may adjust it before implementation.
- Current Chrome is the browser target; the exact Chrome and assistive-technology compatibility matrix remains open.

## Stage 4 Approval Gate

The implementation plan, tests, package metadata, and production code must not be written until the user explicitly approves this specification and the F5 architecture decisions in `docs/architecture.md`. Approval must address the open questions that materially change the public host, URL, extension, or browser boundary.

**Approval recorded:** The user approved the specification in the F5 workflow session. Implementation and verification completed in the `feature/f5-editor` worktree. All acceptance criteria verified via `pnpm validate`.
