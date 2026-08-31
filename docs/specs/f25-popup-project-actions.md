# F25 — Toolbar popup: larger surface and project entry actions

## Problem statement and goals

The F21 popup is content-sized and narrow: rule names truncate, per-row controls
crowd together, and long projects push the card against Chrome's popup height
cap with whole-card scrolling. Creating or importing a project also requires
opening the full management page, so a first-time user cannot start from the
toolbar.

Goal: give the popup a comfortable, fixed width with a larger type scale and an
internally scrolling group list, and add two project entry actions that reuse
the existing service-worker project lifecycle:

- **New project** — an inline name form that sends the existing
  `create-project` command.
- **Import project** — a hidden file input that parses a selected
  `.rogatio.json` file locally and sends the existing `import-project`
  command.

This scope was explicitly requested by the user; it supersedes the F21
non-goal "no create/import" for the popup surface only. Everything else in F21
remains in force.

## Scope

In scope:

- `packages/extension/src/popup-model.ts` — `createProject(name)` and
  `importProject(data)` model actions returning truthful success flags.
- `packages/extension/src/popup.ts` — actions row, inline create form (no
  `window.prompt`, which is unavailable in action popups), hidden file input,
  and a `role="status"` outcome line.
- `packages/extension/src/popup.css` — fixed 420px popup width, larger root
  type scale, internal group-list scrolling, and styles for the new controls.

Out of scope (explicit non-goals):

- No editor, search, proxy, permission, runtime, or rule-authoring surface in
  the popup; no project selector/switch, export, or remove in the popup.
- No new service-worker commands, storage changes, or protocol versions; both
  actions send existing validated commands.
- No automatic group activation or permission grant after create/import (the
  repository's disabled-by-default rule stands).
- No Firefox/Safari or other-browser surface; Chrome MV3 only.

## Functional requirements

- **REQ-001** The popup body is a fixed 420px wide; the group list scrolls
  internally (bounded under Chrome's 600px popup height cap) so long projects
  never force whole-card scrolling.
- **REQ-002** The actions row exposes exactly two buttons: "New project"
  (`data-create-project`, `aria-expanded`/`aria-controls`) and "Import
  project" (`data-import-project`).
- **REQ-003** "New project" toggles an inline form (`data-create-form`) with a
  required, bounded (schema label limit, 100 characters) name input, a
  "Create" submit, and a "Cancel" button that collapses the form and clears
  the draft.
- **REQ-004** Submitting the form sends `create-project` with
  `{ version: 1, name: <trimmed>, groups: [] }`; an empty/whitespace name is
  not sent. Success collapses the form and reports "Project created.";
  failure keeps the form (and typed draft) and reports a truthful failure.
- **REQ-005** "Import project" opens the hidden file input
  (`data-import-input`, `.json`/`.rogatio.json`/`application/json`). The
  change handler reads the file and sends `import-project` with the parsed
  value before any other UI work (Chrome may close the popup right after the
  file picker resolves). Invalid JSON is reported as such and never sent.
- **REQ-006** The popup performs no schema validation of its own; the
  repository validates imported/created data and fails closed with a stable
  diagnostic. The popup reports "The project could not be
  created/imported." on failure.
- **REQ-007** A `role="status"` line (`data-popup-status`) reports the last
  outcome; existing group rows, toggles, "Open app", and the pencil deep link
  are unchanged.

## Acceptance criteria

- **AC-001** The popup card renders wider than 400px at the default root font
  size, and the group list scrolls internally instead of growing the card past
  Chrome's popup height cap.
- **AC-002** Creating a project from the popup sends the exact existing
  `create-project` message shape and reports the truthful outcome; a blank
  name never sends a message.
- **AC-003** Importing a project from the popup sends the exact existing
  `import-project` message shape with the parsed file data; a non-JSON file is
  rejected locally with a truthful message.
- **AC-004** Existing popup behavior (group rows, per-group truthful status,
  `set-group-enabled` toggles, "Open app", pencil deep link) is unchanged.
- **AC-005** The popup remains keyboard operable with visible focus, respects
  forced colors and reduced motion, and the new controls carry accessible
  names/expansion state.

## Verification

- Unit: `packages/extension/test/popup-model.test.ts` covers both commands,
  truthful success/failure flags, and the empty-name guard.
- Browser: `test/browser/design-system.spec.ts` asserts the popup card width,
  the actions row, the create form flow, and the import flow through the file
  input against the test chrome mock.
- Canonical: `pnpm validate` (format, lint, typecheck, build, unit tests, MV3
  manifest contract, forbidden-dependency guard) plus `pnpm test:browser`.
