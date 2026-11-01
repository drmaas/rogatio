# Implementation Plan — F21: Chrome Popup Group Toggle

Feature branch: `feature/popup-group-toggle`
Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/popup-group-toggle`
Spec: `docs/specs/f21-popup-group-toggle.md`
Tier: free (single-model session `hy3-free`; role passes kept distinct, fresh-context self-review at Stage 9)

## Goal

Add one compact Chrome toolbar popup that lists the active project's persisted groups, each with a
truthful runtime status and one enablement switch, plus an "Open app" control (management page at
Overview) and a pencil control (management page on the group's exact destination). No editor, search,
proxy, permission, or rule-authoring controls in the popup. Reuses the existing `set-group-enabled`
lifecycle; changes nothing about management-page controls, save/import defaults, badge, or origin/permission/proxy boundaries.

## Scope

- New popup surface (`popup.html` + `popup.ts`) as `action.default_popup`.
- Management page (`index.html`) stays tab-opened; opened by "Open app" and by pencil (with `?group=<id>`).
- `set-group-enabled` service-worker command reused unchanged.
- `EditorController.navigateToGroup(id)` added (additive) so `?group=<id>` deep-links.
- Build/packaging wires `popup.html`/`popup.js`.
- Tests for: editor `navigateToGroup`, service-worker `get-state`/`set-group-enabled` envelope + group status aggregation, popup model (state shape, eligibility, toggle command, deep-link URLs).

## Non-goals

- No second editor, no popup-only persisted navigation state.
- No master/toggle-all, no search, no proxy/permission requests, no rule authoring in popup.
- No change to management-page Activate/Deactivate, disabled-by-default save/import, badge agreement, origin/permission/proxy boundaries.

## Tasks (ordered)

### T1 — Manifest: popup becomes the action surface  `packages/extension/public/manifest.json`
- Change `action.default_popup` from `index.html` to `popup.html`.
- Keep `index.html` referenced nowhere in `action`; it remains reachable via `chrome.tabs.create`.
- AC: `AC-001`, `AC-003`.

### T2 — Build wiring  `scripts/build.ts`
- Add an esbuild target `popup.ts` → `dist/popup.js` mirroring the `extension-page-entry.ts` target
  (format esm, platform browser, target es2022, bundle, sourcemap) with the same alias set
  (`@rogatio/schema`→`src/browser-schema.ts`, `@rogatio/compiler`→`src`, `@rogatio/browser-core`→`src`, `@rogatio/editor`→`src`).
- Add a copy step `public/popup.html` → `dist/popup.html`.
- AC: `AC-001` (packaging), build emits `dist/popup.js` + `dist/popup.html`.

### T3 — Popup HTML  `packages/extension/public/popup.html`
- Minimal accessible document: linked `popup.js` (module), `lang`, viewport, title "Rogatio".
- No editor markup; only a root container the controller populates.
- AC: `AC-001`, `AC-002`.

### T4 — Editor deep-link  `packages/editor/src/types.ts`, `packages/editor/src/editor.ts`
- Add `navigateToGroup(groupId: string): void` to `EditorController` interface (additive; no existing member removed).
- Implement in `createEditor` by reusing the private `navigate("group", groupId)` logic; fallback to Overview when the group id is absent from the draft.
- `extension-page-entry.ts`: after creating the editor, read `?group=<id>` (URLSearchParams) and, if present, call `editor.navigateToGroup(id)`.
- AC: `AC-004` (pencil destination), `AC-009` (no second editor).
- Tests: editor unit test asserting `navigateToGroup` routes to the group route and falls back to Overview for an unknown id; `extension-page-entry` deep-link wiring covered by existing/added page test where feasible.

### T5 — Popup controller  `packages/extension/src/popup.ts` (new)
- Establish a message client to the service worker mirroring `extension-page-entry.ts`
  (`chrome.runtime.sendMessage` with the same envelope protocol).
- On open: `get-state`; render header (Rogatio + active project name) and "Open app" button.
- Render rows in source order from `projects[activeProjectId].data.groups`:
  - name, rule count (`group.rules.length`), aggregated status text, one enablement switch (checked when group id ∈ `enabledGroupIds`), one pencil button.
  - Switch `change` → `sendMessage({type:"set-group-enabled", groupId, enabled})`; optimistic UI update on response `ok`, revert on error.
  - Pencil → `index.html?group=<id>` (open in tab).
  - "Open app" → `index.html` (open in tab).
- Aggregated group status (REQ-007): from `ruleStatuses` for that group's rules:
  precedence `error` > `needs proxy` > `needs permission` > `unsupported` > `active`;
  if group id ∉ `enabledGroupIds` → `disabled`; empty group enabled → `active`, empty disabled → `disabled`.
- Listen for runtime state changes (same channel as page) and re-render.
- No editor, search, proxy, permission, or rule-authoring controls. No master toggle.
- AC: `AC-001`, `AC-002`, `AC-003`, `AC-005`, `AC-006`, `AC-007`, `AC-008`.
- Tests: popup model/unit test covering (a) only active-project persisted groups listed in source order; (b) every listed group eligible + toggle present; (c) aggregated status precedence; (d) toggle sends `set-group-enabled`; (e) "Open app" and pencil URLs.

### T6 — Service-worker get-state envelope completeness  `packages/extension/src/service-worker.ts`
- Verify `get-state` returns `projects[activeProjectId].data.groups` (id, name, rules array) and `enabledGroupIds`, plus top-level `ruleStatuses` (group id, rule id, status, diagnostics) and `badge`.
- If any field missing for the popup's needs, add it (no behavioral change to install/permission/badge).
- Confirm `set-group-enabled` returns `{ok, value}` and installs only redirect/query ops whose origins are granted (unchanged).
- AC: `AC-003`, `AC-005`, `AC-006`.

### T7 — Verification  (Stage 8)
- Run repo canonical validation: Biome format/lint, `tsc` strict typecheck, Vitest unit/integration (new popup + editor + sw tests), and the build (`scripts/build.ts`) to confirm `dist/popup.js`/`dist/popup.html` emit.
- E2E if available for popup toggle journey; otherwise document manual check in workflow log.

### T8 — Docs  (Stage 10)
- `docs/architecture.md`: note popup surface + reused `set-group-enabled`; no management-page behavior change.
- `README.md`: mention toolbar popup lists groups + toggle; "Open app" / pencil behavior.
- `AGENTS.md` orientation: optional note that F21 popup exists.

## Acceptance-criteria → task map
- AC-001 → T1, T2, T3, T5
- AC-002 → T3, T5
- AC-003 → T1, T5, T6
- AC-004 → T4
- AC-005 → T5, T6
- AC-006 → T5, T6
- AC-007 → T5
- AC-008 → T5
- AC-009 → T4

## Risks / rollback
- Single-model session: keep brainstorm/architecture/spec/plan/tests/impl/verify/review passes distinct; self-review at Stage 9 with fresh context.
- Rollback: revert manifest `default_popup` to `index.html`, delete `popup.ts`/`popup.html` build target. No storage or protocol change, so no migration.
