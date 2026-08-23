# F7 Chrome MV3 Extension Shell Specification

**Status:** Approved
**Feature:** F7 - Chrome MV3 extension shell
**Depends on:** F4 `@rogatio/browser-core`, F5 `@rogatio/editor`

## 1. Problem And Goals

Rogatio needs a Chrome Manifest V3 boundary that turns the browser-neutral project and matcher model into an installable extension experience. The shell must let a user manage up to 64 local projects, explicitly choose the active project, review and grant only declared site access, activate groups separately, project actionless matcher operations without changing browser behavior, edit projects with the shared editor, and see stable rule and badge status without adding accounts, sync, telemetry, traffic history, or runtime-dependent rule behavior.

F7 provides the extension platform and project-management workflow. Rule action slices such as redirects, query parameters, headers, mocks, response-body rewriting, and request-body modification remain later features.

## 2. Scope And Non-Goals

### In scope

- A private `@rogatio/extension` package targeting Chrome Manifest V3.
- A manifest, background service worker, extension page, and browser-safe build output.
- Deterministic translation/projection of F4 neutral matcher operations for future Chrome Declarative Net Request action slices; actionless F7 operations are reported as unsupported and are never installed.
- Chrome storage, permissions, runtime messaging, tabs, and action badge adapters.
- Project lifecycle: create, import/update, switch, edit, export, and cancelable removal.
- A project selector where choosing a project does not switch it until the user selects **Switch project**.
- Permission review and grant for the complete declared origin set, with no undeclared origin requests.
- Group activation as a separate explicit action from permission grant.
- Conflict results that preserve committed state and expose an explicit refresh action.
- The 64-project cap and exactly-one-active-project invariant supplied by F4.
- Rendering rule statuses and the toolbar badge from F4 state.
- Unit tests for translation, adapter behavior, project workflow, status/badge rendering, and stable diagnostics.

### Explicit non-goals

- Any rule action payload or rule-type slice; F7 projects only the common matcher envelope and must not invent an action or install an actionless DNR rule.
- Redirect, query-parameter, header, mock, response-body, or request-body behavior.
- Native messaging, local runtimes, PAC/proxy routing, TLS, file access, network requests, or upstream traffic inspection.
- Browser sync, accounts, hosted services, telemetry, persistent traffic history, or a management-page event feed.
- Firefox, Edge, Safari, or any browser-specific implementation other than the Chrome MV3 boundary.
- Automatic project switching, automatic group activation, automatic permission grants, or automatic runtime connections.
- A browser-store package or release pipeline; packaging remains a later release feature.

## 3. Actors, Entry Points, And Environments

- **Extension user:** opens the extension page to manage projects, permissions, enablement, and exports.
- **Chrome service worker:** owns persisted state access, project lifecycle commands, DNR installation, status computation, and badge updates.
- **Chrome MV3 APIs:** `storage.local`, `permissions`, `declarativeNetRequest`, `runtime`, `tabs`, and `action`.
- **Supported environment:** Chrome with Manifest V3 on Linux, Windows, and macOS; the package must use browser-safe bundled JavaScript and no Node globals at runtime.

The extension page uses the shared framework-free editor from F5. The service worker is the only authority for project persistence and installed rules. UI code communicates with the service worker through typed, versioned runtime messages.

## 4. Functional Requirements

### Project lifecycle

- **REQ-001:** The extension shall persist its project envelope through a Chrome `storage.local` adapter implementing F4 `StorageAdapter` compare-and-swap semantics.
- **REQ-002:** The extension shall expose create, import, update, edit, export, and remove operations through the extension page and service-worker message boundary.
- **REQ-003:** Creation, import/update, and browser save shall preserve F4 behavior: newly committed or updated projects have all groups disabled; saved grants are retained only for still-declared origins.
- **REQ-004:** The extension shall enforce F4’s maximum of 64 uniquely named projects and exactly one active project whenever at least one project exists.
- **REQ-005:** Removing a project shall require a named, cancelable confirmation and shall never remove a project without the explicit confirmation action.
- **REQ-006:** The project selector shall show the selected destination separately from the active project. Selection alone shall not invoke `switchProject`; only **Switch project** shall do so.
- **REQ-007:** Switching projects shall restore the destination project’s saved group enablement choices without requesting permissions, changing grants, contacting a runtime, or silently installing a different project before the explicit switch operation completes.
- **REQ-008:** Export shall serialize only the selected project’s canonical source data and shall not include stored revision, grants, enablement, diagnostics, or runtime state.

### Permissions and groups

- **REQ-009:** Permission review shall calculate the exact declared effective HTTP(S) origins from the selected project and display them before a grant request.
- **REQ-010:** Grant requests shall contain only declared origins; the extension shall never request `<all_urls>`, wildcard hosts, undeclared origins, or unrelated permissions as part of F7.
- **REQ-011:** A permission grant shall be an explicit user action and shall not activate any group.
- **REQ-012:** Group activation shall be an explicit user action separate from permission review/grant. Enabling a group with missing permission shall leave its rules in `needs permission` and shall not expand the permission request automatically.
- **REQ-013:** The extension shall re-read authoritative Chrome permission state after grant/revoke changes and use it when computing status and installation decisions.

### Compilation, installation, and status

- **REQ-014:** The extension shall project each supported F4 matcher operation into a deterministic browser-neutral record with a stable numeric id, preserving source group/rule identity for later action-bearing DNR translation.
- **REQ-015:** Translation shall preserve URL regex source, resource types, optional method, priority, and effective origin constraints in the browser-neutral projection. Unsupported fields or operation kinds shall produce stable extension diagnostics and shall not be installed.
- **REQ-016:** F7 shall not install actionless matcher operations. The service worker shall project them as `unsupported` until a later action slice defines a browser-affecting DNR action. When a later supported operation is present, installation shall use F4 `InstallService` and the DNR adapter so failures attempt F4’s rollback path.
- **REQ-017:** Status rendering shall use F4 rule statuses and include `active`, `disabled`, `needs permission`, `needs proxy`, `unsupported`, and `error` labels without replacing stable core diagnostics with Chrome error wording.
- **REQ-018:** The action badge shall display F4’s active count and attention state for the active project; an empty project shall not display a misleading active count.
- **REQ-019:** Project lifecycle, permission, enablement, and installation failures shall preserve committed state and present stable, actionable diagnostics with an explicit refresh path for conflicts.

### Editor and UI

- **REQ-020:** The extension page shall mount the F5 shared editor for the active project and use its validation, save, cancel, keyboard, screen-reader, forced-colors, and 200% zoom behavior.
- **REQ-021:** The extension shall provide project management controls around the editor without duplicating F5’s field editing model.
- **REQ-022:** The UI shall visibly distinguish active project, selected project, permission state, group enablement, rule status, conflict state, and last-known badge state.
- **REQ-023:** User actions that can change stored state shall have explicit controls and stable success/failure status messages; merely opening or selecting a project shall not mutate state.

### Defensive behavior and compatibility

- **REQ-024:** Message payloads, imported projects, stored values, and Chrome API results shall be treated as untrusted structured data; cycles, accessors, proxies, symbols, malformed arrays, inherited properties, and unknown message versions shall fail closed.
- **REQ-025:** Public extension diagnostics and serialized exports shall be deterministic and independent of Chrome or third-party wording and incidental object iteration order.
- **REQ-026:** The extension shall not use Node-only globals, filesystem APIs, network APIs, dynamic code evaluation, or remote code in its MV3 runtime bundle.

## 5. Acceptance Criteria

- **AC-001:** A packaged MV3 manifest declares a background service worker and extension page, has no remote code or unsafe CSP allowances, and loads in Chrome without Node-global references.
- **AC-002:** Given a valid project with group and rule origins, the extension’s permission review lists the sorted effective origin set and a grant request contains exactly that set; no other origin is requested.
- **AC-003:** After creating or importing a project, all groups are disabled and no permission is granted automatically; the first project becomes active, while later projects do not replace the active project.
- **AC-004:** Selecting a different project in the UI changes only the pending selection; the active project and installed DNR rules remain unchanged until **Switch project** is activated.
- **AC-005:** Switching to a saved project restores its saved enablement choices, does not request permissions, and recomputes the DNR set, statuses, and badge only for the switched active project.
- **AC-006:** The UI cannot create a 65th project or a second project with an existing name; the failure is stable and committed storage is unchanged.
- **AC-007:** Removing a project shows its name in a cancelable confirmation; cancel leaves storage and the active project unchanged, while confirm removes only that project and applies F4’s active-project fallback.
- **AC-008:** A concurrent save/import conflict returns the committed project and a stable conflict result; the UI leaves the committed state intact and offers an explicit refresh action.
- **AC-009:** Enabling a group with all required origins granted projects its common matcher operations but renders F7 actionless rules `unsupported`; no DNR rule is installed. Disabling it renders them `disabled`.
- **AC-010:** Enabling a group without all required grants renders affected rules `needs permission`, does not request permission, and does not install those operations.
- **AC-011:** The matcher projection emits deterministic ids and preserves regex source, resource types, priority, method, and origins; repeated projection of the same operation is byte-for-byte stable.
- **AC-012:** No actionless F7 matcher reaches the DNR adapter. A later supported action update failure must use the F4 installer rollback path; F7 reports unsupported instead of claiming active installation.
- **AC-013:** The badge shows the active rule count and attention state produced by F4, including stable behavior for disabled, permission-needed, unsupported, and error statuses.
- **AC-014:** The shared editor mounts in the extension page with an extension registration point available for later rule slices; F7 itself registers no action-specific rule type.
- **AC-015:** Export contains the canonical project source only, round-trips through F2 validation, and excludes grants, enablement, revisions, diagnostics, and runtime state.
- **AC-016:** Hostile message/import/storage/API values fail closed with stable diagnostics and no partial write or permission request, DNR installation, or leaked sensitive data.
- **AC-017:** Root validation includes extension package format/lint/typecheck/build/unit checks and a real Chromium smoke test that loads the extension page and exercises the no-switch-on-selection workflow.

## 6. API And Compatibility Changes

### Package boundary

Add private package `@rogatio/extension` with browser-targeted source and a bundled MV3 output. It may depend on `@rogatio/browser-core`, `@rogatio/compiler`, `@rogatio/editor`, and `@rogatio/schema`; upstream packages must not depend on it. The extension package must expose testable browser-neutral helpers for DNR translation, permission projection, and message validation.

### Internal message protocol

Use a versioned discriminated protocol, for example:

- Requests: `get-state`, `create-project`, `import-project`, `save-project`, `select-project`, `switch-project`, `remove-project`, `export-project`, `review-permissions`, `grant-permissions`, `revoke-permission`, `set-group-enabled`, `refresh`.
- Responses: `{ version: 1, ok: true, value }` or `{ version: 1, ok: false, diagnostics }`, with a separate `kind: "conflict"` response carrying the committed project needed for refresh.

The protocol is internal and may evolve with a version increment; unknown versions and unknown commands are rejected.

### Chrome type surface

Use a narrow local declaration/adapter surface for the Chrome APIs needed by F7. Do not add a runtime dependency solely for ambient Chrome types unless the dependency is separately approved. The adapter must normalize API failures into stable extension diagnostics.

## 7. Security, Privacy, Performance, Accessibility, And Operations

- Permission requests are least-privilege and derived from validated effective origins.
- Imported and messaged data is validated at the service-worker boundary before persistence or browser API calls.
- DNR rule ids and serialized exports are deterministic, with no incidental key-order dependence.
- Storage updates and DNR updates are serialized through F4 boundaries; UI refreshes are idempotent.
- Extension pages preserve F5 keyboard, screen-reader, forced-color, and 200% zoom behavior.
- The extension page must remain usable when Chrome permission or DNR APIs reject, return malformed values, or are unavailable; the failure is rendered as a stable error state.
- The service worker must not retain traffic data or rely on process lifetime for durable state.
- F7 emits no traffic or console diagnostics.

## 8. Migration, Rollout, And Backward Compatibility

F7 introduces the first extension package and a version-1 Chrome storage envelope owned by F4. Empty Chrome storage migrates through F4’s empty-envelope path. Unknown or malformed stored versions fail closed with a stable storage diagnostic and do not overwrite the stored value. Existing repository `.rogatio.json` files remain canonical and are exchanged only through explicit import/export.

No existing browser extension API exists, so no runtime migration from an earlier extension release is required. Later rule slices may extend the common rule payload and DNR translation through new operation kinds without changing F7’s common matcher protocol.

## 9. Open Questions And Assumptions

- **Assumption:** F7 may choose an extension-page editor host as the primary management surface; a popup is not required because the overview describes a visual editor and project workspace rather than a popup workflow.
- **Scope decision:** Chrome DNR installation is deferred for F7 because the common F3 matcher operation has no action. F7 must not invent an allow/no-op action or alter browser behavior; later rule slices define installable actions.
- **Assumption:** A service-worker-owned state message is sufficient for the first F7 browser journey; multi-tab editor synchronization is not required beyond explicit refresh.
- **Assumption:** The current Chrome API version policy remains open, so adapter tests use the narrow local declarations and browser smoke tests cover only APIs available in the installed Chrome.
- **Scope decision:** The `[Rogatio]` DevTools Console record is deferred entirely from F7. Its Chrome event source, redaction contract, and live-only behavior require a later explicit feature specification.
