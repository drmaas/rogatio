# Rogatio Architecture

**Status:** F23 unified native-host runtime direction approved and implemented for the current start/stop-only extension control surface.

## F23 Unified Native-Host Runtime Direction

One extension-launched native host owns mock, response-body, request-body, internal proxy/TLS, and upstream forwarding. Native messaging carries lifecycle, policy, and metadata/control; observed traffic bodies remain in the host-owned interception path. Start is transactional and installs exact scoped PAC routing after policy, trust, capability, and collision checks. Stop removes only owned routing, aborts active operations, invalidates capabilities, clears transient body buffers, and restores prior proxy state.

The extension exposes only Start runtime and Stop runtime during normal use. Separate Check and connect actions and mock connection state are removed. Non-matching or unsupported requests pass through untouched, and only the highest-priority matching request-body rule applies. CLI functionality remains limited to one-time host installation, CA trust, and administrative diagnostics; it is not required to connect or operate a browser session.


## Package Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        @rogatio/schema                            │
│  JSON Schema v1, AJV validation, origins, bounds, forbidden hdrs │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @rogatio/compiler                            │
│  Validated source → browser-neutral operations + diagnostics    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌────────────────────┐
│ @rogatio/        │ │ @rogatio/    │ │ @rogatio/          │
│ browser-core     │ │ editor        │ │ runtime            │
│ Storage, perms,  │ │ Framework-   │ │ Mock/response      │
│ enablement, CAS  │ │ free DOM     │ │ server foundation  │
└────────┬─────────┘ └──────┬───────┘ └────────┬───────────┘
         │                  │                   │
         └──────────────────┼───────────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ @rogatio/cli        │ ◄── NEW
                 │ edit, verify, runtime│
                 └──────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     ┌─────────────────┐           ┌───────────────┐
     │ Chrome MV3 Ext  │           │ Native Runtime │
     │                 │           │                │
     └─────────────────┘           └───────────────┘
```

## Security and Privacy Boundaries

The project introduces only development and validation tooling plus the local-first product packages described below. It must not add credentials, telemetry, hosted endpoints, traffic capture, native messaging, proxies, TLS handling, or persistent user data beyond the version-controlled `.rogatio.json` project file. Dependencies are controlled by the committed pnpm lockfile, exact or explicitly governed tool versions, separated development dependencies, and a reviewed install-script policy. Generated files and secrets must not enter version control.

## Schema Architecture

The schema package introduces `@rogatio/schema` as the authoritative validation boundary for the common version-1 `.rogatio.json` envelope. The package owns the root project metadata, named groups, explicit HTTP(S) origins, and common rule matcher fields: stable IDs, labels, case-sensitive URL regular expressions, resource types, priority, and optional method. It does not implement action payloads or any consumer behavior; later rule slices extend the version-1 schema with their own action fields.

The schema is draft 2020-12 with strict additional-property rejection. Ajv compiles it with all-errors reporting and with coercion, defaults, and property removal disabled. A small semantic validation layer supplements JSON Schema for globally unique IDs, non-empty effective origins, and the total rule bound. All errors use stable JSON-pointer paths and no rejected document is persisted or sent over the network.

Origin validation accepts only explicit `http` and `https` origins with a hostname and optional valid port. Credentials, paths, query strings, fragments, wildcard hosts, and other schemes are rejected. Bounds and browser-neutral resource/method enumerations are exported from the package. Request and response forbidden-header lists are frozen and matched case-insensitively for later header-rule slices.

The verified schema distribution target is a Node ESM artifact because Ajv compiles its validator at module initialization. Browser and MV3 consumers must receive a later approved standalone/browser packaging strategy rather than loading this runtime-compiled entry under an extension CSP.

## Compiler Architecture

The compiler package adds `@rogatio/compiler` as a pure, Node ESM transformation boundary from validated schema projects to browser-neutral matcher operations. Because the schema envelope intentionally contains no action fields, the compiler emits one data-only matcher operation per source rule. Later rule slices add action-specific compiler operations; the compiler does not invent a no-op action or a browser-specific representation.

The public `compileProject(value: unknown)` entry point invokes the complete schema structural and semantic validation boundary before compiling. Invalid input returns a discriminated failure with stable compiler diagnostics and an empty operation list. A valid project produces fresh, serializable output: group and rule traversal order is preserved, group and rule origins are normalized, unioned, deduplicated, and sorted deterministically, resource types use the shared canonical order, the exact regex source is retained with empty flags, and method and priority values pass through unchanged. The compiler does not sort by priority or expand a rule into an origin/resource-type Cartesian product.

Compiler diagnostics use stable codes, severity, JSON-pointer paths, and structured parameters rather than exposing Ajv message text as an API contract. The package depends only on `@rogatio/schema`, has no browser or downstream-package dependency, and inherits the verified Node ESM distribution target. It performs no matching, action transformation, browser permission/DNR translation, filesystem, network, persistence, runtime, telemetry, or traffic-capture work.

## Browser-Core Architecture

The browser-core package adds `@rogatio/browser-core` as the browser-neutral core platform layer between `compiler` and the future extension/CLI surfaces. It owns versioned project storage, migrations, per-project permissions and enablement, compare-and-swap lifecycle, atomic rule installation with recovery, the in-memory runtime state model, rule status and badge computation, and stable core diagnostics. Every platform-specific capability enters through narrow injected adapters, so the same logic runs under Vitest and inside the future Chrome MV3 service worker. The verified distribution target remains Node ESM with `@rogatio/schema` and `@rogatio/compiler` externalized; MV3 packaging stays a later extension-boundary decision.

## Chrome MV3 Extension Architecture

The extension package adds a private `@rogatio/extension` package as the first downstream browser boundary. The extension owns Chrome MV3 adapters, the service-worker message protocol, the extension-page project-management shell, and the translation from browser-core matcher operations to deterministic Chrome Declarative Net Request rules. It depends on `browser-core`, `compiler`, `editor`, and `schema`; upstream packages remain browser-neutral and do not import Chrome APIs.

The service worker is the authority for `storage.local` persistence, permissions, project lifecycle commands, group enablement, actionless matcher projection, rule statuses, and the action badge; DNR installation remains deferred until action-bearing slices exist. It injects narrow adapters into the browser-core `ProjectRepository` and `InstallService`, so CAS, conflict preservation, single-active-project, 64-project, enablement, status, and rollback invariants remain implemented once. The extension page sends versioned, validated messages and mounts the shared editor for the active project's canonical source. Selecting a project is local UI state; only an explicit Switch command invokes the repository switch operation.

MV3 output is browser-bundled from the approved browser-safe source graph. The extension must not load the Node-oriented Ajv artifact or any Node global at runtime. Chrome API failures, malformed messages, hostile imported/storage values, and unknown protocol versions fail closed with stable extension diagnostics. Permission requests are projected from browser-core's sorted effective origins and never include undeclared origins or broad host patterns. Group activation remains separate from permission grant, and project creation/import/save never grants or enables anything automatically.

The common extension translator emits only a deterministic browser-neutral matcher projection. It preserves regex source, resource types, method, priority, and effective origins, assigns deterministic numeric ids for future action translation, and rejects unsupported operation kinds without installation. Because the compiler's matcher operation has no action, the extension reports actionless rules as `unsupported` and never sends them to DNR; it must not invent an allow or no-op action that changes browser behavior. `InstallService` remains the atomicity/recovery seam for later action-bearing DNR adapters. Action-specific operation kinds and their UI/editor extensions are deferred to later rule slices.

The extension emits no traffic or console diagnostics. The `[Rogatio]` DevTools Console record from the broader product overview is deferred to a later explicitly specified feature so its Chrome event source and redaction contract are not guessed inside the extension shell. The extension does not add network, runtime, native messaging, proxy, TLS, telemetry, or traffic persistence behavior.

Storage is a single versioned envelope (`version`, a project record keyed by stable id, and `activeProjectId`) persisted through a `StorageAdapter` whose `compareAndSwap` is the atomicity authority. Reads defensively snapshot raw storage and validate envelope structure; unknown versions, structural violations, cycles, symbols, accessors, and proxies fail closed with `core.storage-corrupt` and no writes. Project data is fully validated through the schema/compiler boundary at write time. Repository operations are read-modify-compare-and-swap: non-explicit operations retry on transient CAS failure, while editor-style saves and strict imports carry an expected revision and return a `conflict` result preserving the committed project for an explicit refresh path.

The repository maintains the documented product invariants: at most 64 uniquely named projects, exactly one active project whenever any exist (the first created/imported project activates; removing the active project activates the most recently updated remaining project, tie-broken by id), creation/import/update and browser save reset group enablement to all-disabled, and grants are restricted to declared effective origins and pruned when data changes. Switching restores the destination project's saved enablement without touching permission or runtime state.

Rule statuses derive from compiled operations, saved enablement, granted origins, and the installed rule ids reported by the installer adapter: disabled groups are `disabled`, enabled rules with un-granted origins are `needs permission`, enabled and granted rules missing from the installed set are `error` with `core.rule-not-installed`, and installed rules are `active`. The `needs proxy` and `unsupported` statuses are part of the defined model and populate only when runtime-dependent rule kinds land in later slices. The badge is a pure function of statuses: the active rule count plus an attention flag. `InstallService` atomically replaces the installed set through the `RuleInstallerAdapter`, treats identical sets as a no-op, rolls back to the previous set on failure with `core.install-failed` / `core.recovery-failed`, and serializes concurrent applies. Mock (`disconnected/checking/connected/failed` with last-check) and native (`stopped/starting/started/failed`) runtime phases are modeled in memory with a guarded transition table; runtime state is not persisted until the runtime slices define their semantics.

## Extension Toolbar Popup

The extension adds a compact Chrome toolbar popup (`popup.html` + `popup.ts`) as `action.default_popup`, sitting in front of the existing management page (`index.html`, which remains tab-opened). The popup reads the same `get-state` envelope the management page uses and lists only the active project's persisted groups in source order, each row showing the group name, rule count, truthful per-group runtime status, one enablement switch, and a pencil control. There is no editor, search, proxy, permission, or rule-authoring surface in the popup, and no extension-wide or project-wide master toggle.

The popup reuses the existing `set-group-enabled` lifecycle unchanged: toggling a group sends the same command the management page sends, and the service worker performs the identical enablement, permission-preserving, and DNR-install path. Per-group status is aggregated from the envelope's per-rule `ruleStatuses` with the precedence `error > needs proxy > needs permission > unsupported > active` (a disabled group is `disabled`; an enabled group with no rules is `active`). Because the popup reads only persisted state, unsaved editor drafts never appear, so every listed group is runtime-eligible and gets a toggle. "Open app" opens `index.html` (Overview); the pencil opens `index.html?group=<id>`, and the management page deep-links to that group via the additive `EditorController.navigateToGroup`. The popup adds no second editor and no popup-only persisted navigation state.

## Design System (F22)

The design system is the shared dark visual language for the editor, the CLI editor
host, the extension management page, and the toolbar popup. It is pure presentational
surface work: no product behavior, routes, persistence, or public API changes.

### Tokens, type, and assets

- Palette: page background `#121417` with a white dot-grid pattern, surfaces `#161B22`
  (raised `#1C222C`, inset `#10131A`), primary `#007AFF` (accent, links, active
  states), primary-strong `#0066D6` (filled button background so white button text
  meets WCAG AA), secondary `#64748B`, tertiary `#0F172A`, neutral `#1E293B`, text
  `#F8FAFC`, muted `#94A3B8`, danger `#F87171`, success `#4ADE80`, warning `#FBBF24`,
  borders `rgba(148, 163, 184, 0.16)`.
- Type: Hanken Grotesk for headlines and body; JetBrains Mono for labels, code,
  regex, and badges. Both are OFL-licensed and bundled as woff2 (400/500/700 and
  400/700) — never fetched at runtime. The editor package owns the font files under
  `packages/editor/assets/fonts/` together with their OFL license texts; the build
  copies them into the editor browser dist and the extension dist.

### Standalone stylesheet boundary

The editor no longer embeds a CSS string in its controller; it ships
`src/editor.css` as a real artifact (`dist/browser/index.css`) and the host supplies
it, mirroring the existing host-supplied validation and save ports. Hosts that mount
`createEditor` must link the stylesheet:

- CLI editor page links `/vendor/editor.css` and fonts at `/vendor/fonts/*` (new
  confined routes on the edit server).
- Extension `index.html` links `index.css` (editor) + `extension-page.css` (shell)
  and fonts at `/fonts/*`; `popup.html` links `popup.css`.
- The browser test fixture links `/editor/index.css`.

The extension package owns its shell stylesheet (`src/extension.css` →
`dist/extension-page.css`) and the popup stylesheet (`src/popup.css` →
`dist/popup.css`). All three stylesheets are esbuild outputs recorded in
`build-manifest.json`; the canonical validator asserts their presence, the MV3
forbidden-dependency guard continues to scan only JS artifacts, and
`scripts/serve-smoke.ts` serves `text/css` and `font/woff2` correctly. Each
stylesheet is scoped to its own root (`.rogatio-editor`, the management shell,
`.rogatio-popup`) so the three never bleed into each other.

### Layout and surfaces

The editor's desktop route rail becomes a top navigation bar (sticky, horizontal,
active route accented) while keeping its `data-desktop-route-rail` identity and
accessibility semantics; it stays hidden at narrow widths where the existing mobile
select navigation takes over. Cards, fieldsets, rule cards, test-result cards,
badges (pills in JetBrains Mono), buttons (primary/secondary/inverted/outlined/
danger/ghost), search, alerts, and dialogs follow the token system. The extension
management page reorganizes into a top app bar (brand, Dashboard/Workspace tabs,
Refresh/Export/Remove, badge pill) and a workspace sidebar (active-project card,
switch/create/import controls, runtime controls, group activation switches); the
Overview becomes a project-cards home while keeping the existing explicit-switch
invariant and every `data-*` attribute, role, label, and command name asserted by
browser tests. The popup is restyled as a dark card and uses the "Rogatio" brand. All
Rogatio documents use the "Rogatio" brand; no other product name appears.

### Accessibility and offline constraints

The theme keeps forced-colors token mapping, reduced-motion handling, visible focus
rings, keyboard completeness, and reflow at 200% zoom and narrow widths. Nothing in
the design system adds network access, telemetry, storage, or runtime dependencies;
the MV3 CSP is unchanged and all assets (CSS, fonts) ship inside the extension dist.

## Editor Architecture

The editor package introduces a private `@rogatio/editor` package as the shared browser-facing editor boundary. It is a framework-free ESM package that owns a project editor's DOM view, draft state, common matcher editing, navigation, and accessible interaction model. It does not own persistence, browser-core lifecycle, permissions, extension APIs, CLI process behavior, runtime behavior, or rule actions.

### Package and Host Boundary

The dependency direction remains:

```text
schema -> compiler -> editor
```

The editor uses schema types and the compiler's diagnostic/validation contract. The editor's public browser entry point does not import the current runtime-compiled Node ESM artifacts from the schema or compiler packages. Instead, the host supplies a synchronous validation adapter and an asynchronous save adapter. A Node host can implement the validation adapter with `compileProject`; a later browser host must supply an explicitly approved browser-safe schema/compiler adapter. This prevents Ajv or Node-only modules from leaking into the editor browser bundle while keeping the schema and compiler packages authoritative.

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

One controller owns the committed snapshot, draft snapshot, monotonic draft revision, route, search query, focused entity, validation state, and save state. The view is a semantic DOM projection and emits intents; it does not call the schema or compiler packages, serialize projects, or mutate shared state. DOM event delegation and keyed group/rule identities keep repeated controls from capturing stale array indexes.

The common schema fields remain the editor's complete data surface: project name and description; group ID, name, origins, and rules; and rule ID, name, URL regular expression, origins, resource types, priority, and optional method. Existing source spellings and array order are preserved unless the user edits them; Compiler normalization is not written back by the editor. New IDs are deterministic collision-free values selected from the current project. Array order is source order and is never inferred from priority.

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

The host validation adapter returns compiler-compatible stable diagnostics with an error code, JSON-pointer path, and safe message. The editor sorts them deterministically, maps current paths to stable entity identities and controls, renders a summary with links, sets `aria-invalid`, and associates each error with its field. The editor never exposes raw Ajv wording or rejected input values. Extension diagnostics use the same path contract. A validator throw becomes a generic editor validation error and never permits saving.

The rule-type extension point is an empty registry in the editor package. Each future extension has a stable ID and label, a pure matcher, synchronous mount/cleanup, controlled field access, control registration, and synchronous validation. It receives defensive snapshots and can set only extension-owned fields through a controlled store; it never receives the live project or common-field mutators. Duplicate registrations, multiple matches, callback throws, cyclic values, malformed values, and unregistered controls fail closed with stable editor diagnostics. Unknown action data is not silently discarded or passed through: it is saveable only when a future extension and its host validator explicitly own it. The editor defines no action discriminant or action payload.

### URL Conversion

The common editor exposes `urlToExactRegex` as a pure utility. It accepts an absolute HTTP(S) URL with no surrounding whitespace, controls, credentials, or fragment. WHATWG URL serialization supplies deterministic normalization for scheme, hostname, default ports, empty paths, and percent encoding while preserving query order and duplicates. The serialized URL is escaped as a literal and wrapped in `^` and `$`; no flags, wildcard, capture, or matching execution is added. Conversion fails without changing the rule when the URL is malformed or the generated source exceeds the schema regex limit. Fragments are rejected because browser request targets do not include them.

### Accessibility, Security, and Build Constraints

All user-controlled values are inserted as text or DOM properties, never as HTML. The editor does not evaluate user regular expressions or JavaScript, contact a network, access a filesystem, request permissions, use storage, emit telemetry, or invoke runtime/browser-core APIs. The schema and compiler packages remain responsible for authoritative bounds and validation. Defensive snapshots reject accessors, proxies, inherited/sparse properties, symbols, cycles, and unsupported non-JSON objects without invoking hostile getters.

The view must remain keyboard complete without drag-and-drop or pointer-only commands. Error controls use stable generated IDs, labels, descriptions, focus restoration, and live announcements. Focus indicators and state must remain visible in forced colors; the layout must reflow at narrow widths and 200% zoom without clipping or requiring horizontal scrolling for core controls. CSS uses native/system colors in forced-colors mode and respects reduced-motion preferences.

The editor browser artifact must contain no `node:` imports, Node globals, filesystem code, or runtime-compiled schema/compiler imports. Build and browser checks must import the shipped browser artifact, not only source or a test double. Pure state/conversion tests belong in Vitest; controller/DOM interaction, keyboard, error association, responsive, forced-colors, zoom, and browser-package checks belong in Playwright. No DOM emulation dependency is introduced solely for the editor package.

### Rejected Alternatives

- A framework UI was rejected because it violates the shared framework-free boundary and adds CLI/extension packaging cost.
- Direct browser imports of current schema/compiler runtime artifacts were rejected because their Node ESM/Ajv initialization is not an approved MV3-safe boundary.
- Browser storage or browser-core callbacks inside the editor package were rejected because persistence, lifecycle, permissions, and conflicts belong to later hosts.
- Full string-template rendering was rejected because it increases XSS and focus-loss risk; the view uses safe DOM construction.
- Drag-and-drop and visible-index reorder were rejected because they exclude keyboard users and become unsafe under filtering.
- An arbitrary `action: unknown` passthrough was rejected because it bypasses strict schema validation and can lose or persist unsupported data.

## Runtime Foundation

The runtime-foundation package adds a private Node ESM `@rogatio/runtime` package depending on `@rogatio/schema` and `@rogatio/compiler`, with no HTTP framework, proxy framework, native-messaging, TLS, browser, or additional product dependency. The package is implemented and verified through Stage 10.

### Ownership and data flow

The schema package remains authoritative for HTTP method names and common validation policy. The compiler provides the detached matcher operations that identify the source group and rule. Runtime-specific grants are a separate runtime-foundation authorization record: each grant names one source rule, one opaque operation ID, one primitive kind, one canonical target, and one exact method. Outbound grants are restricted to public HTTP(S) GET or HEAD targets whose origin belongs to the corresponding compiler matcher; file grants carry an exact logical path. The runtime foundation does not execute the compiler's regular expression, select a matching rule, resolve priority, or interpret a future action payload. The trusted controller supplies the already-selected grant; the runtime verifies that the grant is bound to the corresponding compiler matcher operation and to the immutable preset digest.

The package has four owned layers:

- **Policy core:** validates hostile input, creates detached immutable runtime presets, canonicalizes targets, computes a versioned SHA-256 digest, issues the bootstrap capability, and performs deny-by-default exact authorization.
- **Protocol adapter:** exposes only versioned pairing and authorization routes through Node `node:http`, accepts HTTP/1.1 on `127.0.0.1` only, bounds streams, and serializes stable redacted errors.
- **Outbound connector:** accepts only an authorized `outbound-http` grant, resolves A and AAAA records, rejects any unsafe result, connects once to a selected numeric address without proxy or re-resolution, strips credentials, and rejects redirects.
- **Confined reader:** accepts only an authorized `confined-file` grant under the configured root, reads from a verified descriptor with no-follow guarantees, and denies the operation when the host platform cannot prove confinement.

The protocol adapter returns an authorization decision, not a mock response. The outbound connector and confined reader are explicit primitives for later consumers. The mock-rules package owns mock status, headers, bodies, delays, file-snapshot semantics, and browser integration. The macOS native-messaging runtime owns native messaging, TLS/PAC, request-body handling, and its separate process. Neither later feature is implemented or specified as a runtime-foundation action here.

### Preset, digest, and capability boundary

The runtime preset is an internal, independently versioned data contract. Its canonical form contains compiler matcher data, runtime grants, and fixed resource limits; it excludes the random capability, session values, timestamps, and the local filesystem root. Objects use a fixed key order, grants use a deterministic tuple order, values are limited to strings, booleans, integers, arrays, and null, and canonical bytes are whitespace-free UTF-8 JSON. The format is a versioned closed runtime profile rather than an assumption that ordinary `JSON.stringify` is canonical. The digest is `sha256:<64 lowercase hexadecimal characters>` over those bytes.

Starting a server creates a fresh 32-byte random bootstrap capability and an ephemeral port. The controller receives the bootstrap material in-process; the server never places it in a URL, log, or error. `POST /v1/pair` requires the capability and preset digest in dedicated headers, consumes the bootstrap capability once, and returns a short-lived random session capability. Every authorization request requires the session capability and the same digest. Capabilities are compared with fixed-length timing-safe comparison, are memory-only, and expire with the server session. Stopping the server invalidates all capabilities and aborts active work. There is no hot policy reload; changing a preset requires a new server, so no partial policy can be observed.

### Exact authorization and failure behavior

Authorization is an AND of transport admission, active session, capability, preset digest, grant identity, primitive kind, canonical target, and exact method. A failure in one condition cannot be broadened by another grant, priority, wildcard, fallback, or source order. Authorization completes before DNS, socket, filesystem, or response-body work. Unknown routes, malformed control data, missing credentials, mismatches, unsafe addresses, redirect responses, file confinement failures, timeouts, and size violations map to a closed set of stable runtime error codes. Responses never contain raw URLs, credentials, headers, bodies, local paths, DNS answers, addresses, stack traces, or third-party error text.

### Network and file security

Outbound targets use one strict WHATWG URL policy: HTTP(S) only, no userinfo, fragment, controls, backslashes, ambiguous invalid encoding, raw non-ASCII authority text, trailing-dot hostname, or unsupported port. The runtime v1 allows only ports 80 and 443 and outbound GET or HEAD. All resolver results are classified, including IPv4-mapped IPv6. Any loopback, unspecified, private, link-local, multicast, carrier-grade, documentation, benchmarking, reserved, or otherwise non-public result denies the complete operation. The connector selects one allowed numeric address, disables address racing and proxy configuration, preserves the authorized hostname for HTTP Host and HTTPS SNI, and never retries or follows a redirect.

File grants contain a relative logical path, never an arbitrary server path. Absolute, traversal, encoded traversal, alternate-separator, drive, UNC, NUL, control, symlink, non-regular, and over-limit paths are denied. `realpath` is used only as part of validation; it is not treated as a race-free primitive. The reader anchors the configured root, uses no-follow descriptor operations, checks the opened object, and reads only from that descriptor. A platform without the required guarantees reports an unsupported operation instead of falling back to a path-only check.

### Alternatives rejected

- A general forward proxy or catch-all file route is rejected because it would turn loopback reachability into unrestricted SSRF or filesystem authority.
- A single mutable policy or watcher is rejected; stop-and-recreate gives atomic policy identity and a simple rollback story.
- Redirect following is rejected in the runtime foundation; a second authorization and DNS decision would expand the trust boundary without being needed by the foundation.
- Per-operation browser-visible capabilities are deferred; one-use bootstrap pairing plus a short-lived session supports repeated read-only operations without adding a capability-minting round trip. Side-effecting operations require a later specification.
- `realpath`-only confinement and the default fetch/proxy client are rejected because neither proves descriptor or address pinning.
- A full RFC 8785 dependency is not required for the closed internal preset; the runtime foundation instead defines and versions a narrow canonical JSON profile and does not add a dependency solely for serialization.

The complete proposed contract and acceptance criteria are in `docs/specs/f6-runtime-foundation.md`; the staged workflow record is in `docs/f6-workflow.md`.

## macOS Native-Messaging Runtime

The macOS native-messaging runtime is the single native host that response-body and request-body rules reach through Chrome native messaging. Under the approved F23 direction, mock, response-body, request-body, internal proxy/TLS, and upstream forwarding share this one process and one Start/Stop lifecycle; there is no separate user-facing proxy/connect server.

### Ownership and data flow

`@rogatio/runtime` gains the macOS native-messaging control, lifecycle, revalidation, envelope, and interception-gate modules. `@rogatio/cli` gains a real `rogatio runtime` command (`start` / `stop` / `status` / `--help`). The schema package remains authoritative for the project shape and origins; the compiler remains authoritative for matcher operations used in revalidation. The macOS runtime does not add response-body, request-body-trust, or request-body rule behavior, only the runtime those slices depend on.

Four owned layers:

- **Lifecycle controller:** explicit `start` / `stop` / `status` with guarded states `stopped → starting → started → stopping → stopped`, idempotent `stop()`, and a capability-based activation gate that reports `unsupported` only when a trusted device-local CA cannot be provisioned or Chrome PAC routing would collide with an existing controlling proxy/PAC/extension/enterprise policy.
- **Revalidation core:** `revalidateAuthority(context)` independently re-derives authority from the validated schema project and compiled compiler operation for an incoming request. It does not trust the browser's grant; the AND of rule existence, urlRegex match, effective-origin membership, method match, resource-type match, initiator scope, and target-origin membership must all hold.
- **Control envelope:** a versioned `f14-v1` JSON channel (`start`, `stop`, `status`, `authorize`, `transform-request-meta`, `transform-response-meta`) carrying metadata only. Bodies never cross the envelope; a structural test proves it.
- **Interception gate (capability-based):** scoped Chrome PAC generation as a deterministic pure function, plus an ephemeral TLS proxy / device-local CA module reachable only after a successful capability-based activation. When the required capabilities are absent, it returns `runtime.unsupported` and performs no socket or certificate work, regardless of OS.

### Authority boundary

The browser grant is not a security boundary. Every transformation request is re-checked against the canonical `.rogatio.json`: the rule must exist, its URL regular expression must match the request URL, the request origin and target origin must be within the rule's effective origins, the method must match when the rule specifies one, the resource type must be allowed, and the initiator origin must be within granted scope. A denied request triggers no interception and no body oracle. Revalidation completes before any body work, is deterministic, and never trusts a supplied grant boolean.

### Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging envelope carries bounded metadata and transform instructions, never body bytes, credentials, sensitive header values, or file contents. A diagnostic sink, if present, receives only redacted lifecycle/counter events.

### Alternatives rejected

- Trusting the browser grant as authority is rejected; revalidation re-derives from the canonical project.
- A general forward proxy is rejected; only explicitly granted origins are routed through the scoped PAC.
- Persisting interception, capability, or traffic state is rejected; the macOS runtime keeps no history.
- Live TLS interception and CA trust installation require a platform where a trusted device-local CA can be provisioned and Chrome PAC routing does not collide with an existing controlling proxy/PAC/enterprise policy. macOS is the reference supported platform; Linux/Windows may also activate when those capabilities are present. The macOS runtime ships the capability-gated module and deterministic PAC generation; the live interception is completed by the response-body and request-body rules where the capabilities exist.

The complete proposed contract and acceptance criteria are in `docs/specs/f14-macos-runtime.md`; the staged workflow record is in `docs/f14-workflow.md`.

## Request-Body Trust Lifecycle

The **request-body trust lifecycle** that request-body interception (the request-body rules) requires before any network interception can happen: it manages the native-messaging host registration and the device-local CA trust that the macOS runtime's interception gate depends on. It is a distinct concern from the macOS runtime's `start`/`stop`/`status` (which govern a running runtime *process*); the request-body trust lifecycle governs the *installed/trusted* standing of the host on the device. It depends only on the macOS runtime (REP-001) and adds no response-body or request-body rule behavior, only the trust surface those slices pre-condition.

### Ownership and data flow

`@rogatio/runtime` gains a `trust` module with a `createRequestBodyTrustController` controller and pure helper functions. `@rogatio/cli` extends `rogatio runtime` with `install | status | trust | untrust | uninstall`. Five owned operations:

- **install:** write the native-messaging host manifest (`com.rogatio.runtime.json`) into the platform's Chrome native-messaging manifest directory, pointing at the installed runtime host. Capability-based: the manifest directory must be resolvable and writable and the host path must exist; otherwise report `trust.unsupported`.
- **status:** report `{ installed, trusted, platform, capabilityReasons }` without side effects; reads the manifest (present + well-formed) and the CA trust standing.
- **trust:** provision a device-local CA into the OS trust store (capability-based; macOS keychain reference platform) and record it as trusted. Idempotent.
- **untrust:** remove the device-local CA trust from the OS trust store. No-op when not trusted. Idempotent.
- **uninstall:** remove the native-messaging host manifest. No-op when not installed. Idempotent.

Three owned layers:

- **Manifest generation (pure):** `generateNativeMessagingManifest(hostPath, name)` returns a fixed-shape JSON `{ name, description, path, type: "stdio", allowed_origins: [...] }`, deterministic for the same inputs. The manifest carries no secrets; `path` must be absolute and confined to an expected install root before emission.
- **Capability gate:** `detectTrustCapabilities()` reports whether host-manifest install and CA trust install are possible on the current platform/config. Capability-based, not OS-name-based, mirroring the macOS runtime REQ-008: a non-macOS platform with the required tooling may still install/trust; a macOS platform missing the tooling reports `trust.unsupported`.
- **Trust controller:** `install`/`uninstall`/`trust`/`untrust`/`status` with explicit idempotency and a single stable error set. No telemetry, no retained state beyond the manifest file and the OS trust store; nothing is persisted to the project, the runtime, or disk outside the manifest path.

### Authority and confidentiality boundary

The request-body trust lifecycle touches only device-local trust material: the manifest (which names the host) and a device-local CA. It never reads, writes, logs, or transmits request/response bodies; it does not contact upstream and does not implement the request-body-rules transformation. The CA is device-local and self-signed; its private key stays confined to the install root and is never placed on the native-messaging envelope. `status` echoes only booleans and the platform/capability reasons — never the manifest path, the host path, CA material, or third-party tooling text.

### Alternatives rejected

- Bundling host manifest + CA trust into the macOS runtime `start`: rejected because install/trust are device-level, persistent, and intentionally separate from the per-session runtime lifecycle; conflating them would force re-trust on every start.
- Persisting trust state in the project file: rejected; trust is device-local, not project state, and must not travel with `.rogatio.json`.
- Auto-install/auto-trust on `runtime start`: rejected; explicit, capability-gated user actions only, per the macOS runtime's no-auto-start stance.

The complete proposed contract and acceptance criteria are in `docs/specs/f16-request-body-trust.md`; the staged workflow record is in `docs/f16-workflow.md`.

## F23 Unified Native-Host Runtime Direction

F23 consolidates runtime-dependent behavior behind one extension-launched native host. The host owns the internal loopback proxy and TLS interception, while native messaging carries lifecycle, policy, and metadata/control only; observed traffic bodies remain in the host-owned interception path. Start is transactional: it validates the immutable active policy, opens the host/provider, and installs exact scoped PAC routing only after collision, trust, and capability checks. Failure rolls back all Rogatio-owned state. Stop removes only owned PAC/proxy state, aborts active operations, invalidates capabilities, clears transient body buffers, and restores the prior browser proxy configuration.

The extension exposes only Start runtime and Stop runtime during normal use. A separate Check and connect action and separate mock-connection state are not part of the target model. Mock, response-body, and request-body rules share one runtime session. Non-matching or unsupported requests pass through untouched, and only the highest-priority matching request-body rule applies. The CLI remains available for one-time native-host installation, CA trust, and administrative diagnostics, but it is not required to connect or operate a browser session.

The internal proxy remains narrowly scoped: exact authorized origins, bounded HTTP/1.1 request handling, strict TLS/target/address validation, no redirects or proxy recursion, and no traffic persistence. Unsupported signed, compressed, multipart, binary, or otherwise unsafe transformations do not produce a partial request; they pass through untouched where protocol-safe. See `docs/specs/f23-unified-native-host-runtime.md` and `docs/plans/f23-unified-native-host-runtime.md` for the approved requirements and implementation sequence.

## CLI Package Architecture

### Components

**1. CLI Entry Point (`src/index.ts`)**
- Command router using minimal argument parsing (no external deps)
- Subcommands: `edit`, `verify`, `runtime` (stub)
- Global options: `--help`, `--version`

**2. Edit Command (`src/commands/edit.ts`)**
- HTTP server (Node `http` module) bound to `127.0.0.1:0` (random port, or a fixed port via `--port`)
- Static file serving for the editor page (`GET /editor.html`) and the `@rogatio/editor` browser bundle (`GET /vendor/editor.js`)
- API endpoints:
  - `GET /api/project` → returns current project JSON
  - `POST /api/validate` → runs schema + compiler validation
  - `POST /api/save` → writes project to file
  - `POST /api/cancel` → shuts down server
- Cross-platform browser launch (macOS `open`, Linux `xdg-open`, Windows `start`)
- CSRF protection via random token in HTML and validated on mutating endpoints
- Cleanup on SIGINT/SIGTERM, save, cancel, or browser close detection

**3. Verify Command (`src/commands/verify.ts`)**
- Reads `.rogatio.json` from path (default: cwd/.rogatio.json) or stdin (`-`)
- Runs `validateProjectDetailed` from `@rogatio/schema`
- If valid, runs `compileProject` from `@rogatio/compiler`
- Outputs diagnostics:
  - Human-readable (default): grouped by severity, colored if TTY
  - JSON (`--json`): structured array for scripting
- Exit codes: 0=valid, 1=invalid (diagnostics), 2=error (IO/parse)

**4. Editor Hosting (`src/server/`, `src/commands/edit.ts`)**
- `editor.html` is generated inline (`generateEditorHtml`) with embedded config (API base URL, CSRF token, file path) plus an import map
- The import map maps `@rogatio/editor` to `/vendor/editor.js`, served by the CLI's own HTTP server
- The `@rogatio/editor` browser bundle is resolved at runtime via `import.meta.resolve("@rogatio/editor")` and streamed from disk on `GET /vendor/editor.js` — no separate CLI browser build target is required
- Editor instantiates via `createEditor(root, options)` with HTTP-based callbacks (`validate`, `save`, `onCancel`)

**5. Utilities (`src/utils/`)**
- `file.ts`: read/write JSON with atomic write (temp + rename)
- `browser.ts`: cross-platform `open` with fallback handling

### Data Flow

```
rogatio edit [path]
       │
       ▼
┌──────────────────┐
│ Resolve file     │
│ Read or create   │
│ empty project    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Start HTTP server│
│ (127.0.0.1:0)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Generate editor  │
│ HTML with config │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Launch browser   │
│ to editor URL    │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
[User edits] [API calls]
    │         │
    ▼         ▼
[Save]    [Validate]
    │         │
    └────┬────┘
         ▼
┌──────────────────┐
│ Write file /     │
│ Return diagnostics│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Shutdown server  │
│ Exit process     │
└──────────────────┘
```

### Security Boundaries
- Server binds only to `127.0.0.1` (never `0.0.0.0`)
- CSRF token required for mutating endpoints (`/api/save`, `/api/cancel`)
- No authentication (local-only, short-lived)
- File access confined to target `.rogatio.json` path
- No network requests except browser launch

### Error Handling
- Schema validation errors → structured diagnostics
- Compiler diagnostics → included in verify output
- IO errors → exit code 2 with stderr message
- Browser launch failure → fallback instructions printed, server still runs
- Port conflict → retry with new random port (max 3 attempts)

### Testing Seams
- HTTP server: unit test with `fetch` against running server
- Edit command: integration test with temp file, mock browser launch
- Verify command: unit test with various valid/invalid inputs
- File utils: unit test atomic write, error cases
- Browser launch: unit test platform detection logic

## Decisions

| Decision | Rationale |
|----------|-----------|
| HTTP server + browser for `edit` | Shares editor code with extension; no Electron dependency |
| `127.0.0.1` binding | Prevents LAN exposure; matches runtime server pattern |
| CSRF token | Mitigates localhost CSRF from malicious pages |
| Atomic file write | Prevents corruption on crash/kill |
| Random port | Avoids conflicts; no config needed |
| Minimal deps (stdlib only) | Faster install; smaller attack surface; matches repo philosophy |
| Exit codes for verify | Scriptable CI/CD integration |
| JSON output option | Machine-readable for tooling |

## Rejected Alternatives

| Alternative | Reason |
|-------------|--------|
| Electron/Tauri | Heavy binary; contradicts "npm package" distribution |
| Terminal UI (ink) | Editor is DOM-based; would require rewrite |
| WebSocket for editor comms | HTTP sufficient; simpler; no WS dependency |
| Fixed port | Conflicts common; random + open browser is UX standard |
| Long-lived server | Edit is single-session; no need for daemon |

## Offline Dry-Run / Test Feature

### Overview

The offline dry-run package adds a pure-offline, bounded URL-batch dry-run capability that evaluates matcher operations (from the compiler) against a list of test cases without contacting the network, requesting permissions, changing installed rules, connecting to runtime, or saving test data. It is usable from both the CLI (`rogatio test`) and the Editor (`Test rules` route/panel).

### Components

**1. Dry-Run Package (`@rogatio/dry-run`)**

- **`src/types.ts`** — Type definitions: `DryRunTestCase`, `DryRunResult`, `MatchDimension` (state + detail), `RuleMatchResult`, `UrlDryRunResult`, `DryRunError`, `DryRunSummary`, `DryRunOptions` (maxCases, previewAction), `PreviewActionFn`.
- **`src/url.ts`** — `parseTestUrl(input: unknown)`: WHATWG URL parsing, rejects non-string, empty, non-absolute, non-http(s); no network.
- **`src/dryrun.ts`** — `dryRunProject(operations, cases, options?)`: core engine:
  - Defensive case validation: rejects proxies, accessors, symbols, cycles without invoking getters; returns `dryrun.invalid-case`.
  - `maxCases` default 256; exceeding returns `dryrun.batch-limit`.
  - Regex cache per operation (`compileUrlRegex` from `@rogatio/schema`).
  - Four matching dimensions per rule:
    - `urlRegex`: `regex.test(fullUrl)` → matched/unmatched.
    - `effectiveOrigin`: `parsed.origin in matcher.origins` → matched/unmatched.
    - `method`: not-applicable if test case omits; matched if rule.method undefined or equal; else unmatched.
    - `resourceType`: not-applicable if test case omits; matched if rule.resourceTypes empty or includes; else unmatched.
  - Overall `matched = regex && origin && method!=='unmatched' && rt!=='unmatched'`.
  - `actionPreview` via `options.previewAction` (try/catch, null when absent).
  - Summary: `caseCount`, `urlCount`, `matchedUrlCount`, `matchedRuleTotal`.
  - Never fetches, writes FS, or contacts runtime.

**2. CLI Command (`rogatio test`)**

- Arguments: `[path]` (default `.rogatio.json`, `-` for stdin).
- Options: `--urls` (comma-separated), `--urls-file` (JSON array path or `-`), `--method`, `--resource-type`, `--max-cases`, `--json`.
- Reads project, runs schema + compiler validation, then dry-run.
- Exit codes: 0=success, 1=validation/compile/test errors, 2=usage error.
- Output: human-readable (per-URL per-rule with badges) or JSON.

**3. Server Endpoint (`POST /api/dry-run`)**

- CSRF protected (`x-csrf-token`).
- Body: `{ project, cases, options? }`.
- Server-side compile (validates project first).
- Returns `DryRunResult` (200) or diagnostics (400) or CSRF error (403).

**4. Editor Integration**

- **`types.ts`**: Local DryRun type definitions (no `@rogatio/dry-run` import in browser bundle), `EditorDryRunHandler`, added to `EditorOptions`.
- **`editor.ts`**: New `route.kind === "test"` with:
  - Rail navigation button "Test rules" (accessible, announced).
  - Panel: URLs textarea (one per line), method/resource-type defaults, maxCases input, Run button.
  - Results rendering: per-URL cards with matched/unmatched badges, 4-dimension badges (color-coded: green=matched, red=unmatched, gray=not-applicable), detail text, actionPreview when present.
  - Keyboard complete, SR announcements, forced-colors/200% zoom compatible (uses CSS variables, native elements, live regions).

### Data Flow

```
CLI / Editor
     │
     ▼
┌──────────────────────┐
│ Read .rogatio.json   │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ validateProjectDetailed (schema) │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ compileProject (compiler)  │ → MatcherOperation[]
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ dryRunProject (dry-run)  │
│ - parse/validate cases
│ - cache regex
│ - 4-dim match per rule
│ - summary
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ Render results       │
│ (CLI JSON/human,    │
│  Editor badges)     │
└──────────────────────┘
```

### Security and Privacy

- **No network** — WHATWG URL parsing only; regex test is local.
- **No persistence** — test cases never written to disk.
- **No permission/request/runtime** — purely in-memory evaluation.
- **Defensive validation** — rejects hostile objects (proxies, accessors, symbols, cycles) via `Object.getOwnPropertyDescriptor` checks.
- **CSRF protection** — server endpoint validates `x-csrf-token`.
- **Batch limit** — `maxCases` (default 256) prevents resource exhaustion.

### Testing Seams

- Unit tests for `parseTestUrl`, `dryRunProject` (258 tests total).
- CLI integration tests (exit codes, JSON output, stdin/file inputs).
- Server endpoint tests (200/403/400).
- Editor panel accessibility tests (keyboard, SR, forced-colors, 200% zoom via Playwright).

### Dependencies

```
@rogatio/schema ──► @rogatio/compiler ──► @rogatio/dry-run
                                          │              │
                                          ▼              ▼
                                    @rogatio/editor @rogatio/cli
```

### Acceptance Criteria Coverage

| AC | Description | Test |
|----|-------------|------|
| AC-001 | Simple match | `dryrun.test.ts` |
| AC-002 | Four dimensions with states | `dryrun.test.ts` |
| AC-003 | Invalid case → dryrun.invalid-case | `dryrun.test.ts` |
| AC-004 | Invalid URL → dryrun.invalid-url | `dryrun.test.ts` |
| AC-005 | Default maxCases 256 | `dryrun.test.ts` |
| AC-006 | Configurable maxCases | `dryrun.test.ts` |
| AC-007 | Summary counts | `dryrun.test.ts` |
| AC-008 | previewAction seam | `dryrun.test.ts` |

### Open Questions Resolved

- **Option A approved** — matcher-level dry-run now + `previewAction` seam; redirect/query previews deferred to the redirect and query rules.
- **maxCases default 256** — accepted per user gate.
- **Editor dry-run via host adapter** — no Node import in browser bundle, consistent with the editor package.

## Redirect Rules (action slice)

Redirect rules are the first *action* slice introducing a browser-side effect. It adds the rule-type
discriminant `type: "redirect"`, the redirect payload, and translates it to Chrome DNR
`redirect` rules.

### Rule-type discriminant

- `schema/src/types.ts`: `RuleType = "redirect"`, `RedirectAction { destination: string }`,
  `RogatioRule.type?: RuleType`, `RogatioRule.redirect?: RedirectAction`. Optional `type`
  preserves backward compatibility; rules without `type` remain actionless matchers
  (reported `unsupported`).
- `schema/src/schema.ts`: `rule` $def gains `type` (enum `["redirect"]`) and `redirect`
  object with required `destination`. AJV `if/then` requires `redirect` when
  `type === "redirect"`. `additionalProperties: false` preserved; no unvalidated action
  passthrough.
- `schema/src/limits.ts`: `maxRedirectDestinationLength: 2048`, `maxCaptureGroups: 9`.
- `schema/src/validation.ts`: semantic validation `validateRedirectDestination(destination,
  urlRegex)` checks absolute HTTP(S) URL, no credentials, valid host, no `*`, backreferences
  `\1`–`\9` within capture-group count of `urlRegex`. New `countCapturingGroups(urlRegex)`
  helper counts non-capturing/lookahead-exclusive groups. Diagnostics at
  `/groups/N/rules/M/redirect/destination` with codes `schema.invalid-format`,
  `schema.invalid-value`.

### Compiler

- `compiler/src/types.ts`: add `RedirectOperation { kind:"redirect"; groupId; ruleId;
  matcher: NormalizedMatcher; redirect: { destination: string } }`; widen
  `CompileResult.operations` to `readonly (MatcherOperation | RedirectOperation)[]`.
- `compiler/src/compile.ts`: `compileOperations` emits `RedirectOperation` when
  `rule.type === "redirect"`, else `MatcherOperation`. Matcher normalization unchanged.

### Extension (Chrome MV3)

- `extension/src/dnr.ts` (NEW): `translateRedirectToDnr(op, id)` builds deterministic DNR
  rule `{ id, priority, action:{type:"redirect", redirect:{url}}, condition:
  {regexFilter, resourceTypes, initiatorDomains:hostnamesFromOrigins(op.matcher.origins)} }`.
  `createDnrInstaller(api)` implements `RuleInstallerAdapter` tracking installed redirect
  operations in a Map keyed by DNR rule id; `current()` reads back via
  `chrome.declarativeNetRequest.getDynamicRules()`; `install(ops)` computes add/remove and
  calls `updateDynamicRules`. Guarded for missing `declarativeNetRequest`.
- `extension/src/chrome.ts`: `ChromeApi.declarativeNetRequest` made optional (`?`) to
  preserve test fixture compatibility.
- `extension/src/background.ts`: wires real `createDnrInstaller(api)` replacing stub.
- `extension/src/service-worker.ts`: `operationStatuses` maps installed redirect ops to
  `active`; actionless matchers are always `unsupported` regardless of install state.
  `projectState` fetches `installedRuleIds` from `installer.current()` for accurate status.
- `extension/src/browser-schema.ts`: mirrors redirect validation with local
  `validateRedirectDestination` + `countCapturingGroups` to avoid circular alias; exports
  `validateRedirectDestination` so the browser build's `@rogatio/schema` alias supplies it
  to the bundled editor redirect extension.

### browser-core

- `browser-core/src/types.ts`: `RuleInstallerAdapter.current()` returns
  `Promise<readonly RogatioOperation[]>`; `RuleStatusInput.operations`,
  `computeRuleStatuses`, `InstallService.install` widened to `RogatioOperation[]`.
- Status logic operates on `operation.matcher`, unchanged for redirect ops.

### Editor

- `editor/src/types.ts`: `RuleTypeFieldExtension` / `RuleTypeFieldContext` unchanged.
- `editor/src/editor.ts`: `COMMON_RULE_FIELDS` gains `"type"`; renders a rule-type
  `<select>` when `ruleTypes` are registered (options: empty = "Actionless (matcher
  only)", plus each extension's `id`/`label`). `updateCommonField` handles `type`:
  clearing to empty deletes `type` and invokes `clearActionFields()`; switching to a
  non-redirect type clears `redirect`; switching to `redirect` preserves other fields.
- `editor/src/rule-types/redirect.ts` (NEW): `createRedirectRuleType()` — `matches`
  `rule.type === "redirect"`; `mount` renders labeled URL input bound to
  `redirect.destination` via `getField/setField/registerControl`; `validate` reuses
  `validateRedirectDestination` from `@rogatio/schema` for consistent validation.

### Testing seams

- `schema/test/redirect.test.ts`: redirect semantic validation (URL, backrefs, limits),
  `countCapturingGroups`, `validateRedirectDestination`.
- `compiler/test/redirect.test.ts`: redirect rule → `RedirectOperation`; untyped →
  `MatcherOperation`.
- `extension/test/dnr.test.ts`: `translateRedirectToDnr` mapping; `createDnrInstaller`
  install via `updateDynamicRules`; missing DNR API → `{ok:false}` / `[]`.
- `extension/test/redirect-status.test.ts`: installed redirect → `active`; matcher →
  `unsupported`.
- `extension/test/browser-schema-redirect.test.ts`: hand-rolled browser schema redirect
  cases mirroring node validation.
- `editor/test/redirect.test.ts`: `createRedirectRuleType` matches/validate.

## Query Parameter Rules (first rule-action slice)

Query-parameter rules add the shared rule `action` discriminator to the version-1 schema and implement the first browser-only action: **query parameter rules**. It spans `@rogatio/schema`, `@rogatio/compiler`, `@rogatio/extension`, and `@rogatio/editor`. The extension's actionless `unsupported` rule model is replaced by action-bearing installable rules for the `query` type; later browser-only slices (redirect, header, and mock rules) extend the same `action` union.

### Schema (schema-package boundary change)

`RogatioRule` gains an `action` object with a `type` discriminant. Query-parameter rules define `QueryAction = { type: "query"; params: { name: string; value: string }[] }`. The schema `rule` `$defs` adds `action` (additionalProperties still false) and a `queryAction`/`action` subschema. New bounds: `maxQueryParamsPerRule`, `maxQueryNameLength`, `maxQueryValueLength`. Semantic validation adds a duplicate-param-name check and the non-empty/length bounds. `browser-schema.ts` mirrors the same `action` validation and bounds because the MV3 bundle cannot load Ajv. `action` is optional to preserve backward compatibility with the extension's actionless projects.

### Compiler (compiler boundary change)

Compiler emits distinct operation types: `MatcherOperation` (actionless), `RedirectOperation` (redirect rules), and `QueryOperation` (query rules). `compileProject` emits the appropriate operation type based on `rule.type`. A pure helper `queryParamsToDNR(action)` produces the DNR `addOrReplaceParams` array (`replaceOnly: false`) for unit testing without a browser. This is the durable foundation header and mock rules extend by adding new operation types.

### Extension (extension boundary change)

`projection.ts` `projectMatchers` dispatches on operation kind. For `QueryOperation` it builds a DNR rule with `redirect.transform.query`; for `RedirectOperation` it builds a DNR `redirect` rule; for `MatcherOperation` it returns `installable: false`. `service-worker.ts` `operationStatuses` reports redirect and query rules as `active` when compiled, enabled, and granted; actionless matchers remain `unsupported`. Permission domains derive from origin hostnames (requestDomains/initiatorDomains). The `[Rogatio]` DevTools record stays deferred.

### Editor (editor boundary change)

The `RuleTypeFieldExtension` registry gains a `query` extension whose `matches(rule)` returns `rule.action?.type === "query"`. The editor adds a `Rule type` selector listing registered extension labels; selecting `query` initializes `action = { type: "query", params: [] }` and mounts the extension's param name/value form (add/remove rows). The extension `validate` enforces field-level diagnostics. Unknown action data with no owning extension is not persisted (preserves the editor's rejection of arbitrary `action` passthrough).

### Migration / compatibility

The version-1 schema keeps `action` optional to preserve backward compatibility with the extension's actionless projects. Rules without `type`/`action` remain valid actionless matchers (reported `unsupported`). Query-parameter rules are browser-only and supported on Linux/Windows/macOS; activation is in-browser, no native runtime.

### Rejected alternatives

- Keep `action` optional to preserve the extension's actionless projects: accepted for backward compatibility; actionless rules remain valid but `unsupported`.
- Add-or-replace via separate `addParams`/`removeParams`/`replaceParams` DNR fields: rejected; `addOrReplaceParams` with `replaceOnly: false` is exactly the required add-or-replace semantics in one field.
- Implement query rewriting in the extension service worker rather than DNR `transform.query`: rejected; DNR is browser-native, declarative, and offline, matching the extension's design.

## Mock Rules

The mock-rules package adds the `mock` rule type as a vertical slice: a configured HTTP status, optional
response headers, an optional delay, and either an inline body or a live UTF-8 snapshot
of one approved local file, served to matched browser requests without ever contacting
upstream. It integrates the rule slice with the runtime server, the editor, the CLI,
and the extension, including the single user-clicked Check-and-connect request.

### Rule payload and compiler

- `schema/src/types.ts`: `RuleType` gains `"mock"`; new `MockHeader { name; value }` and
  `MockAction { status: number; headers?: MockHeader[]; delayMs?: number; body?: string;
  file?: string }`; `RogatioRule.mock?: MockAction` required iff `type === "mock"`.
  Exactly one of `body`/`file` is set. The `mock` sub-object follows the redirect-rules
  `redirect` pattern (a type-specific payload field), not the query-rules `action` field.
- `schema/src/limits.ts`: `maxMockStatus 599`/`minMockStatus 200`, `maxMockHeadersPerRule
  32`, `maxMockHeaderNameLength 256`, `maxMockHeaderValueLength 4096`,
  `maxMockInlineBodyLength 65536`, `maxMockDelayMs 30000`, `maxMockFilePathLength 2048`.
- `schema/src/schema.ts`: rule `$def` gains `mock` and an `if/then` requiring it when
  `type === "mock"`; header/body/file sub-schemas with bounds; `additionalProperties:
  false` preserved.
- `schema/src/validation.ts`: semantic checks — status integer in `[200, 599]`; exactly
  one of `body`/`file`; header name non-empty/bounded and value bounded; `delayMs`
  integer `0..maxMockDelayMs`; body length bound; file path non-empty, length bound, and
  no NUL/control characters. Diagnostics use stable codes at stable JSON-pointer paths.
- `compiler/src/types.ts`: `MockOperation { kind: "mock"; groupId; ruleId; matcher;
  mock: MockAction }`; `RogatioOperation` union widened.
- `compiler/src/compile.ts`: emits `MockOperation` when `rule.type === "mock"`.

### Runtime mock serving (runtime-foundation boundary change, same `@rogatio/runtime` package)

The runtime foundation remains the mock/response server process; the mock-rules package extends it with mock response
semantics. The runtime foundation's control protocol (`POST /v1/pair`, `POST /v1/authorize`) is unchanged
and still returns authorization decisions only.

- **Preset extension:** the internal runtime preset gains an optional `mocks` array
  (`{ ruleId, status, headers, delayMs, body?, file? }` where `file` is a relative
  logical path). Presets without `mocks` behave exactly as before. Canonical bytes and
  the SHA-256 digest cover the mock *config*; per-rule mock *tokens* are capability-like
  and excluded (digest stays stable per project). Deterministic ordering and the closed
  canonical profile are preserved.
- **Per-rule mock tokens:** server startup mints a fresh 32-byte cryptographically
  random token per mock rule, stored only in memory and bound to the ruleId and server
  instance. Tokens are designed to appear in browser redirect URLs (unlike the runtime-foundation
  bootstrap/session capabilities, which never do); they are never logged or echoed in
  error responses.
- **Mock route:** `GET /mock/<token>` serves the configured response: optional bounded
  delay (cancelled on client disconnect and server stop), configured status and headers
  (default `Content-Type: text/plain; charset=UTF-8` when the user configures none), and
  a body from the inline string or a live confined-file read of the approved file.
  Permissive CORS headers are emitted **only on this route** (needed for cross-origin
  XHR/fetch from web pages to the loopback mock server); the runtime-foundation control protocol never
  emits CORS. `GET`/`HEAD`/`OPTIONS` are accepted; other methods return a stable `405`.
  The route never uses the outbound connector (mocks never contact upstream).
- **File snapshots:** a file-based mock is served through the existing confined-file
  reader (`readConfinedFile`) under the trusted startup root, re-read on every request
  (live). The bytes must be valid UTF-8 (fatal `TextDecoder`); invalid UTF-8, missing,
  or unreadable files return a stable redacted error status (never the path).
- **Connection endpoint:** `GET /v1/connection` returns `{ protocol: "f13-v1", port,
  presetDigest, mocks: [{ ruleId, token }] }` for the extension's Check-and-connect.
  Loopback-only. The endpoint's authorization is a gate decision (open loopback with a
  documented threat model is the recommendation; see OQ-2).
- **Port:** `createRuntimeServer` gains an optional `port` (default `0` ephemeral). The
  CLI `rogatio runtime` uses the fixed default `127.0.0.1:8890` (overridable with
  `--port`) so the extension has a stable address; a port conflict fails with a clear
  error.

### CLI (`rogatio runtime`)

- `packages/cli/src/commands/runtime.ts` becomes real: reads `.rogatio.json` (path arg,
  default cwd, `-` for stdin), validates + compiles via the schema and compiler packages, builds the runtime preset
  with the project's mock rules (resolving file rules against the configured root,
  default the project directory; paths outside the root are rejected), starts
  `createRuntimeServer` on the fixed default port, prints connection info and
  instructions, and stops cleanly on SIGINT/SIGTERM. `--root` configures the confined-
  file root; `--port` overrides the default. Invalid projects exit `1` with the same
  diagnostics style as `verify`; port/startup failures exit `2`.
- `rogatio test` and the `edit` server gain a mock `previewAction` (via the existing dry-run
  `previewAction` seam) producing e.g. `{ kind: "mock", summary: "Mock 200 (inline
  body, 42 bytes)" }` or `"Mock 200 (file snapshot: <basename>)"`. The dry-run engine
  itself is unchanged.

### Extension (Chrome MV3)

- **Manifest:** add `"declarativeNetRequest"` to `permissions` (required for DNR
  dynamic rules; grants implicit redirect access without host permissions). This also
  unblocks redirect and header DNR installs in real browsers.
- **Projection:** `projectMatchers` handles `MockOperation` (installable, matcher
  preserved). The final DNR redirect URL depends on the runtime connection info, so the
  service worker builds mock DNR rules after Check-and-connect, translating each mock
  op to a `redirect` rule targeting `http://127.0.0.1:<port>/mock/<token>`.
- **Loop protection:** when any mock rule is installed, the extension also installs one
  high-priority `allow` rule matching the mock URL substring
  (`127.0.0.1:<port>/mock/`) so the extension's own redirect rules never apply to the
  mock server (Chrome DNR re-evaluates redirected requests; a broad `regexFilter` would
  otherwise loop).
- **Check-and-connect:** a new `check-mock-runtime` command fetches
  `http://127.0.0.1:<port>/v1/connection` (default port `8890`), verifies every enabled
  mock rule has a token, stores the connection info in memory, transitions the mock
  runtime state through `RuntimeStateController` (`disconnected → checking →
  connected/failed` with `lastCheck`), installs the mock DNR rules, and recomputes
  statuses. The extension page gains a "Check and connect" button and a mock runtime
  status readout; the state response includes the mock runtime state.
- **Statuses:** mock ops report `needs proxy` while the runtime is not connected;
  `active` when connected and installed; a stable `error` diagnostic when connected but
  the runtime has no token for the rule (project changed after start — directs
  restarting `rogatio runtime`). In-memory mock runtime state resets to `disconnected`
  on service-worker restart (per browser-core; the status represents the last check).

### Editor (editor package)

A `mock` `RuleTypeFieldExtension` renders status (number), optional delay (number),
header name/value rows (add/remove), and a body-source selector (inline textarea vs.
file path input — the browser-safe editor cannot pick files, so the path is a validated
string; existence is validated by the CLI at runtime start). Validation enforces the
schema bounds and the exactly-one-body-source invariant with stable field diagnostics.
`createMockRuleType` is added to `builtInRuleTypes` and exported.

### browser-core (browser-core package)

No core status change: `computeRuleStatuses` already operates on `operation.matcher`.
The `needs proxy` / `error` rewrites for mock ops are service-worker logic (like the
matcher `unsupported` rewrite). `RuntimeStateController` already models the mock runtime
state and is wired in the extension service worker.

### Rejected alternatives

- Ephemeral port + connection file for runtime discovery: rejected (MV3 cannot read
  arbitrary local files without native messaging, which is provided by the macOS runtime).
- Extension pairing via the runtime-foundation control protocol for the connect UX: rejected (requires
  conveying the bootstrap capability into the extension; contradicts the one-click
  Check-and-connect).
- A generic mock proxy or arbitrary file route: rejected (would break the runtime-foundation confined-
  file and exact-grant model; mocks serve exactly the one approved file per rule).
- Mock path-based routing (serve different content per request URL): rejected; a mock
  rule returns one configured response regardless of the matched URL, matching the
  product description.

## Request-Body Rules

The request-body rules add bounded request-body replacement and modification for explicitly authorized
browser XHR requests. This section records the Stage 2 architecture. The specification
and this decision remain pending the Stage 4 human approval gate; no implementation
plan or code may rely on them until that gate passes.

### Boundary and ownership

The request-body rules extend the existing package boundaries without turning the runtime foundation into a forward proxy:

| Package | Request-body-rule responsibility | Request-body rules do not own |
| --- | --- | --- |
| `@rogatio/schema` | Version-1 rule and exact-local-origin validation | Network, proxy, credentials |
| `@rogatio/compiler` | Detached ordered `RequestBodyOperation` values | Chrome, TLS, persistence |
| `@rogatio/browser-core` | Generic enablement, permission, and status seams | Native messaging, body bytes |
| `@rogatio/editor` | Request-body fields and project local-origin fields | Runtime or filesystem access |
| `@rogatio/extension` | Chrome metadata, policy session, PAC, markers, lifecycle | Request bodies, TLS, upstream forwarding |
| `@rogatio/runtime` | Policy validation, authority, proxy, TLS, transform, forwarding | Browser storage and editor state |
| The request-body-trust layer | Native-host manifest and X.509 CA trust lifecycle | Request transformation |
| `@rogatio/cli` | Offline validation/edit/test and explicit trust/install diagnostics | Ownership of live browser sessions |

The runtime-foundation GET/HEAD authorization, the mock rules, and the response-body rules remain separate.
The response-body rules may use the shared live provider seam, but the request-body rules must not widen the runtime-foundation transport to carry
POST bodies or credentials.

### Rule and operation model

The schema uses the same action-property convention as `response-body`: a
`request-body` rule has a required `requestBody` property. The action is a strict
discriminated union:

```ts
type RequestBodyAction =
  | { readonly mode: "replace"; readonly body: string }
  | {
      readonly mode: "regex";
      readonly pattern: string;
      readonly replacement: string;
    };
```

Rules require `POST`, `PUT`, or `PATCH` and exactly one resource type,
`xmlhttprequest`. The compiler emits a detached `RequestBodyOperation` with group and
rule IDs, normalized matcher, action, and zero-based source order. Source order is
group-array order followed by rule-array order. Compiler output stays in source order;
priority is used only by the shared winner selector.

All request-phase operations participate in one deterministic arbitration decision:
redirect, query, request headers, mock, and request-body. The highest numeric priority
wins; equal priorities use the lowest source-order index. No request-phase actions
compose. Response-only operations are selected in the response phase and do not compete
with request-body operations. The extension uses the same pure selector as the native
runtime or an equivalent projection that proves the same result; Chrome DNR incidental
ordering is never the authority.

### Digest-bound policy

The extension builds an immutable in-memory `RequestBodyPolicyV1` from committed project
state, enabled groups, granted origins, exact configured local origins, and the explicit
extension ID. The policy contains the complete request-phase authority snapshot needed by
the native runtime: normalized matchers, all competing request-phase operations, action
data, source order, project identity/revision, grants, limits, and session scope. It
does not contain captured traffic, credentials, response bodies, or unrelated project
secrets such as mock payloads and file contents.

The extension validates project data before sending. The native runtime validates the
policy structure independently, rejects unknown operation kinds and inconsistent derived
fields, verifies exact origins, limits, extension identity, enabled groups, and action
shapes, then computes the same canonical digest. The native runtime trusts only this
complete digest-bound policy, never a per-request rule ID or operation supplied by the
browser. The user-selected design does not add CLI signing; consequently, policy
validation proves policy integrity and session binding, not independence from a
compromised extension.

Canonical policy bytes are compact UTF-8 JSON with fixed key ordering and deterministic
array/set ordering. The digest is `sha256:<64 lowercase hexadecimal characters>` and
excludes session nonce, timestamps, capabilities, and native frame segmentation. Policy
state is memory-only and immutable for one live session. Any project, enablement,
permission, or local-origin change tears down the session and requires a new explicit
start.

Policies larger than one native frame use bounded `policy-begin`, `policy-part`, and
`policy-commit` messages. Each Chrome native-messaging frame has a four-byte
little-endian payload length and a maximum 64 KiB UTF-8 JSON payload. Parts carry only
base64url canonical policy bytes. Incomplete, reordered, duplicated, oversized,
malformed, or digest-mismatched staging never becomes active.

### Browser-to-proxy correlation

The supported browser path uses ordinary MV3 APIs. Chrome does not generally grant
`webRequestBlocking` to ordinary extensions, so the request-body rules do not make exact per-request
initiator scheme/port or request-ID correlation a live prerequisite. The extension instead
installs one ephemeral, session-bound DNR marker per request-body operation. The marker
condition contains the operation URL matcher, method, `xmlhttprequest` resource type,
and the initiator hostname projection available to DNR. This is a host-domain assertion,
not exact initiator-origin proof: scheme, port, and some browser context details cannot
be recovered at the native proxy boundary.

The native runtime validates the marker token, target, method, resource type, policy
digest, and global winner against its immutable policy. A marker is a capability signal
from the active extension session, not a trusted rule ID supplied by a page. Marker
names use a runtime-owned reserved prefix, are rejected when duplicated or malformed,
and are removed before upstream forwarding. A request with a valid body marker that
fails framing, authority, or transformation is blocked before upstream; it never falls
back to its original body.

Markers are static session rules, one per request-body operation. The request-body rules do not use
request-ID keyed dynamic rules or a native pending-authorization map. The ordinary MV3
boundary therefore cannot prove exact initiator scheme, port, or browser context at the
proxy; the marker's initiator condition is limited to DNR's host-domain projection.

The extension may send best-effort metadata-only `request.prepare` messages for status
and diagnostics, but they are not required for authorization and never carry body bytes,
headers, cookies, or authorization values. The listener explicitly copies safe metadata
and never reads or spreads `details.requestBody`.

A PAC-routed request without a body marker is treated as having no browser body
authorization and is forwarded unchanged, as explicitly chosen by the user. Traffic
outside exact PAC origins is `DIRECT`. This is the accepted ordinary-MV3 compromise:
unmatched pass-through and marker-based body transformation remain safe at the wire
boundary, but exact initiator-origin and missing-marker fail-closed guarantees are not
available without a policy-installed blocking extension.

### Live lifecycle and rollback

The extension serializes start, stop, policy replacement, permission changes, PAC
changes, and marker installation through one coordinator. The native runtime owns one
session and one immutable policy:

```text
stopped -> starting -> started -> stopping -> stopped
                    \-> failed
                    \-> unsupported
started ------------> failed
```

Start validates policy, explicit extension identity, the request-body-trust, platform capabilities,
and proxy-control ownership before accepting traffic. It starts a non-accepting
provider, verifies Chrome proxy control, installs exact-origin PAC and markers
atomically, then activates the provider. Any failure stops acceptance, removes owned
markers, restores PAC only when it is still owned by Rogatio, stops the native session,
and clears transient marker/session state. Stop is idempotent and invalidates policy,
capabilities, sockets, timers, active request state, and transform workers before
removing owned routing.

The CLI may report or diagnose a process-local native runtime, but it cannot claim or
control the extension-owned live browser session. `runtime start` without a validated
extension policy never enables request-body interception. No command auto-installs
trust, auto-starts Chrome routing, or silently takes over another proxy/PAC/enterprise
controller.

### Scoped proxy and wire contract

The provider is a narrow HTTP/1.1 proxy bound to `127.0.0.1`. It accepts only HTTP
absolute-form traffic for port 80 and HTTPS `CONNECT` for port 443, with exact target
authority. It rejects arbitrary CONNECT, ambient proxy environment settings, redirects,
HTTP/2, HTTP/3, and ALPN other than `http/1.1`. DNS resolves all A/AAAA answers, rejects
mixed public and non-public results, then pins one validated numeric address without
re-resolution, racing, or retrying another address. The original hostname remains HTTP
authority and HTTPS SNI.

Eligible requests require one valid decimal `Content-Length` at most 4 MiB. The runtime
counts received bytes and requires an exact match. It rejects transfer encoding,
chunking, trailers, `Expect`, `Upgrade`, pipelining, duplicate/conflicting framing,
multipart, compression, binary content, invalid UTF-8, and unsupported client-certificate
authentication. No upstream DNS or socket write occurs until validation and transformation
complete.

Accepted media types are `application/json`, valid `application/*+json`,
`application/x-www-form-urlencoded`, and `text/*`, with no charset or UTF-8 only.
`Content-Encoding` is absent or `identity` only. Replace mode still validates the input
body before discarding it. Regex mode decodes strict UTF-8, constructs one ECMAScript
`gu` regular expression, and uses standard `String.replace` replacement expansion.
Output is UTF-8 and bounded to 4 MiB. Regex execution runs in an independently
terminable boundary with a 250 ms deadline plus the complete operation timeout. Failure
blocks before upstream and emits only a stable redacted error code.

Cookie and Authorization headers are preserved unchanged when the request otherwise
passes. Host/authority and Content-Length are reconstructed. Hop-by-hop, proxy,
transfer, trailer, and conflicting framing headers are removed or rejected. Standard
body-integrity/signature headers (`Content-MD5`, `Digest`, `Content-Digest`, `Signature`,
`Signature-Input`) are rejected. The request-body rules do not recompute unknown application signatures.
Credential values never enter native messages, logs, diagnostics, persisted state, or
error responses.

### Trust and target boundaries

The request-body-trust layer must provide actual X.509 CA certificate plus private key material, atomic confined
storage, actual trust standing, exact native-messaging origin, host confinement, and
rollback. An SPKI public key is not a CA certificate. The request-body rules consume an injectable,
capability-based platform CA adapter; adapters use reviewed fixed executable paths and
argument arrays, never shell interpolation. No unreviewed certificate or proxy
dependency is introduced. macOS is the reference live platform; Linux and Windows are
live-capable only when equivalent adapters report every required capability.

Targets are public by default. Loopback, private, link-local, multicast, carrier-grade,
reserved, documentation, and other non-public addresses require an exact normalized
origin in `requestBodyPolicy.localOrigins`. The exception does not widen scheme,
hostname, port, subdomain, or path and does not bypass framing, TLS, or address
validation. Targets have no credentials, fragments, controls, backslashes, wildcards,
trailing-dot hostnames, or ambiguous ports.

### Extension, editor, and CLI seams

The extension adds native-runtime, body-runtime, body-marker, proxy-settings, and
metadata-only web-request seams. Its manifest explicitly requests only the permissions
needed for native messaging, proxy control, DNR marker installation, and optional
metadata observation. It does not require `webRequestBlocking`; ordinary MV3 is the
supported browser boundary. Request-body operations do not become DNR body actions.
Body rules remain disabled until separately granted and explicitly activated.
Service-worker restart does not restore live state.

The editor adds a request-body rule type, replace/regex controls, fixed method/resource
constraints, and exact local-origin project controls. It keeps detached drafts and host
supplied validation/save ports, remains keyboard/screen-reader/forced-colors safe, and
does not import Node or runtime validation artifacts. Existing response-body editor/browser-schema
payload parity is repaired in the same boundary work so stale action fields cannot leak
between rule types.

CLI verify, edit, test, and dry-run remain offline. Runtime trust/install is explicit,
requires the exact extension ID, and reports capability-gated status without exposing
paths, certificates, bodies, headers, credentials, or platform-tool output.

### Testing seams and rejected alternatives

Pure tests cover strict schema/browser-schema validation, compiler detachment and source
order, global arbitration, editor fields, policy canonicalization/digest, native frame
staging, and bounded transformation. Integration tests use raw HTTP/1.1 and fake Chrome
adapters to prove framing rejection, zero upstream calls on failed transforms, marker
stripping, credential preservation, policy races, PAC collisions, and stop rollback.
The request-body-trust and response-body regressions cover X.509 trust and shared-provider behavior. A capable macOS
runner must prove real Chrome native messaging, PAC, trusted TLS, HTTPS POST/XHR,
credential preservation, winner selection, failure blocking, and stop teardown. Linux
and Windows provide offline/capability-negative evidence unless equivalent adapters are
injected and explicitly tested.

Rejected designs: browser-only DNR body rewriting; service-worker fetch forwarding;
sending observed bodies through native messaging; widening the runtime foundation; generic forward proxying;
trusting browser-selected rule IDs or grants; relying on DNR ordering; composing rules;
auto-start/trust; persisted policy or traffic; SPKI-as-CA; ad-hoc ASN.1; and unreviewed
third-party proxy/TLS dependencies. Same-origin unmatched PAC traffic is the explicit
exception to a blanket block because the user selected unchanged forwarding for that
case; marker-selected request-body operations still fail closed. Exact initiator
correlation through `webRequestBlocking` was considered but rejected for ordinary MV3
availability; policy-installed Chrome is not required for the request-body rules' live status.

## Documentation Site

The documentation-site package adds a separate static documentation site built with **Astro 7** and the
**Starlight** documentation theme. It is a new workspace package, `packages/docs-site`,
and does not share runtime code with the product packages. The site documents the
already-shipped product (`rogatio-overview.md`, `sequence.md`, and the per-feature specs)
for end users and integrators; it is not a runtime or CLI artifact and is excluded from
the npm/extension release pipeline (handled later by the release pipeline).

### Package boundary and build

- New private package `@rogatio/docs-site` under `packages/docs-site`, added to the
  existing `packages/*` pnpm workspace. It introduces `astro` and `@astrojs/starlight`
  as dependencies — the only new third-party dependencies the feature adds, and the ones
  the documentation-site specification explicitly requires.
- Content lives in `src/content/docs/**` as Markdown (`.md`); Starlight's built-in docs
  collection is used, so no custom `src/content.config.ts` is required. This keeps the
  package free of product `.ts` source that would otherwise be pulled into the root
  `tsc --noEmit` and Biome passes.
- Build produces a static site in `dist/` (gitignored). Scripts: `dev`, `build`
  (`astro build`), `preview`, and `check` (`astro check`).
- `astro.config.mjs` declares the Starlight integration, site title, sidebar, and a
  deterministic, content-only build (no analytics, no telemetry, no external fonts/CDNs
  beyond Starlight defaults).

### Isolation from canonical validation

The root `typecheck` (`tsc --noEmit` over `packages/**/*.ts`) and root `lint`/`format`
(Biome over `**`) must stay green. The docs-site therefore:

- Is added to the root `tsconfig.json` `exclude` list so Astro/Starlight type surface and
  config are not checked by the product typecheck.
- Is added to `.biomeignore` so Biome does not format/lint Astro component and Markdown
  content files (these are owned by Astro/Starlight tooling).

The root esbuild `build` script (`scripts/build.ts`) targets only product packages and
does not include docs-site, so the canonical `pnpm build` is unaffected. `pnpm test`
(vitest) does not pick up docs-site because it has no `test/**` suite.

### Verification

Documentation-site verification is the site build itself: `pnpm --filter @rogatio/docs-site build` must
succeed and emit `dist/`. The root canonical validation (`format:check`, `lint`,
`typecheck`, `build`, `test`) must remain green after the package is added, proving the
isolation rules hold.

### Rejected alternatives

- Docusaurus / VitePress / Nextra: rejected because the product overview and sequence
  explicitly name Astro + Starlight, and Starlight's sidebar/i18n/accessibility fit the
  multi-section docs (guides, rules reference, CLI/extension reference) without a custom
  framework.
- Embedding docs inside the README or the existing `docs/` internal directory: rejected
  because `docs/` holds internal specs/plans/workflows for agents, not a published,
  navigable user site; mixing them would confuse published content with internal process.
- Building the site with the root esbuild pipeline: rejected because Astro/Starlight have
  their own build toolchain that the root script does not and should not drive.
## E2E and Integration Test Suite

The E2E and integration test suite is the full-product test suite that closes the gap between per-package unit tests and
the shipped artifacts. It proves, with real processes and real browsers, that the CLI,
editor, extension, runtime, and packaged artifacts work together the way a user consumes
them. It deliberately does **not** re-test per-package logic that the individual feature specs already cover; it
exercises the seams those suites cannot reach: real HTTP servers, real Chromium, real
packed tarballs, and the real extension service worker.

### Test layers

1. **Integration tests (`test/integration/`, Vitest, Node):** real-process journeys using
   the built artifacts. The packaged CLI is produced with `pnpm pack` for every `@rogatio/*`
   workspace package, installed with `npm install --offline` into a temp directory, and
   executed as a real binary (`verify`, `test`, `runtime status`, `--version`). The CLI
   `edit` server is driven over real HTTP (editor page, vendor bundle, CSRF-protected
   validate/save/cancel, file writes, shutdown). The mock runtime (`rogatio runtime`) is
   started as a real process and its pairing/authorization/mock-response journey is proven
   over real loopback HTTP, including denial paths. These tests are cross-platform and run
   in the `cross-platform` CI job.

2. **Packaged-install tests:** the packed-tarball CLI test above is the packaged-install
   proof for the CLI. The extension's "package" is its built `packages/extension/dist`
   directory loaded as an unpacked extension in real Chromium (the extension is distributed
   as a ZIP in the release pipeline; the unpacked-load journey is the same code path). The manifest contract
   and MV3 artifact hygiene remain enforced by `scripts/validate.ts`.

3. **Playwright headless browser journeys (`test/browser/`, real Chromium):**

   - **CLI `edit` journey:** the real built CLI process serves the editor; a headless
     Chromium page edits a project, validates, saves, and the file is verified on disk and
     the server shuts down.
   - **Extension lifecycle journey:** the real built extension is loaded into a persistent
     headless Chromium context (`channel: "chromium"`, `--disable-extensions-except` +
     `--load-extension`). The journey imports a project, reviews declared permissions
     (real `chrome.permissions.contains`), activates groups, reads rule statuses and the
     badge, switches/creates/exports/removes projects, and proves storage persistence
     across service-worker restarts.
   - **Extension DNR journey:** a redirect DNR rule in the extension's own rule shape is
     installed through the real `chrome.declarativeNetRequest.updateDynamicRules` API and
     accepted by Chrome, proving the translated rule shape is Chrome-valid (RE2, domains,
     resource types).
   - **Mock runtime journey:** the real `rogatio runtime` process is started; the real
     extension's "Check and connect" flow pairs with it and reports `connected`.

### The permission-prompt boundary (evidence-based)

Chrome's optional-host-permission prompt cannot be automated: `chrome.permissions.request`
never resolves in headless or headed Chromium when a prompt is required, profile
pre-seeding of `granted_permissions` is rejected (Secure Preferences MAC), and Playwright
has no API to answer the prompt (upstream microsoft/playwright#32755). The E2E suite
therefore proves the permission flow at the integration seam (the extension's injected
permission adapters and the exact-origin request), asserts the real-browser `needs
permission` statuses, and documents the grant click as a manual check. No test hook,
fake grant, or profile forging is added to the product; the browser grant stays a real
user gesture. The granted-end-to-end redirect/mock interception remains covered by unit
and integration tests plus the request-body-rules live E2E on capable runners.

### Product repairs surfaced by the suite (in scope)

Building the real journeys exposed defects that the mocked unit tests could not:

- **Permission origin patterns (`packages/extension/src/chrome.ts`):** `chrome.permissions`
  rejects bare origins (`http://127.0.0.1:4173`) — the adapter now maps origins to match
  patterns (`origin + "/*"`).
- **User-gesture grant (`extension-page-entry.ts`, `service-worker.ts`):** a user gesture is
  lost across the runtime message round trip, so the extension page performs
  `chrome.permissions.request` directly in the click handler and the worker re-syncs stored
  grants (a `granted` flag skips the worker-side request).
- **Editor rule-type registration (`packages/editor/src/editor.ts`):** hosts pass
  `mock`/`response-body` rule types that are already built in; `normalizeExtensions` threw
  instead of replacing. Passed ids now replace built-ins; duplicates within the passed list
  still fail closed.
- **CLI packaged binary (`packages/cli/src/index.ts`):** the built entry lacked a shebang
  so the installed `rogatio` bin could not execute, and the `isDist` check used a
  POSIX-only separator, breaking packaged installs on Windows.
- **DNR install wiring (`service-worker.ts`):** enabled+granted redirect/query rules were
  never installed (only mock rules at check-and-connect), leaving them `error` forever.
  `projectState` now installs enabled+granted installable operations through the real
  installer.

### Harness rules

- No new dependencies; Node-only orchestration; cross-platform paths; no shell-only
  scripts.
- Real artifacts and real processes; a test that cannot reach its subject is a failure,
  not a skip. The only skipped-by-default cases are the request-body-rules live E2E and the manual
  permission-grant check.
- Deterministic diagnostics; assertions never depend on third-party wording or
  incidental iteration order.
- The extension E2E computes the unpacked extension id from the path
  (`sha256(path)[0:16]` nibbles) so it can find the service worker and extension page
  without hard-coded ids.
- Browser contexts are per-spec and closed deterministically; spawned CLI/runtime
  processes are killed in `finally` blocks.

### Testing seams

- CLI/runtime integration: real `node` children of the built CLI, real loopback HTTP.
- Packaged install: real tarballs via `npm install --offline` into a temp dir.
- Extension E2E: real Chromium (`channel: "chromium"`), real extension, real
  `chrome.permissions`, `chrome.storage.local`, and `chrome.declarativeNetRequest`.
- Grant flow: the extension's injected `PermissionAdapter` (existing seam) plus the
  manual browser check.
- DNR shape: `chrome.declarativeNetRequest.updateDynamicRules` acceptance in real
  Chromium.

### Rejected alternatives

- Mocking `chrome` APIs in the browser journey: rejected — that is what the existing
  fixture-based `extension.spec.ts` does and it cannot catch real Chrome boundary
  failures (the bugs above).
- Pre-seeding `granted_permissions` in the Chrome profile: rejected after empirical
  failure (Secure Preferences MAC validation) and because committing a browser profile
  would import machine-local state.
- Test-only permission hooks in the extension: rejected — they would weaken the
  permission boundary in the shipped artifact.
- A synthetic DNR test page instead of the real extension: rejected — the journeys must
  load the real built extension.
- Committing a golden profile with manually granted permissions: rejected — machine-
  and Chrome-version-specific, and it would carry browser state into the repository.

## Native runtime consolidation (feature/consolidated-native-runtime)

All F6 runtime behavior (pairing, authorization, mock delivery) now runs inside the F14
native-messaging host instead of a separate CLI HTTP server. One process serves every
runtime need (spec REQ-001).

### Components affected (this pass)
- `packages/runtime/src/`: removed `server.ts` (F6 HTTP mock/pair server); `mock.ts` now
  renders bytes for envelope transport; `envelope.ts` allows base64 `mockBody` only on
  `mock.response`; `lifecycle.ts` integrates pair/authorize/mock dispatch and starts
  unconditionally; new `host.ts` is the stdio native-messaging loop plus a loopback
  mock-body faucet (`--mock-port`); `proxy.ts` retained (request-body markers).
- `packages/cli/src/commands/runtime.ts`: removed the `rogatio runtime [path]` HTTP
  mock-server path; added `rogatio runtime-host <path>` (with `--mock-port`); kept native
  start/stop/status and trust lifecycle. The CLI `rogatio` binary also routes a
  `runtime-host` argv[1] basename to the host entry point so the native-messaging
  manifest's `runtime-host` executable works.
- `packages/extension/src/background.ts`: production `nativeRuntime` adapter built over
  `chrome.runtime.connectNative` (envelope `send` + thin start/stop/status/sendPolicy
  shims). Mocks are discovered via `connectNativeMock` (`mock.connect`) and delivered
  through the single native host.
- `packages/extension/src/native-session.ts`: `connectNativeMock`/`requestNativeMock`
  envelope methods (REQ-013); `mock.connect` returns the loopback faucet `port` + per-rule
  tokens.
- `packages/extension/src/service-worker.ts`: `check-mock-runtime` prefers the native-host
  envelope path, storing the connection (port + tokens) for the DNR `mockUrlResolver`
  (REQ-007). The two phase *states* (MockRuntimePhase for mock-connection status,
  NativeRuntimePhase for control) remain for status reporting, but both are now driven by
  the single consolidated native host; the standalone HTTP mock server is gone.

### Components affected (follow-up, NOT in this pass)
- `packages/extension/src/mock-runtime.ts`: the HTTP `fetchMockConnection`/`DEFAULT_MOCK_PORT`
  path is now dead (legacy fallback only); `createMockConnectionHolder` is retained as the
  connection holder.
- Replacement of the F6/F13/F14 specs by the consolidated spec (the consolidated spec
  supersedes them by scope).

### Protocol design
Only stdio native-messaging (`f14-v1` extended). New envelope message types:
`pair.request`, `pair.response`, `authorize.request`, `authorize.response`,
`mock.connect`, `mock.request`, `mock.response`. Pair/auth reuse the F6 capability (random
token) + preset digest authorization within the envelope handshake. Mock responses use the
base64 `mockBody` field (max 64KB, `ENVELOPE_MAX_BYTES`).

### Security boundaries (unified)
- Pairing capability + preset digest authorizes the session.
- Authority revalidation (`revalidateAuthority`) applies to all transforms (mock + body +
  header).
- Body confidentiality: for non-mock transforms the envelope never carries body bytes (as in
  F14); for mock responses the body is delivered via `mockBody` base64 and never
  persisted/logged/exported outside the process.
- The native host starts unconditionally (no `unsupported` state from adapter absence).

### State transitions
- Native host: `idle` → `running` (start) → `stopped` (stop). No `unsupported` state.
- Extension service-worker: mock discovery and control both run through the single native
  host (the HTTP mock server is removed); phase states remain for status reporting.

