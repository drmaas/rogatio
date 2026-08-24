# Rogatio Architecture

**Status:** F1 bootstrap, F2 schema, F3 compiler, F4 browser-core, F5 editor, F6 runtime foundation, F7 extension shell, F8 CLI, F9 redirect rules, F10 query rules, F11 header rules, and F12 offline dry-run are released through Stage 10. **F13 mock rules** is in progress in the `feature/f13-mock-rules` worktree (implementation rebased onto current main). **F14 macOS native-messaging runtime** is implemented on current main; its native runtime controls remain integrated with the shared `rogatio runtime` command.

## Package Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        @rogatio/schema (F2)                      │
│  JSON Schema v1, AJV validation, origins, bounds, forbidden hdrs │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @rogatio/compiler (F3)                      │
│  Validated source → browser-neutral operations + diagnostics    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌────────────────────┐
│ @rogatio/        │ │ @rogatio/    │ │ @rogatio/          │
│ browser-core (F4)│ │ editor (F5)  │ │ runtime (F6)       │
│ Storage, perms,  │ │ Framework-   │ │ Mock/response      │
│ enablement, CAS  │ │ free DOM     │ │ server foundation  │
└────────┬─────────┘ └──────┬───────┘ └────────┬───────────┘
         │                  │                   │
         └──────────────────┼───────────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ @rogatio/cli (F8)    │ ◄── NEW
                 │ edit, verify, runtime│
                 └──────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     ┌─────────────────┐           ┌───────────────┐
     │ Chrome MV3 Ext  │           │ Native Runtime │
     │ (F7, F9-F13)    │           │ (F14-F17)      │
     └─────────────────┘           └───────────────┘
```

## Security and Privacy Boundaries

The project introduces only development and validation tooling plus the local-first product packages described below. It must not add credentials, telemetry, hosted endpoints, traffic capture, native messaging, proxies, TLS handling, or persistent user data beyond the version-controlled `.rogatio.json` project file. Dependencies are controlled by the committed pnpm lockfile, exact or explicitly governed tool versions, separated development dependencies, and a reviewed install-script policy. Generated files and secrets must not enter version control.

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

## F7 Chrome MV3 Extension Architecture

F7 adds a private `@rogatio/extension` package as the first downstream browser boundary. The extension owns Chrome MV3 adapters, the service-worker message protocol, the extension-page project-management shell, and the translation from F4 matcher operations to deterministic Chrome Declarative Net Request rules. It depends on `browser-core`, `compiler`, `editor`, and `schema`; upstream packages remain browser-neutral and do not import Chrome APIs.

The service worker is the authority for `storage.local` persistence, permissions, project lifecycle commands, group enablement, actionless matcher projection, rule statuses, and the action badge; DNR installation remains deferred until action-bearing slices exist. It injects narrow adapters into the F4 `ProjectRepository` and `InstallService`, so CAS, conflict preservation, single-active-project, 64-project, enablement, status, and rollback invariants remain implemented once. The extension page sends versioned, validated messages and mounts the shared F5 editor for the active project's canonical source. Selecting a project is local UI state; only an explicit Switch command invokes the repository switch operation.

MV3 output is browser-bundled from the approved browser-safe source graph. The extension must not load the Node-oriented Ajv artifact or any Node global at runtime. Chrome API failures, malformed messages, hostile imported/storage values, and unknown protocol versions fail closed with stable extension diagnostics. Permission requests are projected from F4's sorted effective origins and never include undeclared origins or broad host patterns. Group activation remains separate from permission grant, and project creation/import/save never grants or enables anything automatically.

The common F7 translator emits only a deterministic browser-neutral matcher projection. It preserves regex source, resource types, method, priority, and effective origins, assigns deterministic numeric ids for future action translation, and rejects unsupported operation kinds without installation. Because the F3 matcher operation has no action, F7 reports actionless rules as `unsupported` and never sends them to DNR; it must not invent an allow or no-op action that changes browser behavior. `InstallService` remains the atomicity/recovery seam for later action-bearing DNR adapters. Action-specific operation kinds and their UI/editor extensions are deferred to F9-F17.

F7 emits no traffic or console diagnostics. The `[Rogatio]` DevTools Console record from the broader product overview is deferred to a later explicitly specified feature so its Chrome event source and redaction contract are not guessed inside the extension shell. F7 does not add network, runtime, native messaging, proxy, TLS, telemetry, or traffic persistence behavior.

Storage is a single versioned envelope (`version`, a project record keyed by stable id, and `activeProjectId`) persisted through a `StorageAdapter` whose `compareAndSwap` is the atomicity authority. Reads defensively snapshot raw storage and validate envelope structure; unknown versions, structural violations, cycles, symbols, accessors, and proxies fail closed with `core.storage-corrupt` and no writes. Project data is fully validated through the F2/F3 boundary at write time. Repository operations are read-modify-compare-and-swap: non-explicit operations retry on transient CAS failure, while editor-style saves and strict imports carry an expected revision and return a `conflict` result preserving the committed project for an explicit refresh path.

The repository maintains the documented product invariants: at most 64 uniquely named projects, exactly one active project whenever any exist (the first created/imported project activates; removing the active project activates the most recently updated remaining project, tie-broken by id), creation/import/update and browser save reset group enablement to all-disabled, and grants are restricted to declared effective origins and pruned when data changes. Switching restores the destination project's saved enablement without touching permission or runtime state.

Rule statuses derive from compiled operations, saved enablement, granted origins, and the installed rule ids reported by the installer adapter: disabled groups are `disabled`, enabled rules with un-granted origins are `needs permission`, enabled and granted rules missing from the installed set are `error` with `core.rule-not-installed`, and installed rules are `active`. The `needs proxy` and `unsupported` statuses are part of the defined model and populate only when runtime-dependent rule kinds land in later slices. The badge is a pure function of statuses: the active rule count plus an attention flag. `InstallService` atomically replaces the installed set through the `RuleInstallerAdapter`, treats identical sets as a no-op, rolls back to the previous set on failure with `core.install-failed` / `core.recovery-failed`, and serializes concurrent applies. Mock (`disconnected/checking/connected/failed` with last-check) and native (`stopped/starting/started/failed`) runtime phases are modeled in memory with a guarded transition table; runtime state is not persisted until the runtime slices define their semantics.

## F5 Editor Architecture

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

## F6 Runtime Foundation

F6 adds a private Node ESM `@rogatio/runtime` package depending on `@rogatio/schema` and `@rogatio/compiler`, with no HTTP framework, proxy framework, native-messaging, TLS, browser, or additional product dependency. The package is implemented and verified through Stage 10.

### Ownership and data flow

F2 remains authoritative for HTTP method names and common validation policy. F3 provides the detached matcher operations that identify the source group and rule. Runtime-specific grants are a separate F6 authorization record: each grant names one source rule, one opaque operation ID, one primitive kind, one canonical target, and one exact method. Outbound grants are restricted to public HTTP(S) GET or HEAD targets whose origin belongs to the corresponding F3 matcher; file grants carry an exact logical path. F6 does not execute the F3 regular expression, select a matching rule, resolve priority, or interpret a future action payload. The trusted controller supplies the already-selected grant; the runtime verifies that the grant is bound to the corresponding F3 matcher operation and to the immutable preset digest.

The package has four owned layers:

- **Policy core:** validates hostile input, creates detached immutable runtime presets, canonicalizes targets, computes a versioned SHA-256 digest, issues the bootstrap capability, and performs deny-by-default exact authorization.
- **Protocol adapter:** exposes only versioned pairing and authorization routes through Node `node:http`, accepts HTTP/1.1 on `127.0.0.1` only, bounds streams, and serializes stable redacted errors.
- **Outbound connector:** accepts only an authorized `outbound-http` grant, resolves A and AAAA records, rejects any unsafe result, connects once to a selected numeric address without proxy or re-resolution, strips credentials, and rejects redirects.
- **Confined reader:** accepts only an authorized `confined-file` grant under the configured root, reads from a verified descriptor with no-follow guarantees, and denies the operation when the host platform cannot prove confinement.

The protocol adapter returns an authorization decision, not a mock response. The outbound connector and confined reader are explicit primitives for later consumers. F13 owns mock status, headers, bodies, delays, file-snapshot semantics, and browser integration. F14 owns native messaging, TLS/PAC, request-body handling, and its separate process. Neither later feature is implemented or specified as an F6 action here.

### Preset, digest, and capability boundary

The F6 preset is an internal, independently versioned data contract. Its canonical form contains F3 matcher data, F6 grants, and fixed resource limits; it excludes the random capability, session values, timestamps, and the local filesystem root. Objects use a fixed key order, grants use a deterministic tuple order, values are limited to strings, booleans, integers, arrays, and null, and canonical bytes are whitespace-free UTF-8 JSON. The format is a versioned closed F6 profile rather than an assumption that ordinary `JSON.stringify` is canonical. The digest is `sha256:<64 lowercase hexadecimal characters>` over those bytes.

Starting a server creates a fresh 32-byte random bootstrap capability and an ephemeral port. The controller receives the bootstrap material in-process; the server never places it in a URL, log, or error. `POST /v1/pair` requires the capability and preset digest in dedicated headers, consumes the bootstrap capability once, and returns a short-lived random session capability. Every authorization request requires the session capability and the same digest. Capabilities are compared with fixed-length timing-safe comparison, are memory-only, and expire with the server session. Stopping the server invalidates all capabilities and aborts active work. There is no hot policy reload; changing a preset requires a new server, so no partial policy can be observed.

### Exact authorization and failure behavior

Authorization is an AND of transport admission, active session, capability, preset digest, grant identity, primitive kind, canonical target, and exact method. A failure in one condition cannot be broadened by another grant, priority, wildcard, fallback, or source order. Authorization completes before DNS, socket, filesystem, or response-body work. Unknown routes, malformed control data, missing credentials, mismatches, unsafe addresses, redirect responses, file confinement failures, timeouts, and size violations map to a closed set of stable F6 error codes. Responses never contain raw URLs, credentials, headers, bodies, local paths, DNS answers, addresses, stack traces, or third-party error text.

### Network and file security

Outbound targets use one strict WHATWG URL policy: HTTP(S) only, no userinfo, fragment, controls, backslashes, ambiguous invalid encoding, raw non-ASCII authority text, trailing-dot hostname, or unsupported port. F6-v1 allows only ports 80 and 443 and outbound GET or HEAD. All resolver results are classified, including IPv4-mapped IPv6. Any loopback, unspecified, private, link-local, multicast, carrier-grade, documentation, benchmarking, reserved, or otherwise non-public result denies the complete operation. The connector selects one allowed numeric address, disables address racing and proxy configuration, preserves the authorized hostname for HTTP Host and HTTPS SNI, and never retries or follows a redirect.

File grants contain a relative logical path, never an arbitrary server path. Absolute, traversal, encoded traversal, alternate-separator, drive, UNC, NUL, control, symlink, non-regular, and over-limit paths are denied. `realpath` is used only as part of validation; it is not treated as a race-free primitive. The reader anchors the configured root, uses no-follow descriptor operations, checks the opened object, and reads only from that descriptor. A platform without the required guarantees reports an unsupported operation instead of falling back to a path-only check.

### Alternatives rejected

- A general forward proxy or catch-all file route is rejected because it would turn loopback reachability into unrestricted SSRF or filesystem authority.
- A single mutable policy or watcher is rejected; stop-and-recreate gives atomic policy identity and a simple rollback story.
- Redirect following is rejected in F6; a second authorization and DNS decision would expand the trust boundary without being needed by the foundation.
- Per-operation browser-visible capabilities are deferred; one-use bootstrap pairing plus a short-lived session supports repeated read-only operations without adding a capability-minting round trip. Side-effecting operations require a later specification.
- `realpath`-only confinement and the default fetch/proxy client are rejected because neither proves descriptor or address pinning.
- A full RFC 8785 dependency is not required for the closed internal preset; F6 instead defines and versions a narrow canonical JSON profile and does not add a dependency solely for serialization.

The complete proposed contract and acceptance criteria are in `docs/specs/f6-runtime-foundation.md`; the staged workflow record is in `docs/f6-workflow.md`.

## F14: macOS Native-Messaging Runtime

F14 adds the separately installed macOS runtime that response-body and request-body rules reach through Chrome native messaging. It is a distinct process and protocol (`f14-v1`) from the F6 mock/response server, and adds no F6 action, proxy, TLS, or native-messaging behavior to that package.

### Ownership and data flow

`@rogatio/runtime` gains F14 control, lifecycle, revalidation, envelope, and interception-gate modules. `@rogatio/cli` gains a real `rogatio runtime` command (`start` / `stop` / `status` / `--help`). F2 remains authoritative for the project shape and origins; F3 remains authoritative for matcher operations used in revalidation. F14 does not add F15/F16/F17 rule behavior, only the runtime those slices depend on.

Four owned layers:

- **Lifecycle controller:** explicit `start` / `stop` / `status` with guarded states `stopped → starting → started → stopping → stopped`, idempotent `stop()`, and a capability-based activation gate that reports `unsupported` only when a trusted device-local CA cannot be provisioned or Chrome PAC routing would collide with an existing controlling proxy/PAC/extension/enterprise policy.
- **Revalidation core:** `revalidateAuthority(context)` independently re-derives authority from the validated F2 project and compiled F3 operation for an incoming request. It does not trust the browser's grant; the AND of rule existence, urlRegex match, effective-origin membership, method match, resource-type match, initiator scope, and target-origin membership must all hold.
- **Control envelope:** a versioned `f14-v1` JSON channel (`start`, `stop`, `status`, `authorize`, `transform-request-meta`, `transform-response-meta`) carrying metadata only. Bodies never cross the envelope; a structural test proves it.
- **Interception gate (capability-based):** scoped Chrome PAC generation as a deterministic pure function, plus an ephemeral TLS proxy / device-local CA module reachable only after a successful capability-based activation. When the required capabilities are absent, it returns `runtime.unsupported` and performs no socket or certificate work, regardless of OS.

### Authority boundary

The browser grant is not a security boundary. Every transformation request is re-checked against the canonical `.rogatio.json`: the rule must exist, its URL regular expression must match the request URL, the request origin and target origin must be within the rule's effective origins, the method must match when the rule specifies one, the resource type must be allowed, and the initiator origin must be within granted scope. A denied request triggers no interception and no body oracle. Revalidation completes before any body work, is deterministic, and never trusts a supplied grant boolean.

### Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging envelope carries bounded metadata and transform instructions, never body bytes, credentials, sensitive header values, or file contents. A diagnostic sink, if present, receives only redacted lifecycle/counter events.

### Alternatives rejected

- Trusting the browser grant as authority is rejected; revalidation re-derives from the canonical project.
- A general forward proxy is rejected; only explicitly granted origins are routed through the scoped PAC.
- Persisting interception, capability, or traffic state is rejected; F14 keeps no history.
- Live TLS interception and CA trust installation require a platform where a trusted device-local CA can be provisioned and Chrome PAC routing does not collide with an existing controlling proxy/PAC/enterprise policy. macOS is the reference supported platform; Linux/Windows may also activate when those capabilities are present. F14 ships the capability-gated module and deterministic PAC generation; the live interception is completed by F15/F17 where the capabilities exist.

The complete proposed contract and acceptance criteria are in `docs/specs/f14-macos-runtime.md`; the staged workflow record is in `docs/f14-workflow.md`.

## F8: CLI Package Architecture

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

## F12: Offline Dry-Run / Test Feature

### Overview

F12 adds a pure-offline, bounded URL-batch dry-run capability that evaluates matcher operations (from F3) against a list of test cases without contacting the network, requesting permissions, changing installed rules, connecting to runtime, or saving test data. It is usable from both the CLI (`rogatio test`) and the Editor (`Test rules` route/panel).

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
│ validateProjectDetailed (F2) │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ compileProject (F3)  │ → MatcherOperation[]
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ dryRunProject (F12)  │
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
@rogatio/schema (F2) ──► @rogatio/compiler (F3) ──► @rogatio/dry-run (F12)
                                          │              │
                                          ▼              ▼
                                   @rogatio/editor (F5) @rogatio/cli (F8)
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

- **Option A approved** — matcher-level dry-run now + `previewAction` seam; redirect/query previews deferred to F9/F10.
- **maxCases default 256** — accepted per user gate.
- **Editor dry-run via host adapter** — no Node import in browser bundle, consistent with F5.

## F9: Redirect Rules (action slice)

F9 is the first *action* slice introducing a browser-side effect. It adds the rule-type
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

## F10 Query Parameter Rules (first rule-action slice)

F10 adds the shared rule `action` discriminator to the version-1 schema and implements the first browser-only action: **query parameter rules**. It spans `@rogatio/schema`, `@rogatio/compiler`, `@rogatio/extension`, and `@rogatio/editor`. F7's actionless `unsupported` rule model is replaced by action-bearing installable rules for the `query` type; later browser-only slices (F9 redirect, F11 header, F13 mock) extend the same `action` union.

### Schema (F2 boundary change)

`RogatioRule` gains an `action` object with a `type` discriminant. F10 defines `QueryAction = { type: "query"; params: { name: string; value: string }[] }`. The schema `rule` `$defs` adds `action` (additionalProperties still false) and a `queryAction`/`action` subschema. New bounds: `maxQueryParamsPerRule`, `maxQueryNameLength`, `maxQueryValueLength`. Semantic validation adds a duplicate-param-name check and the non-empty/length bounds. `browser-schema.ts` mirrors the same `action` validation and bounds because the MV3 bundle cannot load Ajv. `action` is optional to preserve backward compatibility with F7 actionless projects.

### Compiler (F3 boundary change)

Compiler emits distinct operation types: `MatcherOperation` (actionless), `RedirectOperation` (F9), and `QueryOperation` (F10). `compileProject` emits the appropriate operation type based on `rule.type`. A pure helper `queryParamsToDNR(action)` produces the DNR `addOrReplaceParams` array (`replaceOnly: false`) for unit testing without a browser. This is the durable foundation F11/F13 extend by adding new operation types.

### Extension (F7 boundary change)

`projection.ts` `projectMatchers` dispatches on operation kind. For `QueryOperation` it builds a DNR rule with `redirect.transform.query`; for `RedirectOperation` it builds a DNR `redirect` rule; for `MatcherOperation` it returns `installable: false`. `service-worker.ts` `operationStatuses` reports redirect and query rules as `active` when compiled, enabled, and granted; actionless matchers remain `unsupported`. Permission domains derive from origin hostnames (requestDomains/initiatorDomains). The `[Rogatio]` DevTools record stays deferred.

### Editor (F5 boundary change)

The `RuleTypeFieldExtension` registry gains a `query` extension whose `matches(rule)` returns `rule.action?.type === "query"`. The editor adds a `Rule type` selector listing registered extension labels; selecting `query` initializes `action = { type: "query", params: [] }` and mounts the extension's param name/value form (add/remove rows). The extension `validate` enforces field-level diagnostics. Unknown action data with no owning extension is not persisted (preserves the F5 rejection of arbitrary `action` passthrough).

### Migration / compatibility

The version-1 schema keeps `action` optional to preserve backward compatibility with F7 actionless projects. Rules without `type`/`action` remain valid actionless matchers (reported `unsupported`). F10 is browser-only and supported on Linux/Windows/macOS; activation is in-browser, no native runtime.

### Rejected alternatives

- Keep `action` optional to preserve F7 actionless projects: accepted for backward compatibility; actionless rules remain valid but `unsupported`.
- Add-or-replace via separate `addParams`/`removeParams`/`replaceParams` DNR fields: rejected; `addOrReplaceParams` with `replaceOnly: false` is exactly the required add-or-replace semantics in one field.
- Implement query rewriting in the extension service worker rather than DNR `transform.query`: rejected; DNR is browser-native, declarative, and offline, matching F7's design.

## F13: Mock Rules

F13 adds the `mock` rule type as a vertical slice: a configured HTTP status, optional
response headers, an optional delay, and either an inline body or a live UTF-8 snapshot
of one approved local file, served to matched browser requests without ever contacting
upstream. It integrates the rule slice with the F6 runtime server, the editor, the CLI,
and the extension, including the single user-clicked Check-and-connect request.

### Rule payload and compiler

- `schema/src/types.ts`: `RuleType` gains `"mock"`; new `MockHeader { name; value }` and
  `MockAction { status: number; headers?: MockHeader[]; delayMs?: number; body?: string;
  file?: string }`; `RogatioRule.mock?: MockAction` required iff `type === "mock"`.
  Exactly one of `body`/`file` is set. The `mock` sub-object follows the F9 `redirect`
  pattern (a type-specific payload field), not the F10 `action` field.
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

### Runtime mock serving (F6 boundary change, same `@rogatio/runtime` package)

F6 remains the mock/response server process; F13 extends it with mock response
semantics. F6's control protocol (`POST /v1/pair`, `POST /v1/authorize`) is unchanged
and still returns authorization decisions only.

- **Preset extension:** the internal F6 preset gains an optional `mocks` array
  (`{ ruleId, status, headers, delayMs, body?, file? }` where `file` is a relative
  logical path). Presets without `mocks` behave exactly as before. Canonical bytes and
  the SHA-256 digest cover the mock *config*; per-rule mock *tokens* are capability-like
  and excluded (digest stays stable per project). Deterministic ordering and the closed
  canonical profile are preserved.
- **Per-rule mock tokens:** server startup mints a fresh 32-byte cryptographically
  random token per mock rule, stored only in memory and bound to the ruleId and server
  instance. Tokens are designed to appear in browser redirect URLs (unlike the F6
  bootstrap/session capabilities, which never do); they are never logged or echoed in
  error responses.
- **Mock route:** `GET /mock/<token>` serves the configured response: optional bounded
  delay (cancelled on client disconnect and server stop), configured status and headers
  (default `Content-Type: text/plain; charset=UTF-8` when the user configures none), and
  a body from the inline string or a live confined-file read of the approved file.
  Permissive CORS headers are emitted **only on this route** (needed for cross-origin
  XHR/fetch from web pages to the loopback mock server); the F6 control protocol never
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
  default cwd, `-` for stdin), validates + compiles via F2/F3, builds the runtime preset
  with the project's mock rules (resolving file rules against the configured root,
  default the project directory; paths outside the root are rejected), starts
  `createRuntimeServer` on the fixed default port, prints connection info and
  instructions, and stops cleanly on SIGINT/SIGTERM. `--root` configures the confined-
  file root; `--port` overrides the default. Invalid projects exit `1` with the same
  diagnostics style as `verify`; port/startup failures exit `2`.
- `rogatio test` and the `edit` server gain a mock `previewAction` (via the existing F12
  `previewAction` seam) producing e.g. `{ kind: "mock", summary: "Mock 200 (inline
  body, 42 bytes)" }` or `"Mock 200 (file snapshot: <basename>)"`. The dry-run engine
  itself is unchanged.

### Extension (Chrome MV3)

- **Manifest:** add `"declarativeNetRequest"` to `permissions` (required for DNR
  dynamic rules; grants implicit redirect access without host permissions). This also
  unblocks F9/F11 DNR installs in real browsers.
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
  on service-worker restart (per F4; the status represents the last check).

### Editor (F5)

A `mock` `RuleTypeFieldExtension` renders status (number), optional delay (number),
header name/value rows (add/remove), and a body-source selector (inline textarea vs.
file path input — the browser-safe editor cannot pick files, so the path is a validated
string; existence is validated by the CLI at runtime start). Validation enforces the
schema bounds and the exactly-one-body-source invariant with stable field diagnostics.
`createMockRuleType` is added to `builtInRuleTypes` and exported.

### browser-core (F4)

No core status change: `computeRuleStatuses` already operates on `operation.matcher`.
The `needs proxy` / `error` rewrites for mock ops are service-worker logic (like the
matcher `unsupported` rewrite). `RuntimeStateController` already models the mock runtime
state and is wired in the extension service worker.

### Rejected alternatives

- Ephemeral port + connection file for runtime discovery: rejected (MV3 cannot read
  arbitrary local files without native messaging, which is F14).
- Extension pairing via the F6 control protocol for the connect UX: rejected (requires
  conveying the bootstrap capability into the extension; contradicts the one-click
  Check-and-connect).
- A generic mock proxy or arbitrary file route: rejected (would break the F6 confined-
  file and exact-grant model; mocks serve exactly the one approved file per rule).
- Mock path-based routing (serve different content per request URL): rejected; a mock
  rule returns one configured response regardless of the matched URL, matching the
  product description.
