# F21 — Chrome toolbar popup: per-group enablement toggle

## Problem statement and goals

Toggling an active project's groups currently requires opening the full Requestify
management page. There is no compact toolbar surface that can Activate or Deactivate a
single saved group. Group enablement is a distinct, browser-local lifecycle action
(`set-group-enabled`) scoped to one saved, runtime-eligible active-project group; the
shared editor (management page) is the only place that control exists today.

Goal: add one compact, accessible Chrome toolbar popup that lists the active project's
persisted groups, each with a truthful runtime status and one enablement switch, plus an
"Open app" control that opens the existing management page and a pencil control that opens
the management page on the group's exact destination. The popup must contain no editor,
search, proxy, permission, or rule-authoring controls.

## Scope

In scope:

- A new action popup (`popup.html` + `popup.ts`) bound through the manifest
  `action.default_popup`.
- The popup lists only the active project's persisted groups, in source order.
- Each row: group name, rule count, truthful runtime status, one enablement switch, one
  pencil control. No extension-wide or project-wide master toggle.
- The enablement switch drives the existing `set-group-enabled` lifecycle (Activate /
  Deactivate one group).
- An "Open app" control opening the existing management page (`index.html`) at Overview.
- A pencil control opening the management page on the group's exact destination.
- A small additive `EditorController.navigateToGroup(groupId)` API consumed by the
  management page to honor the pencil deep link.

Out of scope (explicit non-goals):

- No second editor, no rule authoring, no search, no proxy controls, no permission
  request/grant UI, no project selector/switch, no create/import/export/remove, no badge
  or runtime controls in the popup.
- No change to the management page's existing Activate/Deactivate controls, its
  disabled-by-default save/import behavior, the badge agreement, or the origin/permission/
  proxy boundaries.
- No change to the service-worker enablement lifecycle, installer, or status model beyond
  what the popup consumes.
- No Firefox/Safari or other-browser surface; Chrome MV3 only.

## Actors, entry points, supported environments

- Actor: a Chrome user who has at least one project (exactly one active project whenever
  any exist) with persisted groups.
- Entry point: the toolbar action button opens `popup.html` (manifest `default_popup`).
- Supported environment: Chrome MV3 extension, the same build/runtime as F7.

## Functional requirements

- **REQ-001** The manifest `action.default_popup` points at `popup.html`. The management
  page `index.html` remains loadable in a tab and is no longer the popup.
- **REQ-002** The popup header identifies Requestify and the active project name, and
  contains exactly one "Open app" button.
- **REQ-003** The popup lists the active project's persisted groups in the source order
  stored in `data.groups`.
- **REQ-004** Each row shows: the group name, the group's rule count (`rules.length`),
  a truthful runtime status, one enablement switch, and one pencil control.
- **REQ-005** The enablement switch reflects `enabledGroupIds` for that group and, on
  change, sends `set-group-enabled` with the active project id, the group id, and the new
  boolean to the service worker.
- **REQ-006** A group that is not persisted in the active project (new or dirty editor
  draft; or otherwise ineligible) has no runtime toggle in the popup. Because the popup
  reads persisted `get-state` (not the editor draft), new/dirty groups never appear; the
  toggle is therefore present for every group the popup lists. Eligibility is defined as
  "persisted in the active project." This is recorded as a decision (see Open questions).
- **REQ-007** Truthful runtime status: each row aggregates the group's per-rule statuses
  from `ruleStatuses`. If the group is not in `enabledGroupIds`, status is `disabled`.
  Otherwise the row shows the most informative status among the group's rules, precedence
  `error` > `needs proxy` > `needs permission` > `unsupported` > `active`. A group with no
  rules shows `active` when enabled and `disabled` when not. Permission, proxy,
  unsupported, and error states remain visible and are not approximated or hidden.
- **REQ-008** "Open app" opens the management page at Overview via
  `chrome.tabs.create({ url: chrome.runtime.getURL("index.html") })` (or equivalent), with
  no popup-only navigation state persisted.
- **REQ-009** The pencil control opens the management page on the group's exact
  destination: `chrome.runtime.getURL("index.html") + "?group=" + encodeURIComponent(id)`.
- **REQ-010** The management page reads the `group` query parameter and, after creating the
  editor, calls `editor.navigateToGroup(id)` (new additive API) to focus that group. Unknown
  or missing groups fall back to the default Overview route and never error.
- **REQ-011** The popup contains no editor, search, proxy, permission, or rule-authoring
  controls, and no extension-wide or project-wide master toggle.
- **REQ-012** The popup rebuilds its view from `get-state`/`refresh` (same envelope the
  management page uses) and re-reads after each `set-group-enabled` so the switch and
  status stay truthful.

## Acceptance criteria

- **AC-001** Chrome exposes one compact toolbar popup that lists the active project's saved
  groups with one enablement toggle each. The popup contains no editor, search, proxy,
  permission, or rule-authoring controls.
- **AC-002** Each eligible toggle Activates or Deactivates that one group through the
  existing `set-group-enabled` lifecycle. A new, dirty, or otherwise ineligible group has no
  runtime toggle.
- **AC-003** Permission, proxy, unsupported, and error states remain visible in the popup
  and are not approximated. The toggle remains present for persisted groups whose rules are
  in those states.
- **AC-004** The "Open app" control opens the existing management page at Overview. The
  pencil control opens the management page on the group's exact destination. Neither control
  adds a second editor or persists popup-only navigation state.
- **AC-005** The existing management-page Activate/Deactivate controls, disabled-by-default
  save/import behavior, badge agreement, and exact origin/permission/proxy boundaries remain
  unchanged.
- **AC-006** Build produces `popup.js` and copies `popup.html` into the extension dist; the
  manifest `default_popup` references `popup.html` and `index.html` stays loadable.

## API, CLI, UI, file-format, compatibility changes

- New build target: `packages/extension/src/popup.ts` → `dist/popup.js` (browser, es2022,
  same aliases as `extension-page-entry.ts`).
- New static file: `packages/extension/public/popup.html` (copied to `dist/popup.html`).
- Manifest change: `action.default_popup` from `index.html` to `popup.html`.
- Additive editor API: `EditorController.navigateToGroup(groupId: string): void` (no signature
  change to `EditorOptions`; additive to the controller interface and impl).
- New message path reused: `set-group-enabled` (already exists in service worker, protocol,
  and repository). No new command required.
- Deep link: `index.html?group=<id>` (query param only; no persisted popup state).

## Security, privacy, performance, accessibility, operational requirements

- Security/privacy: the popup reuses the existing persisted-storage read path; it never
  grants permissions, never touches the proxy, never authors rules, and never writes files.
  It sends only `set-group-enabled`, an existing, validated command. No new origins or
  capabilities.
- Performance: the popup reads one envelope and renders a bounded list (≤ groups in one
  project). No polling; it refreshes only after an explicit user action.
- Accessibility: the popup is keyboard operable and screen-reader friendly. The enablement
  control is a real `switch`/`checkbox` with an accessible name tied to the group; the status
  is conveyed as text, not only color; the "Open app" and pencil controls are buttons with
  accessible labels. The layout supports 200% zoom and forced colors, matching the existing
  editor's accessible posture.
- Compatibility: Chrome MV3 only; no change to the data model, storage envelope, or rules.

## Migration, rollout, backward-compatibility

- No storage migration. The management page continues to work unchanged. Existing installs
  gain the popup automatically on next load because `default_popup` is manifest-driven.
- Backward compatibility: `index.html` remains a valid standalone page; opening it directly
  (from "Open app" or pencil) is supported and unaffected.

## Open questions and assumptions

- **Eligibility definition (decision):** The task says a "new, dirty, or otherwise ineligible"
  group has no runtime toggle. Because the popup reads persisted `get-state` (the storage
  envelope), it can only ever list persisted groups; editor-draft (new/dirty) groups are
  excluded by construction. "Otherwise ineligible" is therefore interpreted as "not present
  in the active project's persisted `data.groups`," which cannot occur for a listed group.
  Consequence: every group the popup lists is eligible and gets a toggle. If a stricter
  in-popup ineligibility rule is desired (e.g., exclude groups that fail compilation or have
  zero runtime-eligible rules), it should be confirmed before implementation; the spec
  currently treats all persisted groups as eligible. This is the one point to confirm at the
  review gate.
- **Group status aggregation:** chosen precedence is defined in REQ-007. The management page
  currently shows per-rule statuses; the popup shows one truthful per-group status derived
  from the same authoritative `ruleStatuses`, so it cannot diverge from the badge/status
  model.
- **"Open app" mechanism:** uses `chrome.tabs.create` to open the management page in a tab,
  matching "opens the existing management page at Overview." If a user-gesture constraint
  forbids `chrome.tabs.create` from the popup, `chrome.runtime.openOptionsPage` is not
  applicable (this is not an options page); fallback is an anchor with
  `href=chrome.runtime.getURL("index.html")` and `target="_blank"`. The implementation will
  use the simplest gesture-safe mechanism.
