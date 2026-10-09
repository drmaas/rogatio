# Rogatio Architecture

> Code is the source of truth for current behavior. Links to `docs/specs/`, `docs/plans/`, and `docs/workflows/` point to frozen decision records; see `AGENTS.md` "Source-of-truth priority".

**Status:** F23 unified native-host runtime direction approved and implemented for the extension Start/Stop runtime control surface (issue #170). Response-body rules match in the browser as a declarativeNetRequest redirect to the loopback listener, which rechecks the rule and performs its own credential-free GET. Request-body rules are not DNR rules: PAC steers `scheme://literal-host/*` and the runtime checks the path regex. Request-body HTTPS CONNECT remains a blind tunnel; CA trust applies only to that HTTPS path.

## F23 Unified Native-Host Runtime Direction

One extension-launched native host owns response-body, request-body, internal proxy/TLS, and upstream forwarding. Native messaging carries lifecycle, policy, and metadata/control; observed traffic bodies remain in the host-owned interception path. The host is launched by the browser via the native-messaging manifest when the user clicks **Start runtime** in the extension; clicking **Stop runtime** unregisters the session. Only owned routing is removed on stop, active operations are aborted, transient body buffers are cleared, and prior proxy state is restored.

The extension exposes only Start runtime and Stop runtime during normal use. The CLI has no session lifecycle subcommand; the previous `rogatio runtime activate` / `deactivate` / `status` commands were removed because they were pure ceremony over an empty-preset controller and did not control the real session. Separate Check and connect actions and mock connection state are removed. Non-matching or unsupported requests pass through untouched, and only the highest-priority matching request-body rule applies. CLI functionality remains limited to one-time host installation (`install` / `uninstall`), CA trust, and administrative diagnostics; it is not required to start or operate a browser session.

See [F23 Host Session Details](#f23-host-session-details-pac-and-pass-through) below for PAC collision checks, transactional start/rollback, and internal proxy scope.


## Package Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        @rogatio/schema                            │
│  JSON Schema v2, AJV, source conditions, bounds, forbidden hdrs  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @rogatio/compiler                            │
│  Validated source → browser-neutral operations + diagnostics    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
     ┌─────────────┬───────┴───────┬─────────────┬────────────────┐
     ▼             ▼               ▼             ▼                ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌────────────────┐
│ editor   │ │ dry-run  │ │ browser-core │ │ runtime  │ │ (schema+comp.  │
│ DOM UI   │ │ offline  │ │ storage,     │ │ body/TLS │ │  deps only)    │
│          │ │ matcher  │ │ perms, CAS   │ │ host     │ │                │
└────┬─────┘ └────┬─────┘ └──────┬───────┘ └────┬─────┘ └────────────────┘
     │            │              │              │
     │            │              │              │
     └────────────┼──────────────┼──────────────┘
                  │              │
         ┌────────┴──────┐      │
         ▼               ▼      │
┌────────────────┐ ┌────────────────────┐
│ @rogatio/cli   │ │ @rogatio/extension │
│ edit, verify,  │ │ Chrome MV3: DNR,   │
│ test, runtime, │ │ popup, management, │
│ ai, import     │ │ native-session     │
└────────────────┘ └────────────────────┘

`@rogatio/requestly-import` depends only on `@rogatio/schema` and is bundled into the CLI (`rogatio import requestly`). It does not depend on the compiler. The CLI validates the mapped project with schema and compiler before writing.

Off DAG: @rogatio/docs-site (Astro/Starlight). Stubs: @rogatio/smoke, @rogatio/sanity.
```

## Security and Privacy Boundaries

The project is local-first: no accounts, no hosted Rogatio runtime, no cloud sync, no telemetry, and no retained traffic history. Persistent product state is the version-controlled `.rogatio.json` project file (plus optional local AI provider config under the CLI's ai commands). Body rules may use Chrome native messaging, a loopback-only proxy, and a device-local CA for TLS interception; those capabilities are confined to `127.0.0.1`, capability/digest pairing, exact rule authorization, and the Start/Stop session model — they must not become a general forward proxy, file server, or traffic archive. Dependencies are controlled by the committed pnpm lockfile, exact or explicitly governed tool versions, separated development dependencies, and a reviewed install-script policy. Generated files and secrets must not enter version control.

## Schema Architecture

The schema package introduces `@rogatio/schema` as the authoritative validation boundary for the version-2 `.rogatio.json` envelope (with `migrateV1Project` for legacy version-1 imports). The package owns the root project metadata, named groups, and common rule matcher fields: stable IDs, labels, a **source condition** (`key`: `url` | `host`, `operator`: `regex` only, `value`: case-sensitive regular expression), resource types, priority, and optional method. Group and rule `origins` and top-level `urlRegex` are removed. It does not implement action payloads or any consumer behavior; later rule slices extend the envelope with their own action fields.

The schema is draft 2020-12 with strict additional-property rejection. Ajv compiles it with all-errors reporting and with coercion, defaults, and property removal disabled. A small semantic validation layer supplements JSON Schema for globally unique IDs, per-project name uniqueness across groups and rules together (compared case-insensitively after trimming and collapsing internal whitespace), compilable source regexes, host-key literal-hostname constraints where applicable, and the total rule bound. All errors use stable JSON-pointer paths and no rejected document is persisted or sent over the network.

Source validation compiles each rule's regex and enforces key-specific shape (URL-key patterns match absolute HTTP(S) URLs; host-key patterns pin a single hostname for PAC routing). Bounds and browser-neutral resource/method enumerations are exported from the package. Request and response forbidden-header lists are frozen and matched case-insensitively for later header-rule slices.

Response-body rules use a strict `responseBody` union: `{ mode: "replace"; body }`, `{ mode: "regex"; replacements }`, or untagged `{ replacements }` (compat alias for regex). Replace mode bounds the authored body with `maxResponseBodyBytes` (4 194 304). Regex modes require at least one compilable replacement. Execution is native-runtime fetch-then-transform; it preserves upstream status and headers and is not a mock response.

The verified schema distribution target is a Node ESM artifact because Ajv compiles its validator at module initialization. Browser and MV3 consumers must receive a later approved standalone/browser packaging strategy rather than loading this runtime-compiled entry under an extension CSP.

## Compiler Architecture

The compiler package adds `@rogatio/compiler` as a pure, Node ESM transformation boundary from validated schema projects to browser-neutral matcher operations. Because the schema envelope intentionally contains no action fields, the compiler emits one data-only matcher operation per source rule. Later rule slices add action-specific compiler operations; the compiler does not invent a no-op action or a browser-specific representation.

The public `compileProject(value: unknown)` entry point invokes the complete schema structural and semantic validation boundary before compiling. Invalid input returns a discriminated failure with stable compiler diagnostics and an empty operation list. A valid project produces fresh, serializable output: group and rule traversal order is preserved, each rule's normalized **source condition** is retained on the matcher operation, resource types use the shared canonical order, the exact regex source is retained with empty flags, and method and priority values pass through unchanged. The compiler does not sort by priority or expand a rule into a resource-type Cartesian product.

Compiler diagnostics use stable codes, severity, JSON-pointer paths, and structured parameters rather than exposing Ajv message text as an API contract. The package depends only on `@rogatio/schema`, has no browser or downstream-package dependency, and inherits the verified Node ESM distribution target. It performs no matching, action transformation, browser permission/DNR translation, filesystem, network, persistence, runtime, telemetry, or traffic-capture work.

## Browser-Core Architecture

The browser-core package adds `@rogatio/browser-core` as the browser-neutral core platform layer between `compiler` and the future extension/CLI surfaces. It owns versioned project storage, migrations, per-project enablement, compare-and-swap lifecycle, atomic rule installation with recovery, the in-memory runtime state model, rule status and badge computation, and stable core diagnostics. Every platform-specific capability enters through narrow injected adapters, so the same logic runs under Vitest and inside the future Chrome MV3 service worker. The verified distribution target remains Node ESM with `@rogatio/schema` and `@rogatio/compiler` externalized; MV3 packaging stays a later extension-boundary decision.

## Chrome MV3 Extension Architecture

The extension package adds a private `@rogatio/extension` package as the first downstream browser boundary. The extension owns Chrome MV3 adapters, the service-worker message protocol, the extension-page project-management shell, and the translation from browser-core matcher operations to deterministic Chrome Declarative Net Request rules. It depends on `browser-core`, `compiler`, `editor`, and `schema`; upstream packages remain browser-neutral and do not import Chrome APIs.

The service worker is the authority for `storage.local` persistence, permissions, project lifecycle commands, group enablement, actionless matcher projection, rule statuses, and the action badge; static redirect, query, and header rules install through DNR. Capture-dependent query and header values are not installed as literal templates; they require the native URL-action transformation path or an explicit unsupported/error state. The service worker injects narrow adapters into the browser-core `ProjectRepository` and `InstallService`, so CAS, conflict preservation, single-active-project, 64-project, enablement, status, and rollback invariants remain implemented once. The extension page sends versioned, validated messages and mounts the shared editor for the active project's canonical source. Selecting a project is local UI state; only an explicit Switch command invokes the repository switch operation.

MV3 output is browser-bundled from the approved browser-safe source graph. The extension must not load the Node-oriented Ajv artifact or any Node global at runtime. Chrome API failures, malformed messages, hostile imported/storage values, and unknown protocol versions fail closed with stable extension diagnostics. The manifest declares broad host access (`host_permissions: ["*://*/*"]`) at install time; there is no per-origin grant UI or `optional_host_permissions` flow. Group enablement is independent of runtime start, and project creation/import/save never enables groups automatically.

The common extension translator emits only a deterministic browser-neutral matcher projection. It preserves the normalized source condition, resource types, method, and priority, assigns deterministic numeric ids for future action translation, and rejects unsupported operation kinds without installation. Because the compiler's matcher operation has no action, the extension reports actionless rules as `unsupported` and never sends them to DNR; it must not invent an allow or no-op action that changes browser behavior. `InstallService` remains the atomicity/recovery seam for the action-bearing DNR adapters. Action-specific operation kinds (redirect, query, header) and their UI/editor extensions arrived in the later rule slices documented below.

The extension emits no traffic diagnostics and no service-worker console traffic beyond existing debug logs. When Chrome authoritatively reports a Rogatio-installed DNR rule match via `chrome.declarativeNetRequest.onRuleMatchedDebug`, the service worker looks up the durable match index, notifies an in-process post-lookup append seam (console inject is the sole consumer today; #204 history may subscribe later), then injects exactly one bounded, live-only lowercase `[rogatio]` line into the matched page's DevTools Console via `chrome.scripting.executeScript` in the ISOLATED world. The manifest adds `"declarativeNetRequestFeedback"` and `"scripting"` permissions; the match event is available only for **unpacked** extension loads — packed or store distribution omits the event and logging is a silent no-op. **Single pipeline:** `onRuleMatchedDebug` is the only match source — never native-host “matched” events for logging or history. Coverage is `redirect`, `query`, and `header` (dynamic DNR) plus `request-body` and `response-body` when session URL-match markers are installed and indexed, plus `mock` when session mock-redirect rules are installed and indexed (band `5_000_001+`; allow-guard id `6_000_000` never logs); `matcher` stays out (no fake DNR). Body markers are session-store `modifyHeaders` **set-only** rules on reserved `X-Rogatio-Dispatch-*` names with **inert** opaque values (band `3_000_001+`); strip is **non-DNR** runtime/proxy (`stripReservedMarkers`) — never DNR set + DNR strip of the same header. Install only when native session is active **and** `runtimeStripPathAvailable` is true (production stays fail-closed `false` until live traffic hits strip); no strip path → no markers → silence. Console line for body kinds means URL match ⇒ will attempt rewrite when the body path is live — not rewrite success; intended action is mode + ≤200 rewrite summary from rule config, never live body bytes or marker header values. Mock lines use the original request URL (pre-loopback redirect) with either the rule's logical mock file path (`file=…`) or `body=inline`; never the absolute mock folder or response bytes. Probe evidence: `test/browser/body-match-probe.test.ts`. **Live** fields from the event are URL, method, initiator, and resource type (`request.type`); **intended** redirect destination, query transforms, header ops, body rewrite summaries, or mock source come from a durable `rogatio.matchLogging.index` snapshot (`ruleId`, display `name`, kind, intent) written wholesale on successful dynamic DNR install (preserving body-marker and mock-redirect band entries) and merged with body-marker and mock-redirect ids on session start (failed install leaves the previous index; stop / start-failure drops owned body-marker and mock-redirect ids). The formatted line labels present fields as `method=`, `type=`, `url=`, then dim `ruleId=`, `name=` (when non-empty), `kind=`, intended action, and `initiator=` when supplied; absent fields omit their key rather than printing a placeholder. The line reports **matched** and **intended action**, never network success, and logs no live request/response bodies or wire-applied header values. Per logged string: drop URL userinfo/fragment; truncate to ≤200 characters; optional per-rule `redactSensitiveInLogs` (default off — absent or false; editor checkbox **Redact sensitive fields in logs** on all rule cards including body) applies a deny-list to query values, sensitive header values, and intended body rewrite text when true. A user **Match logging** toggle (`rogatio.matchLogging.enabled`, default **on** when the key is missing) in the popup action row and management sidebar controls injection; only boolean `false` or non-boolean garbage disables. Fail-closed silent no-ops apply for toggle off, missing APIs, `tabId === -1`, unknown or malformed index entry, rejected injection after retries, missing body markers / strip path, or the mock allow-guard id. For `main_frame` matches (redirect, query, main_frame headers, and mock redirects), a failed first `executeScript` is retried a few times with short delays so logging survives the navigation race that clears or blocks the first inject; other resource types remain single-shot. Injection targets the event tab only (no `allFrames`); iframe/subframe matches log only when Chrome supplies a real tab id and injection into that tab succeeds. A real-Chromium probe confirmed MV3 service-worker wake on smoke-origin navigation after CDP worker stop (no keepalive added). The extension does not add network, runtime, native messaging, proxy, TLS, telemetry, or traffic persistence behavior beyond the session marker / strip path described above.

Storage is a single versioned envelope (`version`, a project record keyed by stable id, and `activeProjectId`) persisted through a `StorageAdapter` whose `compareAndSwap` is the atomicity authority. Match logging adds two additional `chrome.storage.local` keys outside the envelope: `rogatio.matchLogging.enabled` (popup and management read/write; service worker read) and `rogatio.matchLogging.index` (service worker write/read only; bounded log-intent duplicate of installed action fields, not event URLs; also the sole durable `numericId → compiler ruleId` map for install identity after SW restart — ADR 0008). `createStorageAdapter` continues to read and write only the `rogatio` key. Reads defensively snapshot raw storage and validate envelope structure; unknown versions, structural violations, cycles, symbols, accessors, and proxies fail closed with `core.storage-corrupt` and no writes. Project data is fully validated through the schema/compiler boundary at write time. Repository operations are read-modify-compare-and-swap: non-explicit operations retry on transient CAS failure, while editor-style saves and strict imports carry an expected revision and return a `conflict` result preserving the committed project for an explicit refresh path.

The repository maintains the documented product invariants: at most 64 uniquely named projects, exactly one active project whenever any exist (the first created/imported project activates; removing the active project activates the most recently updated remaining project, tie-broken by id), creation/import/update and browser save reset group enablement to all-disabled. Switching restores the destination project's saved enablement without touching runtime state.

Rule statuses derive from compiled operations, saved enablement, and the installed rule ids reported by the installer adapter: disabled groups are `disabled`, enabled rules missing from the installed set are `error` with `core.rule-not-installed`, and installed DNR rules are `active`. When a DNR add fails, Workspace overlays that error with `extension.dnr-error` and Chrome’s reason (`params.reason`) for redirect, query, and header rules. Attention for this class points at the rule error card; it does not tell the user to re-activate the group or restart the native runtime. The extension maps enabled request-body and response-body rules to `needs runtime` until the unified native runtime phase is `started`. A request-body URL regex that does not name one literal host stays `needs runtime` with `runtime.pac-unroutable`. A response-body rule is matched by its URL regex in the browser and is not a PAC route. An unavailable native adapter maps those body rules to `unsupported`. The `unsupported` status also applies to matcher-only (`kind: matcher`) rules that have no browser action defined. The badge is a pure function of statuses: the active rule count plus an attention flag. `InstallService` atomically replaces the installed set through the `RuleInstallerAdapter`, treats identical sets as a no-op, rolls back to the previous set on failure with `core.install-failed` / `core.recovery-failed`, and serializes concurrent applies. Mock rules are removed; body rules (`request-body`, `response-body`) rely on the unified native runtime. Native runtime phases (`stopped`/`starting`/`started`/`failed`) are modeled in memory with a guarded transition table; runtime state is not persisted until the runtime slices define their semantics.

## Extension Toolbar Popup

The extension adds a compact Chrome toolbar popup (`popup.html` + `popup.ts`) as `action.default_popup`, sitting in front of the existing management page (`index.html`, which remains tab-opened). The popup reads the same `get-state` envelope the management page uses and lists only the active project's persisted groups in source order, each row showing the group name, rule count, a separate status indicator, a prominent Enable or Disable button, and a pencil control. There is no editor, search, proxy, permission, or rule-authoring surface in the popup, and no extension-wide or project-wide master toggle.

The popup reuses the existing `set-group-enabled` lifecycle unchanged: toggling a group sends the same command the management page sends, and the service worker performs the identical enablement and DNR-install path. Per-group status is aggregated from the envelope's per-rule `ruleStatuses` with the precedence `error > needs runtime > needs root directory > unsupported > active` (a disabled group is `disabled`; an enabled group with no rules is `active`). Because the popup reads only persisted state, unsaved editor drafts never appear, so every listed group is runtime-eligible and gets a toggle. "Open app" opens `index.html` (Overview); the pencil opens `index.html?group=<id>`, and the management page deep-links to that group via the additive `EditorController.navigateToGroup`. The popup adds no second editor and no popup-only persisted navigation state.

Since F25 the popup also carries two project entry actions, a **Match logging** checkbox (same storage key and default-on semantics as the management sidebar), and a comfortable fixed width. **New project** expands an inline name form (no `window.prompt`, which is unavailable inside action popups) and sends the existing `create-project` command; **Import project** opens a file picker with no extension filter, parses the selected file locally, and sends a valid project through the existing `import-project` command. A file that is not a Rogatio project is rejected in the popup with `not a Rogatio project: <reason>` before that command is sent. Both actions reuse the same service-worker lifecycle the management page uses — the popup never grants permissions and never enables groups on its own during create or import. The repository still validates on import and fails closed. A `role="status"` line reports the outcome. The popup body is a fixed 420px wide so rows stay readable, and the group list scrolls internally (bounded under Chrome's 600px popup height cap) when a project holds many groups. See `docs/specs/f25-popup-project-actions.md`.

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

The editor rail stays a sticky top bar (`data-desktop-route-rail`) at every width. It is a two-link breadcrumb: the draft project name opens the project page, and the open group name (or `Groups`) opens a group picker. Search stays on that bar. Test console sits on the command bar. The compact mobile route select is gone. The project page still lists groups in place. The extension Workspace has no second breadcrumb and no bar under the header. The management page keeps the top bar in place and scrolls the workspace layout beneath it, so the rail stays visible under that bar. Cards, fieldsets, rule cards, test-result cards,
badges (pills in JetBrains Mono), buttons (primary/secondary/inverted/outlined/
danger/ghost), search, alerts, and dialogs follow the token system. The extension management page uses a top app bar (brand and Dashboard/Workspace tabs). Workspace has no header breadcrumb and no subheader. Refresh, Export project, and Remove project render inside Project details when the extension supplies `EditorOptions.projectActions`; the CLI omits that port. The extension mounts the device-local mock files folder in that same fieldset through `EditorOptions.mountProjectDetails`. Choose folder asks the native host to open a system directory dialog and return an absolute path. A pasted relative path is rejected on the field. The CLI editor still prompts for the path. A Workspace-only sidebar follows. The sidebar is a set of labelled status cards rather than a flat list: an inert active-project card, then **Runtime** (Start/Stop, the runtime status line, the extension ID with its copy button, and Show diagnostics plus the runtime error only when the phase is `failed` or `unsupported`), **AI** (a status line — `AI: Configured` with the host-reported provider URL and model lines, `AI: Not configured`, `AI: not reported` against an older host that does not answer the `ai.status` envelope, or `AI: needs runtime` — and never the API key), and **Rules** (the Active rules label, one entry per rule, then the Match logging switch). Each card heading carries a status dot driven by one `data-tone` attribute, so state is legible before controls. The project card deliberately does not use the interactive dashboard card class, because naming the active project is not an action. In the Rules card a rule row is a link carrying the rule's identity plus a sibling status token; the token is named by `aria-describedby` so a screen reader does not announce a rule with no state. The identity is the group name and rule name resolved from the **committed** active project — never from the editor's unsaved draft, so an unsaved rename cannot make the sidebar disagree with what is installed. A status whose rule is no longer in the project falls back to `groupId/ruleId`, and when two rows in the same list would render identical text the later row carries its rule ID, so the list is never ambiguous. Dashboard owns the project-cards home, the full-width project creation section, the full-width existing-project section, and the Create New Project, Import Project, and Create using AI entry tiles; project selection and explicit switching stay on Dashboard, while Workspace controls always target the committed active project. The open group's heading shows a prominent Enable or Disable button when the host passes `EditorOptions.groupEnablement`; the CLI editor omits that port, so it shows no button. Group enablement still uses `set-group-enabled`, and enablement refresh never remounts the editor, so a dirty draft and the open group route both stay put while the heading button, sidebar, badge, and status update. A rule row is a real deep link, `?group=<groupId>&rule=<ruleId>`, extending the existing `?group=` convention that the popup already uses. The IDs stay in the URL because a deep link must survive a rename; they are simply not shown. One resolver serves initial load, browser Back and Forward, and in-page activation, so the product has a single navigation mechanism; on the Workspace path it replaces only the sidebar, because `renderShell()` is the sole function permitted to destroy a mounted draft. The editor owns its element identity: `ruleAnchorId` is exported from `@rogatio/editor` and joins the group and rule ids with an encoded segment around a `:` separator, because a plain `-` join maps group `a-b` with rule `c` and group `a` with rule `b-c` onto the same element id. Only the first mount reveals a rule; a later rebuild takes the route from the URL without re-running the reveal, so a rebuild never yanks the viewport back to a rule the user has moved away from. Both rebuild paths capture and restore focus, because the sidebar is rebuilt wholesale and focus would otherwise fall to `<body>`. The Overview keeps the existing explicit-switch invariant and every `data-*` attribute, role, label, and command name asserted by browser tests. The popup is restyled as a dark card and uses the "Rogatio" brand. All
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

The initial value must be a defensive JSON snapshot of a structurally parseable project. Hostile or unreadable values (accessors, cycles, sparse arrays, symbols) still fail closed with `EditorInitializationError` and never partially mount. Host-validator failures on an otherwise parseable draft (for example a CLI bootstrap project with an empty name) mount the editor and surface those diagnostics so the user can repair them in place rather than seeing a blank page. Two repair routes cover the fields the editor no longer renders: a diagnostic on a group or rule name opens that entity's inline rename input, focused and carrying the error, and it repairs a name that is **absent** as well as one that is empty, because a missing required property is exactly the case a `required` diagnostic describes. A diagnostic on an ID is repaired by the program through the error summary's "Assign a new ID" action, which assigns a derived, collision-free ID and re-validates. A `required` validation issue reports the path of the **missing property** rather than of its parent, reconstructed once in the schema's Ajv funnel, so a group missing `name` is reported at `/groups/0/name` and the editor can point at it.

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

The common schema fields remain the editor's complete data surface, but not all of them are editable: the editor renders project name and description, source condition (`key`/`operator`/`value`), resource types, priority, and optional method as fields, and renders each group and rule name on its own heading with an inline rename control. Group and rule IDs are internal model values: the editor never renders a control for one, and a project keeps the ids it was loaded with. Existing source spellings and array order are preserved unless the user edits them; Compiler normalization is not written back by the editor. New IDs are derived from the entity's name at the moment the ID is minted — added, copied, or repaired — by lower-casing the name, splitting on runs of non-alphanumeric characters, capitalizing each token and joining, with an incrementing integer appended on collision and a `Group`/`Rule` fallback when the name yields no tokens. The derivation is a minting convention, not a validation rule: the schema still accepts any ID matching its own pattern, so a hand-authored project keeps `group-one` or `rule-one` unchanged. **IDs are frozen at creation.** A rename changes the name and never the ID, which is what keeps a rename from churning a Chrome DNR rule ID, a `?group=`/`?rule=` deep link, or a group's enablement target. The editor's own default names are placeholders, so an entity created as `New rule` keeps the ID `NewRule` after being renamed; copied and AI-created entities are minted from a final name and read cleanly. Array order is source order and is never inferred from priority.

Draft transitions are explicit:

- An edit increments the draft revision, leaves the committed snapshot unchanged, marks the editor dirty, and clears stale validation errors.
- Validate checks the current detached draft and renders sorted stable diagnostics without saving.
- Save validates first, captures the current revision and snapshot, and disables conflicting mutations while the host operation is pending. A success commits only when the captured revision is still current. A failure retains the exact draft and dirty state for retry. A late result after destroy is ignored.
- Cancel requires an accessible confirmation when dirty, restores the committed snapshot, clears errors, and then calls the optional host callback. Cancel is disabled while a save is pending rather than racing a host write.
- Destroy removes only editor-owned DOM and listeners and performs no save or cancel callback.

### View and Navigation

The view uses a semantic `main`, `nav`, `form`, headings, `fieldset`/`legend`, native inputs/selects/checkboxes, and a live status region. The route rail is a breadcrumb: the project name, then the open group or `Groups`. The group link opens a dialog that lists each group's name, rule count, and Enabled or Disabled when `groupEnablement` is present and the group has a saved id. Choosing a row opens that group. Escape, Close, and the backdrop dismiss the dialog. Test console is a command-bar control, not a rail route. Routes are internal editor state, not browser history or host persistence. Removing the current group falls back to Project and announces the change.

The contextual command bar keeps project actions together: AI Assist (when configured), Test console, and Validate lead, and Cancel and Save trail. Run test is a single control on the Test console panel. On a group page the heading keeps the name and rename control together, and groups Enable/Disable, Copy group, and Remove group in one toolbar, with Remove set apart as the destructive action. Add rule stays on the Rules heading. Add group stays on the Groups heading of the Project page. That page lists each group by name; choosing the name opens the group, and Copy group and Remove group stay on the row. Group and project actions repeat in a labeled ledger under the last rule (Rules, then Group, then Project) and under the test results on Test console. The Project page has no ledger. The ledger does not repeat Run test.

The Test console checks the current draft against a list of URLs. Its opening copy is “Check whether these URLs match your rules. Nothing is contacted, and nothing is saved.” A case defaults to GET and a page load (`main_frame`), and the form says “Checking these as page loads (GET).” Resource types use plain names (Page, Script, Fetch, and the rest); schema values stay on the option values. “Any method” and “Any resource type” are explicit choices, and a match under either choice says that constraint was not tested. The host supplies `dryRun`. The editor package does not import `@rogatio/dry-run` or Ajv. A result is one sentence per matching rule under an open “1 rule matched”/“N rules matched” disclosure, naming the group and the rule, plus the same action preview `rogatio test` prints (`previewRuleAction`). The rule name opens that rule. Non-matching rules stay in a closed disclosure (“1 rule did not match” or “N rules did not match”), each with one reason: URL pattern, method, or resource type. The matched disclosure is marked with a green check and the unmatched one with a red cross. When the host supplies `groupEnablement` and that group is off, the match still shows and adds “This group is off in Chrome, so the browser will not apply this rule.” The CLI editor omits that port. A failure with field diagnostics — including a non-2xx body from `POST /api/dry-run` — is listed and focused like Validate. It is not stored as the test result, so a later render still works. The 256-case cap is mentioned only when the list is too long (“Only 256 URLs can be checked at once.”). An exact URL source offers “Try a URL from this rule”, which fills the box. A project with no rules says “This project has no rules to test.” Rule reorder, copy, and remove stay on each rule. A group or rule name is authored in exactly one place, on its own heading, through an inline rename control: a pencil opens a text input, the save control or `Enter` commits, the cancel control or `Escape` reverts, and the value is written to the draft only on an explicit commit. The heading element stays in the document while the input is open — visually hidden — so a rule card keeps its accessible name through `aria-labelledby` and its shared action buttons keep their per-entity context. A commit is refused, leaving the input open and focused, when the trimmed value is empty, exceeds the label bound, or duplicates another name in the project; the message names the entity that holds the name. `Enter` inside that input never saves the project, and a name diagnostic at an entity's `/name` path (or at the entity itself) opens the input focused with the error associated. Because IDs are no longer editable, a diagnostic on one is repaired by the program through an explicit "Assign a new ID" action in the error summary, which keeps the documented in-place-repair guarantee without putting a field back on the page. Group reorder is not exposed because groups are chosen from the picker. Remove actions use a cancellable accessible alert dialog and name the affected group or rule. Rule reorder commands operate on the item's absolute source position even when search is active; announcements include the resulting position so hidden neighboring items cannot make the operation ambiguous.
When `EditorOptions.aiAssist` is provided, the command bar and the repeated-actions ledger show **AI Assist**. The shared panel builds an `AIAssistRequest` (`generate` or `fix` from current diagnostics), invokes the host handler (async iterable chunks or a complete response), streams tokens into the panel when the host yields them, and Apply maps each `RuleProposal.kind` onto draft `type` plus the matching payload fields (`redirect`, `action`, header siblings, `responseBody`, `requestBody`). For `fix` requests, proposal rules repair the offending rules in place: the rules referenced by `context.diagnostics` are replaced (keeping their rule ids and positions) instead of appended, and the hosts validate the repaired project before accepting the proposal (the extension service worker returns `extension.ai-invalid-proposal` when the repair leaves the project invalid). The editor does not call providers itself. Hosts wire `aiAssist`: CLI `rogatio edit` posts to `/api/ai/assist`; the extension Workspace sends the `ai-assist` command through the service worker to the native host (`ai.complete`).

Command and entity buttons use tone tokens (`data-btn`: primary / secondary / danger). Rule cards use a raised surface with a teal signal edge so they read as distinct interception units against cooler group fieldsets.

Search is project-wide, literal, case-insensitive, and NFKC-normalized for matching only. It searches common project, group, and rule fields, reports deterministic source-order results, and navigates to the selected group or field without changing project data. It never treats user text as a regular expression. Search updates are region-level updates rather than full document replacement on every keystroke.

### Validation and Extension Boundary

The host validation adapter returns compiler-compatible stable diagnostics with an error code, JSON-pointer path, and safe message. The editor sorts them deterministically, maps current paths to stable entity identities and controls, renders a summary with links, sets `aria-invalid`, and associates each error with its field. The editor never exposes raw Ajv wording or rejected input values. Extension diagnostics use the same path contract. A validator throw becomes a generic editor validation error and never permits saving.

The rule-type extension point ships built-in registrations in `packages/editor/src/rule-types/index.ts` (`builtInRuleTypes`): **Header** (`createHeaderRuleType`, sibling `headerDirection`/`headerOperation`/`headerName`/`headerValue` fields via optional `defaultFields`), **Redirect** (`createRedirectRuleType`, nested `redirect.destination` via `defaultAction` + `actionField: "redirect"`), **Query parameters**, **Response body**, **Request body**, and **Mock response** (`createMockRuleType`, nested `mock` via `defaultAction` + `actionField: "mock"`). Hosts may pass `ruleTypes` to replace a built-in by id; duplicates within the host list fail closed. Each extension has a stable ID and label, a pure matcher, synchronous mount/cleanup, controlled field access, control registration, and synchronous validation. Selecting a type initializes payload through `defaultAction` (single nested field) or `defaultFields` (sibling keys); `setRuleType` requires one of those hooks. Type switches clear stale payload keys listed in `ACTION_FIELDS` (redirect/action/body/header siblings). It receives defensive snapshots and can set only extension-owned fields through a controlled store; it never receives the live project or common-field mutators. Duplicate registrations, multiple matches, callback throws, cyclic values, malformed values, and unregistered controls fail closed with stable editor diagnostics. Unknown action data is not silently discarded or passed through: it is saveable only when a future extension and its host validator explicitly own it.

### URL Conversion

The common editor exposes `urlToExactRegex` as a pure utility. It accepts an absolute HTTP(S) URL with no surrounding whitespace, controls, credentials, or fragment. WHATWG URL serialization supplies deterministic normalization for scheme, hostname, default ports, empty paths, and percent encoding while preserving query order and duplicates. The serialized URL is escaped as a literal and wrapped in `^` and `$`; no flags, wildcard, capture, or matching execution is added. Conversion fails without changing the rule when the URL is malformed or the generated source exceeds the schema regex limit. Fragments are rejected because browser request targets do not include them.

### Accessibility, Security, and Build Constraints

All user-controlled values are inserted as text or DOM properties, never as HTML. The editor does not evaluate user regular expressions or JavaScript, contact a network, access a filesystem, request permissions, use storage, emit telemetry, or invoke runtime/browser-core APIs. The schema and compiler packages remain responsible for authoritative bounds and validation. Defensive snapshots reject accessors, proxies, inherited/sparse properties, symbols, cycles, and unsupported non-JSON objects without invoking hostile getters.

The view must remain keyboard complete without drag-and-drop or pointer-only commands. Error controls use stable generated IDs, labels, descriptions, focus restoration, and live announcements. Focus indicators and state must remain visible in forced colors; the layout must reflow at narrow widths and 200% zoom without clipping or requiring horizontal scrolling for core controls. CSS uses native/system colors in forced-colors mode and respects reduced-motion preferences.

The editor browser artifact must contain no `node:` imports, Node globals, filesystem code, or runtime-compiled schema/compiler imports. Build and browser checks must import the shipped browser artifact, not only source or a test double. Pure state/conversion tests belong in Vitest; controller/DOM interaction, keyboard, error association, responsive, forced-colors, zoom, and browser-package checks belong in Selenium browser journeys. No DOM emulation dependency is introduced solely for the editor package.

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

`@rogatio/runtime` gains the macOS native-messaging control, lifecycle, revalidation, envelope, and interception-gate modules. `@rogatio/cli` gains a real `rogatio runtime` command (`activate` / `deactivate` / `status` / `--help`; the native-messaging host runs as the `host` subcommand). The schema package remains authoritative for the project shape and origins; the compiler remains authoritative for matcher operations used in revalidation. The macOS runtime does not add response-body, request-body-trust, or request-body rule behavior, only the runtime those slices depend on.

Four owned layers:

- **Lifecycle controller:** explicit `activate` / `deactivate` / `status` with guarded states `stopped → starting → started → stopping → stopped`, idempotent `deactivate()`, and a capability-based activation gate that reports `unsupported` only when a trusted device-local CA cannot be provisioned or Chrome PAC routing would collide with an existing controlling proxy/PAC/extension/enterprise policy.
- **Revalidation core:** `revalidateAuthority(context)` independently re-derives authority from the validated schema project and compiled compiler operation for an incoming request. It does not trust browser host access or any client-supplied grant flag; the AND of rule existence, **source condition** match (`sourceMatches` on URL or host key), method match, resource-type match, initiator scope, and same-origin constraints must all hold before any body work.
- **Control envelope:** a versioned `f14-v1` JSON channel (`start`, `stop`, `status`, `authorize`, `transform-request-meta`, `transform-response-meta`) carrying metadata only. Bodies never cross the envelope; a structural test proves it.
- **Interception gate (capability-based):** scoped Chrome PAC generation as a deterministic pure function, plus an ephemeral TLS proxy / device-local CA module reachable only after a successful capability-based activation. When the required capabilities are absent, it returns `runtime.unsupported` and performs no socket or certificate work, regardless of OS.

### Authority boundary

Install-time host access is not a security boundary. Every transformation request is re-checked against the canonical `.rogatio.json` and compiled operation: the rule must exist, its source condition must match the request URL (or host for host-key rules), the method must match when the rule specifies one, the resource type must be allowed, and initiator/target same-origin policy must hold. A denied request triggers no interception and no body oracle. Revalidation completes before any body work, is deterministic, and never trusts a client-supplied authorization boolean.

### Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging envelope carries bounded metadata and transform instructions, never body bytes, credentials, sensitive header values, or file contents. A diagnostic sink, if present, receives only redacted lifecycle/counter events.

### Alternatives rejected

- Trusting the browser grant as authority is rejected; revalidation re-derives from the canonical project.
- A general forward proxy is rejected. Response-body rules are not PAC routes: the browser matches the rule's URL regex and redirects to the loopback listener, which rechecks the preset digest, rule id, and the same regex, then performs a credential-free GET. Request-body rules never become DNR rules. PAC steers only `scheme://literal-host/*` from a URL regex that starts like `^https://api.example.com/` (escaped dots, a slash after the host, no top-level `|`); the path stays a regex checked by the runtime. Host-key request-body rules compare the PAC `host`. The script contains no `RegExp`. A URL regex that does not name one literal host stays `DIRECT`.
- Persisting interception, capability, or traffic state is rejected; the macOS runtime keeps no history.
- Live TLS interception and CA trust installation require a platform where a trusted device-local CA can be provisioned and Chrome PAC routing does not collide with an existing controlling proxy/PAC/enterprise policy. macOS is the reference supported platform; Linux/Windows may also activate when those capabilities are present. CA trust installation requires elevated privileges on all platforms: Linux writes the CA with argv-only `sudo tee` (PEM on standard input, stdout discarded) into `/usr/local/share/ca-certificates/` and then runs argv-only `sudo update-ca-certificates`, macOS prompts for keychain authorization, and Windows requires Administrator for `certutil -addstore Root`. The macOS runtime ships the capability-gated module and deterministic PAC generation; the live interception is completed by the response-body and request-body rules where the capabilities exist.

The complete proposed contract and acceptance criteria are in `docs/specs/f14-macos-runtime.md`; the staged workflow record is in `docs/f14-workflow.md`.

## Request-Body Trust Lifecycle

The **request-body trust lifecycle** that request-body interception (the request-body rules) requires before any network interception can happen: it manages the native-messaging host registration and the device-local CA trust that the macOS runtime's interception gate depends on. It is a distinct concern from the macOS runtime's `start`/`stop`/`status` (which govern a running runtime *process*); the request-body trust lifecycle governs the *installed/trusted* standing of the host on the device. It depends only on the macOS runtime (REP-001) and adds no response-body or request-body rule behavior, only the trust surface those slices pre-condition.

### Ownership and data flow

`@rogatio/runtime` gains a `trust` module with a `createRequestBodyTrustController` controller and pure helper functions. `@rogatio/cli` extends `rogatio runtime` with `install | uninstall | verify`. Three owned controller operations:

- **install:** register the native-messaging host and provision the device-local CA in a single, **fully transactional** call. Writes the native-messaging host manifest (`com.rogatio.runtime.json`) into the platform's Chrome native-messaging manifest directory, pointing at the installed runtime host; then, capability-gated, generates the device-local CA key + certificate (reusing an existing pair only when the certificate is a CA and the key file is a regular mode `0600` file, owned by the current user, that can sign as that certificate's private key), writes them under the install root with the private key mode `0600`, and invokes the platform-native `caTrustInstaller` to record the CA in the OS trust store. When that install replaces an older certificate, macOS removes the previous anchor with argv-only `security delete-certificate -Z <sha1>` and Windows removes it with argv-only `certutil -delstore Root <sha1>`. Failure to remove the previous anchor is reported and does not fail the install. Linux replaces the certificate file and rebuilds the bundle. There is no partial-success state: when the manifest capability or the CA-trust capability is missing, or when the OS trust installer fails, the manifest and the CA files are rolled back and the call returns `unsupported`. The CLI prints `trust unsupported: <reasons>` with a per-reason remediation hint and **exits 1**; the user re-runs with elevated privileges. On success it returns `installed` and the CLI prints `runtime install complete: manifest + device-local CA trusted + runtime-host wrapper created` and exits 0. Idempotent across repeated calls with the same extension ID. Install uses the release extension ID derived from the public `key` in the extension manifest. `--extension-id` is only for development (a local unpacked build without the release key) and for forks. Release users never need it. CA trust needs root/admin privileges per platform: Linux `sudo`, macOS login-keychain authorization, Windows Administrator.
- **uninstall:** remove the native-messaging host manifest, the three device-local CA files (`caKeyFile`, `caPubFile`, `caCertFile`) under the install root, and the OS trust-store trust installation via the capability-provided `caTrustRemover` when present. Unconditional on capabilities and idempotent across repeated calls (no-op exit-0 once the manifest and CA are gone). Returns `runtime uninstall complete: manifest + device-local CA removed` on success. The store removal is skipped when the CA key file was already absent.
- **status:** report `{ installed, trusted, platform, capabilityReasons }` without side effects; reads the manifest (present + well-formed) and the CA trust standing. It never leaks paths, key material, or platform tooling text.

`verify` is a CLI-side administrative check over the same controller state, not a fourth controller operation: it reports manifest existence/validity, `runtime-host` wrapper presence and execute bit, `allowed_origins` (the list, not only the count), and CA trust, each with a remediation hint, and exits 0 only when all pass. When the manifest is valid and its origins do not include the release ID (or `--extension-id` when a development or forked build passed it), it exits 1 and prints that ID, the pinned origins, and the re-pin command. Release users never pass `--extension-id`. That is the CLI view of Chrome's `Access to the specified native messaging host is forbidden.` refusal. The controller still does not own the release ID; it returns the origins and the CLI compares them.

Three owned layers:

- **Manifest generation (pure):** `generateNativeMessagingManifest(hostPath, name)` returns a fixed-shape JSON `{ name, description, path, type: "stdio", allowed_origins: [...] }`, deterministic for the same inputs. The manifest carries no secrets; `path` must be absolute and confined to an expected install root before emission.
- **Capability gate:** `detectTrustCapabilities()` reports whether host-manifest install and CA trust install are possible on the current platform/config. Capability-based, not OS-name-based, mirroring the macOS runtime REQ-008: a non-macOS platform with the required tooling may still install; a macOS platform missing the tooling reports `trust.unsupported`.
- **Trust controller:** `install`/`uninstall`/`status` with explicit idempotency and a single stable error set. No telemetry, no retained state beyond the manifest file, the CA material under the install root, and the OS trust store; nothing is persisted to the project, the runtime, or disk outside the install root. The unified `install` performs the manifest capability check first and the CA-trust capability check after the manifest is written; on a CA-trust capability miss after the manifest write, the manifest is rolled back so the install either completes transactionally or writes nothing. The unified `uninstall` is unconditional on capabilities and removes the CA files before invoking `caTrustRemover`, so a `caTrustRemover` throw surfaces with the file-system side effects already applied.

### Authority and confidentiality boundary

The request-body trust lifecycle touches only device-local trust material: the manifest (which names the host) and a device-local CA. It never reads, writes, logs, or transmits request/response bodies; it does not contact upstream and does not implement the request-body-rules transformation. The CA is device-local and self-signed; its private key stays confined to the install root and is never placed on the native-messaging envelope. `status` echoes only booleans and the platform/capability reasons — never the manifest path, the host path, CA material, or third-party tooling text.

### Alternatives rejected

- Bundling host manifest + CA trust into the macOS runtime `start`: rejected because install/trust are device-level, persistent, and intentionally separate from the per-session runtime lifecycle; conflating them would force re-trust on every start.
- Persisting trust state in the project file: rejected; trust is device-local, not project state, and must not travel with `.rogatio.json`.
- Auto-install/auto-trust on lifecycle start: rejected; explicit, capability-gated user actions only, per the macOS runtime's no-auto-start stance.

The complete proposed contract and acceptance criteria are in `docs/specs/f16-request-body-trust.md`; the staged workflow record is in `docs/f16-workflow.md`.

## F23 Host Session Details (PAC and pass-through)

F23 consolidates runtime-dependent behavior behind one extension-launched native host. The host owns the internal loopback proxy and TLS interception, while native messaging carries lifecycle, policy, and metadata/control only; observed traffic bodies remain in the host-owned interception path. Start is transactional: it validates the immutable active policy, opens the host/provider, and installs exact scoped PAC routing only after collision, trust, and capability checks. Failure rolls back all Rogatio-owned state. Stop removes only owned PAC/proxy state, aborts active operations, invalidates capabilities, clears transient body buffers, and restores the prior browser proxy configuration.

The extension exposes only Start runtime and Stop runtime during normal use. The CLI has no session lifecycle subcommand; see the append-only decision record at `docs/specs/cli-activate-deactivate-removal.md` for the removal rationale. A separate Check and connect action and separate mock-connection state are not part of the target model. Response-body and request-body rules share one runtime session. Host start (after manifest install) is unconditional; request-body PAC/CA activation remains capability-gated. Non-matching or unsupported requests pass through untouched, and only the highest-priority matching request-body rule applies. The CLI remains available for one-time native-host installation, CA trust, and administrative diagnostics, but it is not required to start or operate a browser session.

The internal proxy remains narrowly scoped: exact authorized origins, bounded HTTP/1.1 request handling, strict TLS/target/address validation, no redirects or proxy recursion, and no traffic persistence. Unsupported signed, compressed, multipart, binary, or otherwise unsafe transformations do not produce a partial request; they pass through untouched where protocol-safe. See `docs/specs/f23-unified-native-host-runtime.md` and `docs/plans/f23-unified-native-host-runtime.md` for the approved requirements and implementation sequence.

## CLI Package Architecture

### Components

**1. CLI Entry Point (`src/index.ts`)**
- Command router using minimal argument parsing (no external deps)
- Subcommands: `edit`, `verify`, `test`, `doctor`, `runtime`, `ai`, `import`
- Global options: `--help`, `--version`

**2. Edit Command (`src/commands/edit.ts`)**
- HTTP server (Node `http` module) bound to `127.0.0.1:0` (OS-assigned ephemeral port, or a fixed port via `--port`)
- Static file serving for the editor page (`GET /editor.html`) and the `@rogatio/editor` browser bundle (`GET /vendor/editor.js`, `GET /vendor/editor.css`, `GET /vendor/fonts/*`)
- API endpoints:
  - `GET /api/project` → returns current project JSON
  - `POST /api/validate` → runs schema + compiler validation through `diagnoseProject`
  - `POST /api/save` → writes project to file
  - `POST /api/cancel` → shuts down server
  - `POST /api/dry-run` → offline dry-run against bounded URL cases
  - `POST /api/ai/complete` → non-streaming AI completion (local provider config)
  - `POST /api/ai/stream` → streaming AI completion (SSE)
  - `POST /api/ai/assist` → validated Assist proposal via `runAIAssist` (editor contract; uses configured model; fix requests validate the repaired project)
- Cross-platform browser launch (macOS `open`, Linux `xdg-open`, Windows `start`)
- CSRF protection via random token in HTML and validated on mutating endpoints
- Cleanup on SIGINT/SIGTERM, save, cancel, or browser close detection

**3. Verify Command (`src/commands/verify.ts`)**
- Reads `.rogatio.json` from path (default: cwd/.rogatio.json) or stdin (`-`)
- Runs the same schema and compiler checks as `import` (`diagnoseProject`)
- Outputs diagnostics:
  - Human-readable (default): plain `path: message (code)` lines
  - JSON (`--json`): structured array for scripting
- Exit codes: 0=valid, 1=invalid (diagnostics), 2=error (IO/parse)

**4. Test Command (`src/commands/test.ts`)**
- Offline dry-run via `@rogatio/dry-run` against `--urls` / `--urls-file` cases
- Validates and compiles the project through `diagnoseProject` before the dry-run
- Never contacts tested URLs, requests permission, or starts a runtime

**5. Runtime Command (`src/commands/runtime.ts`)**
- `install [--extension-id <id>]`: register native-messaging host manifest and provision/trust the device-local CA in one transactional call (rolls back and exits 1 when a required capability is missing). Uses the release extension ID pinned by the manifest public key. `--extension-id` is only for development (a local unpacked build without the release key) and for forks. Release users never need it.
- `uninstall`: remove host manifest, CA files, and trust (idempotent)
- `verify [--extension-id <id>]`: report whether manifest, `runtime-host` wrapper, allowed origins, and CA trust are all present and valid, and whether `allowed_origins` includes the release ID. Release users never pass `--extension-id`. That flag is only for development (a local unpacked build without the release key) and for forks.
- `host [path] [--root <dir>]`: stdio native-messaging host entry (browser-launched; manual use for debugging). `--root` sets the confined mock file root. When omitted, a saved device-local root for that project file wins, otherwise the project directory. Stdin projects that contain a file mock require `--root`.

**6. Import Command (`src/commands/import.ts`)**
- `import requestly <export.json> [--out <path>] [--merge] [--json]`
- Mapping lives in `@rogatio/requestly-import` (no file, network, or compiler I/O). The CLI reads the export, runs the same schema and compiler checks as `verify` (`diagnoseProject`), and writes with the atomic project writer.
- Default `--out` is `./.rogatio.json`. An existing file is left untouched unless `--merge` appends imported groups onto a valid version-2 project.
- The report lists imported, changed, and skipped Requestly rules. Skipped rules do not fail the command.

**7. Doctor Command (`src/commands/doctor.ts`)**
- `doctor [path] [--json] [--check-updates] [--extension-id <id>]` runs the six checks in `@rogatio/runtime` (`runDoctor`): Node and CLI version, project file (the same `diagnoseProjectData` sequence as `verify`), native-host manifest and `allowed_origins`, device CA (`verify().caTrusted`), a loopback PAC answer within 10000ms, and optional AI Assist reachability.
- `--check-updates` is the only npm-registry call. A configured AI provider is contacted only for the optional AI check, the same Hello completion as `rogatio ai test`. The PAC probe does not change Chrome proxy settings.
- Exit codes: `0` required checks passed (warnings allowed), `1` a required check failed, `2` usage. `--json` prints a versioned report with stable key order.
- The extension **Run checks** button sends `runtime.doctor`. The host runs the same function and returns the report, plus `cliVersion` beside it when that version is exactly `major.minor.patch`. The extension adds its own checks (service worker, native connection, extension id, versions, proxy, site access, rules, incognito, and the popup's current tab) and nests the host report under `host`. It does not import `@rogatio/runtime`. Popup and management-page bundles do not import `@rogatio/dry-run` or Ajv.

**8. AI Command (`src/commands/ai.ts`)**
- Provider configuration: `setup | ls | show | delete | test`
- Local-only OpenAI-compatible providers; keys stay on the machine
- Editor/extension surfaces: CLI Assist uses edit-server `/api/ai/assist`; extension Dashboard "Create using AI" and Workspace Assist use native messaging (`ai.complete`) when the runtime is started and configured — not the CLI loopback HTTP server. See root `README.md` for user-facing setup.
- AI provider metadata: the host answers the additive `ai.status` envelope with `{ configured, providerUrl?, model? }`, built from a pick-type so the API key never crosses the native boundary. The management page's AI capability check is metadata-only — one `ai.status` request, no completion probe, and no provider network call. An older host drops the unknown `ai.status` frame and the card reports `not reported` rather than an error; the bounded wait keeps a stale host from slowing the page. The host re-reads `provider.json` on every AI envelope (`ai.status`, `ai.complete`, `ai.stream.chunk`) and rebuilds its AI client when the content changed, so `rogatio ai setup` takes effect without a host restart and the card can never disagree with the client in force. The project schema carries no AI metadata; host config is the single source of truth.

**9. Editor Hosting (`src/server/`, `src/commands/edit.ts`)**
- `editor.html` is generated inline (`generateEditorHtml`) with embedded config (API base URL, CSRF token, file path) plus an import map
- The import map maps `@rogatio/editor` to `/vendor/editor.js`, served by the CLI's own HTTP server
- The `@rogatio/editor` browser bundle is resolved at runtime via `import.meta.resolve("@rogatio/editor")` and streamed from disk on `GET /vendor/editor.js` — no separate CLI browser build target is required
- Editor instantiates via `createEditor(root, options)` with HTTP-based callbacks (`validate`, `save`, `onCancel`)
- `POST /api/doctor` is CSRF-protected. It runs `runInstalledDoctor` for the open file with `checkUpdates: false` and returns that report nested under `host`, plus editor checks for the server, the session, the draft, AI Assist, and an optional mock file root. The extension Workspace editor does not call this route.

**10. Utilities (`src/utils/`)**
- `project-storage.ts`: CLI-owned `ProjectStorage` port (`list` / `get` / `create` / `import` / `update` / `delete`) plus the JSON-file adapter (`createJsonFileProjectStorage`). Path-as-id; atomic write (pretty JSON, mkdir, temp + rename). `list` keeps `.rogatio.json` and `*.rogatio.json` as the fast path and also includes other `*.json` files whose contents validate as a Rogatio project (own numeric `version` of 1 or 2, then schema validation, migrating version 1 first). Non-project JSON such as `package.json` is skipped. `edit`, `verify`, and `test` accept an explicit path of any filename and default to `./.rogatio.json`. Production `edit` / `verify` / `test` / `doctor` / `runtime` / `import` and save use the port for file-backed I/O. This surface is separate from browser-core `ProjectRepository` / `StorageAdapter` (envelope store); the two are not unified.
- `file.ts`: thin façade re-exporting the port/adapter and retaining compat `readProject` / `writeProject` wrappers for tests.
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
- CSRF token required for mutating endpoints (`/api/save`, `/api/cancel`, `/api/dry-run`, `/api/doctor`, `/api/ai/complete`, `/api/ai/stream`, `/api/ai/assist`)
- No authentication (local-only, short-lived)
- File access confined to target `.rogatio.json` path
- AI routes use the locally configured provider only; they do not introduce Rogatio-hosted inference
- No other network requests except browser launch and optional AI provider calls the user configured

### Error Handling
- Schema validation errors → structured diagnostics
- Compiler diagnostics → included in verify output
- IO errors → exit code 2 with stderr message
- Browser launch failure → prints the editor URL and the server keeps running; an unsupported platform raises `BrowserLaunchError`
- Port conflict → no retry. A fixed `--port` that cannot be bound fails with exit 2; the default path asks the OS for an ephemeral port (port 0) because random high ports can land on WHATWG/undici blocked ports that `fetch()` rejects

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

The offline dry-run package adds a pure-offline, bounded URL-batch dry-run capability that evaluates compiled operations against a list of test cases without contacting the network, requesting permissions, changing installed rules, connecting to runtime, or saving test data. It is usable from the CLI (`rogatio test`), the CLI editor (`POST /api/dry-run`), and the extension management page (service worker command `dry-run`). The editor package receives the result through `EditorDryRunHandler` and does not import this package.

### Components

**1. Dry-Run Package (`@rogatio/dry-run`)**

- **`src/types.ts`** — Type definitions: `DryRunTestCase`, `DryRunResult`, `MatchDimension` (state + detail), `RuleMatchResult`, `UrlDryRunResult`, `DryRunError`, `DryRunSummary`, `DryRunOptions` (maxCases, previewAction), `PreviewActionFn`.
- **`src/url.ts`** — `parseTestUrl(input: unknown)`: WHATWG URL parsing, rejects non-string, empty, non-absolute, non-http(s); no network.
- **`src/errors.ts`** — Stable `DryRunError` constructors: `invalidCase`, `invalidUrl`, `invalidOptions`, `batchLimit`.
- **`src/input.ts`** — Untrusted case/option guards: `validateCase`, `normalizeOptions`, `readCaseBatch`; rejects proxies, accessors, symbols, cycles, sparse arrays without invoking getters; `maxCases` default 256; exceeding returns `dryrun.batch-limit`.
- **`src/evaluate.ts`** — Per-rule three-dimension evaluation: `sourceDimension`, `methodDimension`, `resourceTypeDimension`, `evaluateRule`, `safePreview`. Source matching via `sourceMatches` from `@rogatio/compiler`.
- **`src/dryrun.ts`** — `dryRunProject(operations, cases, options?)`: orchestration only (normalize options, read batch, parse URLs, evaluate rules, aggregate summary):
  - Three matching dimensions per rule:
    - `source`: `sourceMatches(matcher.source, fullUrl)` → matched/unmatched.
    - `method`: not-applicable if test case omits; matched if rule.method undefined or equal; else unmatched.
    - `resourceType`: not-applicable if test case omits; matched if rule.resourceTypes empty or includes; else unmatched.
  - Overall `matched = source && method!=='unmatched' && rt!=='unmatched'`.
  - `actionPreview` via `options.previewAction` (try/catch, null when absent).
  - Summary: `caseCount`, `urlCount`, `matchedUrlCount`, `matchedRuleTotal`.
  - Never fetches, writes FS, or contacts runtime.

**2. CLI Command (`rogatio test`)**

- Arguments: `[path]` (any filename; default `.rogatio.json`, `-` for stdin).
- Options: `--urls` (comma-separated), `--urls-file` (JSON array path or `-`), `--method`, `--resource-type`, `--max-cases`, `--json`.
- Reads project, runs schema + compiler validation, then dry-run.
- Exit codes: 0=success, 1=validation/compile/test errors, 2=usage error.
- Output: human-readable (per-URL per-rule with badges) or JSON.

**3. Server Endpoint (`POST /api/dry-run`)**

- CSRF protected (`x-csrf-token`).
- Body: `{ project, cases, options? }`.
- Server-side schema validation, then `compileProject`.
- `dryRunProject` receives `compileResult.operations` and `{ previewAction: previewRuleAction }`. A client `options.previewAction` is ignored. A positive integer `options.maxCases` is honored.
- Returns `DryRunResult` (200) or `{ code, message, diagnostics }` (400) or a CSRF error (403).
- The editor page treats a non-2xx body as `{ ok: false, diagnostics }` and does not store it as the test result.

**4. Extension command (`dry-run`)**

- Protocol: `{ version: 1, command: "dry-run", project, cases, options? }`.
- The service worker validates with `browser-schema`, compiles, and calls `dryRunProject` with `previewRuleAction`. It does not read storage or install rules.
- Success: `{ ok: true, value: DryRunResult }`. Schema or compiler failure: `{ ok: false, diagnostics }` with the field shape Validate already returns, plus `extension.project-invalid` on the envelope.
- The management page passes `dryRun` into `createEditor`. That page bundle does not import `@rogatio/dry-run` or Ajv. The service worker bundle aliases `@rogatio/dry-run` to its source so the schema alias stays `browser-schema`.

**5. Editor Integration**

- **`types.ts`**: Local DryRun type definitions (no `@rogatio/dry-run` import in the browser bundle), `EditorDryRunHandler` (result or `{ ok: false, diagnostics }`), on `EditorOptions`.
- **`editor.ts`**: `route.kind === "test"` with:
  - Command-bar control "Test console" (accessible, announced).
  - Panel: one URL per line, method default GET, resource type default Page (`main_frame`), one Run test control. The 256-case cap has no field.
  - Results: one sentence per matching rule (group, rule, and the `previewRuleAction` summary). Misses stay in a closed disclosure. The rule name opens that rule. A disabled group, when `groupEnablement` is supplied, adds “This group is off in Chrome, so the browser will not apply this rule.”
  - Keyboard complete, screen-reader announcements, forced-colors and 200% zoom compatible (CSS variables, native elements, live regions).
### Data Flow

```
rogatio test / POST /api/dry-run / extension dry-run
     │
     ▼
┌──────────────────────┐
│ validate + compile   │ → compiled operations
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ dryRunProject        │
│ previewRuleAction    │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ CLI human or --json  │
│ Editor sentences     │
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

- Unit tests for `parseTestUrl`, `dryRunProject` (including a golden full-result pin), plus direct `input` (`validateCase`, `normalizeOptions`, `readCaseBatch`) and `evaluate` (per-dimension detail strings, throwing `previewAction`) unit tests.
- CLI integration tests (exit codes, JSON output, stdin/file inputs).
- Server endpoint tests (200/403/400).
- Editor panel accessibility tests (keyboard, SR, forced-colors, 200% zoom via Selenium).

### Dependencies

```
@rogatio/schema ──► @rogatio/compiler ──► @rogatio/dry-run
                                               │
                                               ▼
                                    @rogatio/cli
                                    @rogatio/extension (service worker)
```

`@rogatio/editor` stays on `schema → compiler` and receives a `DryRunResult` through the host `dryRun` port.

### Acceptance Criteria Coverage

| AC | Description | Test |
|----|-------------|------|
| AC-001 | Simple match | `dryrun.test.ts` |
| AC-002 | Three dimensions with states | `dryrun.test.ts` |
| AC-003 | Invalid case → dryrun.invalid-case | `dryrun.test.ts` |
| AC-004 | Invalid URL → dryrun.invalid-url | `dryrun.test.ts` |
| AC-005 | Default maxCases 256 | `dryrun.test.ts` |
| AC-006 | Configurable maxCases | `dryrun.test.ts` |
| AC-007 | Summary counts | `dryrun.test.ts` |
| AC-008 | previewAction seam | `dryrun.test.ts` |

### Open Questions Resolved

- **Option A approved** — `previewAction` is `previewRuleAction` in `@rogatio/dry-run`. `rogatio test`, `POST /api/dry-run`, and the extension `dry-run` command all pass it. Redirect, query, header, and replace-mode body summaries are included. `rogatio test --json` is unchanged.
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
  {regexFilter, resourceTypes, requestDomains? } }` where `regexFilter` comes from the
  rule's source condition (`url` key → regex only; `host` key → pinned hostname regex plus
  `requestDomains` for the literal host). Broad install-time host access covers matching;
  DNR conditions still reflect the authored source shape.
  `createDnrInstaller(api)` implements `RuleInstallerAdapter` tracking installed redirect,
  query, and header operations in a Map keyed by DNR rule id; `current()` reads back via
  `chrome.declarativeNetRequest.getDynamicRules()`; `install(ops)` replaces both Rogatio
  bands from the full desired set (remove = live ids ∩ owned bands; fail closed if the
  live set is unreadable — ADR 0009). Callers must pass every desired redirect/query/header
  op; a subset wipes the omitted band. Guarded for missing `declarativeNetRequest`.
- `extension/src/chrome.ts`: `ChromeApi.declarativeNetRequest` made optional (`?`) to
  preserve test fixture compatibility.
- `extension/src/background.ts`: wires real `createDnrInstaller(api)` replacing stub.
- `extension/src/service-worker.ts`: `operationStatuses` maps installed redirect ops to
  `active`; actionless matchers are always `unsupported` regardless of install state.
  `projectState` hydrates cold installer memory from Chrome live ids ∩ `rogatio.matchLogging.index` ∩ compiled ops (ADR 0008), then fetches `installedRuleIds` from `installer.current()`.
- `extension/src/browser-schema.ts`: re-exports `validateRedirectDestination` and
  `countCapturingGroups` from `schema/src/browser-validation.ts` via relative imports
  (bypassing the `@rogatio/schema` → `browser-schema` esbuild alias) so the browser
  build's alias still supplies redirect validation to the bundled editor redirect
  extension without forking the helpers.

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

`RogatioRule` gains an `action` object with a `type` discriminant. Query-parameter rules define `QueryAction = { type: "query"; params: { name: string; operation?: "set" | "remove"; value?: string }[] }` where omitted `operation` means set and set requires `value` while remove forbids it. The schema `rule` `$defs` adds `action` (additionalProperties still false) and a `queryAction`/`action` subschema. New bounds: `maxQueryParamsPerRule`, `maxQueryNameLength`, `maxQueryValueLength`. Semantic validation adds duplicate-param-name and set/remove value rules. `browser-schema.ts` mirrors the same `action` validation and bounds because the MV3 bundle cannot load Ajv. `action` is optional to preserve backward compatibility with the extension's actionless projects.

### Compiler (compiler boundary change)

Compiler emits distinct operation types: `MatcherOperation` (actionless), `RedirectOperation` (redirect rules), and `QueryOperation` (query rules). `compileProject` emits the appropriate operation type based on `rule.type`. A pure helper `queryActionToDNR(action)` produces DNR `queryTransform.addOrReplaceParams` (`key`/`value`, `replaceOnly: false`) for set params and `removeParams` for remove params, omitting empty arrays. This is the durable foundation header and mock rules extend by adding new operation types.

### Extension (extension boundary change)

`projection.ts` `projectMatchers` dispatches on operation kind. For `QueryOperation` it builds a DNR rule with `redirect.transform.query`; for `RedirectOperation` it builds a DNR `redirect` rule; for `MatcherOperation` it returns `installable: false`. `service-worker.ts` `operationStatuses` reports redirect and query rules as `active` when compiled and enabled; actionless matchers remain `unsupported`. Request/initiator domains derive from origin hostnames (`requestDomains` / `initiatorDomains`). Successful DNR install writes the match-logging index for redirect, query, and header ids through one wholesale writer on `install()`. Console match logging is described under Chrome MV3 Extension Architecture.

### Editor (editor boundary change)

The `RuleTypeFieldExtension` registry gains a `query` extension whose `matches(rule)` returns `rule.action?.type === "query"`. The editor adds a `Rule type` selector listing registered extension labels; selecting `query` initializes `action = { type: "query", params: [] }` and mounts the extension's param name/value form (add/remove rows). The extension `validate` enforces field-level diagnostics. Unknown action data with no owning extension is not persisted (preserves the editor's rejection of arbitrary `action` passthrough).

### Migration / compatibility

The version-1 schema keeps `action` optional to preserve backward compatibility with the extension's actionless projects. Rules without `type`/`action` remain valid actionless matchers (reported `unsupported`). Query-parameter rules are browser-only and supported on Linux/Windows/macOS; activation is in-browser, no native runtime.

### Rejected alternatives

- Keep `action` optional to preserve the extension's actionless projects: accepted for backward compatibility; actionless rules remain valid but `unsupported`.
- Using `addParams`/`removeParams`/`replaceParams` **instead of** `addOrReplaceParams` for set: rejected; set still uses `addOrReplaceParams` with `replaceOnly: false`. `removeParams` is only for `operation: "remove"`.
- Implement query rewriting in the extension service worker rather than DNR `transform.query`: rejected; DNR is browser-native, declarative, and offline, matching the extension's design.

## Mock Rules

A `mock` rule returns a configured HTTP response without contacting upstream. It is a separate rule type from response-body replace. The schema owns `MockAction` (`status`, optional `headers` and `delayMs`, and exactly one of `body` or `file`). The compiler emits `MockOperation`. The editor ships `createMockRuleType`. Dry-run previews the action through the shared `previewRuleAction` (`Mock {status} (inline body|file-backed body, …)`).

Mocks are served only while the unified native host is running. The extension installs a session declarativeNetRequest redirect in the band `5_000_001..6_000_000` to `http://127.0.0.1:<port>/.rogatio/mock/<token>/<digest>` on the existing intercept listener, plus one allow guard at id `6_000_000` and priority `1001` so a broad user regex cannot recurse. Stop and host disconnect remove those session rules. Enabled body mocks report `needs runtime` until that redirect is installed, then `active`. An enabled file mock reports `needs root directory` until a device-local mock folder is saved, then `needs runtime` until the redirect is installed, then `active`. Saving or clearing that folder while the host is running updates the live folder through `runtime.set-file-root`; a restart is not required. A rejected update is not stored. An unprojectable source or a missing native adapter is `unsupported`. A failed install or a request-time file error is `error`, with a redacted extension diagnostic. File errors clear on a later successful read, a folder change, a project save, or a host restart.

File bodies are arbitrary bytes, re-read per request from one confined root. Linux proves confinement with directory handles. macOS proves it with `openat` and `fcntl(F_GETPATH)` through `koffi`, and fails closed when that library cannot load. The root does not travel in exported `.rogatio.json`. The extension stores an optional root on the project record. The CLI stores an override in device-local config keyed by the canonical project path (`ROGATIO_CONFIG_DIR`, otherwise `~/.config/rogatio/mock-roots.json`). `rogatio edit` can set or clear that override. When no override is saved, a file-opened project uses that file's directory. Stdin projects that contain a file mock require `--root`. The process working directory is never used.

The F13 standalone mock server, `/v1/connection`, Check-and-connect, the `--mock-port` faucet, and envelope `mock.request` / `mock.response` / `mockBody` are not part of this design. Tokens are minted only for mocks in enabled groups and are excluded from the preset digest. Rendered bytes stay on the loopback listener.

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
state, enabled groups, exact configured local origins, and the explicit
extension ID. The policy contains the complete request-phase authority snapshot needed by
the native runtime: normalized matchers, all competing request-phase operations, action
data, source order, project identity/revision, limits, and session scope. It
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

**Two marker roles share the reserved `X-Rogatio-Dispatch-*` name prefix but must not be
conflated.** (1) **Logging-only URL-match markers** (`#163`): session-store set-only rules
with inert opaque values so `onRuleMatchedDebug` fires for `request-body` and
`response-body`; stripped by non-DNR runtime before upstream; never mint rewrite
capability / pending-auth; never paired with a DNR remove of the same header. Owned by the
session-body-marker helper (band `3_000_001+`), lifecycle-tied to native-session
start/stop, installed only when `runtimeStripPathAvailable` is true (production
wiring in `background.ts` is currently `false`). (2) **Rewrite
capability markers** (request-body interception / `#170`): capability signals validated by
the native runtime against policy digest and winner — design target below. Logging markers
must not carry session capability, preset digest, or rewrite-auth material.

The native runtime validates the rewrite-capability marker token, target, method, resource type, policy
digest, and global winner against its immutable policy. A rewrite marker is a capability signal
from the active extension session, not a trusted rule ID supplied by a page. Marker
names use a runtime-owned reserved prefix, are rejected when duplicated or malformed,
and are removed before upstream forwarding. A request with a valid body rewrite marker that
fails framing, authority, or transformation is blocked before upstream; it never falls
back to its original body.

Rewrite markers are static session rules, one per request-body operation. The request-body rules do not use
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
control the extension-owned live browser session. The lifecycle is owned by the extension;
the previous CLI `runtime activate` / `deactivate` / `status` subcommands have been
removed. No command auto-installs
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
- Content lives in `src/content/docs/**` as Markdown (`.md` / `.mdx`). Starlight's docs
  collection is wired through `src/content.config.ts` (`docsLoader`). The package remains
  free of product `.ts` source that would otherwise be pulled into the root
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
- Has its generated output (`packages/docs-site/.astro`, `dist`) ignored via
  `biome.json` `files.includes` (`!!**/.astro`, `!!**/dist`), so Biome never reads Astro's
  generated `content.d.ts`, collection schema, and content modules. Hand-written docs-site
  sources (`*.css`, `*.mjs`, `*.ts`) stay under root lint/format coverage; Biome does not
  parse `.astro` or `.md`, so those files are left to Astro/Starlight tooling. Biome 2.x
  ignores `.biomeignore`, so all ignore rules live in `biome.json`.

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
   executed as a real binary (`verify`, `test`, `runtime install --extension-id …`,
   `runtime host`, `--version`). The CLI
   `edit` server is driven over real HTTP (editor page, vendor bundle, CSRF-protected
   validate/save/cancel, file writes, shutdown). The mock runtime (`rogatio runtime`) is
   started as a real process and its pairing/authorization/mock-response journey is proven
   over real loopback HTTP, including denial paths. These tests are cross-platform and run
   in the `cross-platform` CI job. The published `@rogatio/cli` is self-contained: esbuild
   fully inlines `@rogatio/schema`, `@rogatio/compiler`, `@rogatio/dry-run`, `@rogatio/editor`,
   and `@rogatio/runtime` into a single ESM bundle with no `workspace:*` leakage; the only
   declared runtime dep is `ajv`. The bundled editor assets (JS, CSS, woff2 fonts) are
   mirrored into `packages/cli/dist/editor/` at build time so the published tarball is
   installable via `npm`, `pnpm`, `bun`, or `vp` without any pnpm workspace machinery.

2. **Packaged-install tests:** the packed-tarball CLI test above is the packaged-install
   proof for the CLI. The extension's "package" is its built `packages/extension/dist`
   directory loaded as an unpacked extension in Chrome for Testing (the extension is distributed
   as a ZIP in the release pipeline; the unpacked-load journey is the same code path). The manifest contract
   and MV3 artifact hygiene remain enforced by `scripts/validate.ts`.

3. **Selenium headless browser journeys (`test/browser/`, Chrome for Testing):**

   - **CLI `edit` journey:** the real built CLI process serves the editor; a headless
     Chrome for Testing page edits a project, validates, saves, and the file is verified on disk and
     the server shuts down.
   - **Extension lifecycle journey:** the real built extension is loaded into a persistent
     headless Chrome for Testing profile (`--disable-extensions-except` +
     `--load-extension`, binary from `pnpm browser:install` / `@puppeteer/browsers`
     `chrome@stable`). The journey imports a project (rejecting non-Rogatio files),
     activates a group, asserts the rule status becomes `active`, mounts the editor,
     exercises create/refresh on the management page, and relies on broad install-time
     `host_permissions` rather than a per-origin grant step.
   - **Extension DNR journey:** a redirect DNR rule in the extension's own rule shape is
     installed through the real `chrome.declarativeNetRequest.updateDynamicRules` API and
     accepted by Chrome, proving the translated rule shape is Chrome-valid (RE2, domains,
     resource types).
   - **Mock runtime journey:** the real `rogatio runtime host` process is started; the real
     extension's native-host `mock.connect` handshake pairs with it and reports `connected`.

### Product repairs surfaced by the suite (in scope)

Building the real journeys exposed defects that the mocked unit tests could not:

- **Editor rule-type registration (`packages/editor/src/editor.ts`):** hosts pass
  `mock`/`response-body` rule types that are already built in; `normalizeExtensions` threw
  instead of replacing. Passed ids now replace built-ins; duplicates within the passed list
  still fail closed.
- **CLI packaged binary (`packages/cli/src/index.ts`):** the built entry lacked a shebang
  so the installed `rogatio` bin could not execute, and the `isDist` check used a
  POSIX-only separator, breaking packaged installs on Windows.
- **DNR install wiring (`service-worker.ts`):** enabled redirect/query rules were
  never installed (only mock rules at check-and-connect), leaving them `error` forever.
  `projectState` now installs enabled installable operations through the real
  installer.

### Harness rules

- No new dependencies; Node-only orchestration; cross-platform paths; no shell-only
  scripts.
- Real artifacts and real processes; a test that cannot reach its subject is a failure,
  not a skip. The only skipped-by-default case is the request-body-rules live E2E.
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
- Extension E2E: Chrome for Testing (`pnpm browser:install`), real extension, real
  `chrome.storage.local`, and `chrome.declarativeNetRequest`. Host access comes from
  the manifest's broad `host_permissions` grant at install time.
- DNR shape: `chrome.declarativeNetRequest.updateDynamicRules` acceptance in Chrome
  for Testing.

### Rejected alternatives

- Mocking `chrome` APIs in the browser journey: rejected — that is what the existing
  fixture-based `extension.spec.ts` does and it cannot catch real Chrome boundary
  failures (the bugs above).
- A synthetic DNR test page instead of the real extension: rejected — the journeys must
  load the real built extension.

## Native runtime consolidation (feature/consolidated-native-runtime)

> The faucet, `--mock-port`, envelope `mockBody`, and `needs proxy` status in this section were later removed. Current mock serving is the loopback route in [Mock Rules](#mock-rules).

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
  mock-server path; added `rogatio runtime host <path>` (with `--mock-port`); kept
  `install` / `uninstall` trust lifecycle (session Start/Stop is extension-owned; the
  former `activate` / `deactivate` / `status` CLI subcommands were later removed — see
  `docs/specs/cli-activate-deactivate-removal.md`). The CLI `rogatio` binary also exposes
  `rogatio runtime host <path>` (with `--mock-port`) as the user-facing way to run the
  host entry point; the native-messaging manifest's `runtime-host` executable basename
  routes to the same entry point so the browser-spawned process works.
- `packages/extension/src/background.ts`: production `nativeRuntime` adapter built over
  `chrome.runtime.connectNative` (envelope `send` + thin start/stop/status/sendPolicy
  shims). Mocks are discovered via `connectNativeMock` (`mock.connect`) and delivered
  through the single native host.
- `packages/extension/src/native-session.ts`: `connectNativeMock`/`requestNativeMock`
  envelope methods (REQ-013); `mock.connect` returns the loopback faucet `port` + per-rule
  tokens.
- `packages/extension/src/service-worker.ts`: the unified `start-native-runtime` path
  performs the native-host `mock.connect` handshake, storing the connection (port +
  tokens) for the DNR `mockUrlResolver` (REQ-007) and installing the mock faucet
  redirects; stopping removes only those session-owned mock redirects. Mock rules report
  `needs proxy` until the host answers `mock.connect`, a stable `mock-token-missing`
  error when the host answers without the rule's token, and `active` once installed.
  A failed start leaves the truthful `failed` phase and surfaces the reason as a distinct
  diagnostic (`extension.native-host-missing` when the native host manifest is not
  registered, `extension.native-runtime-transition` otherwise); the separate
  Check-and-connect command and mock-connection state are removed. The sidebar runtime
  status line reports the current phase next to the Start/Stop controls.

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

