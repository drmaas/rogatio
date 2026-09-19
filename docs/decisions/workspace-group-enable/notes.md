# Workspace group enable — behavioral notes

Audience: hybrid

## Outcome

Make group on/off easy to find and use on the Chrome management Workspace tab, matching the popup’s `set-group-enabled` path, without changing editor package APIs or the save-clears-enablement invariant.

## Decisions (Stage 1)

- Q1: Promote existing Group activation controls (extension host only). No `createEditor` enablement port. Keep save → all groups disabled.
- Q2: When the editor is dirty, refresh enablement chrome without destroying the editor. When clean, full remount remains OK.

## Acceptance checks

- **AC-001:** On Workspace, Group activation appears directly under the active-project card and above runtime / match-logging / AI chrome.
- **AC-002:** Toggling a group still sends `set-group-enabled` and updates checkbox, badge, and rule statuses from the envelope.
- **AC-003:** With unsaved editor edits, a group toggle does not clear dirty draft state (`Unsaved changes` remains; draft fields preserved).
- **AC-004:** Clean editor path still remounts via existing refresh/renderShell after toggle.
- **AC-005:** No `@rogatio/editor` public API or schema/enablement persistence change.
- **AC-006:** `pnpm validate` passes.

## Non-goals

- Per-rule enable/disable
- Persisting enablement across Save
- Editor package ports for enablement
- CLI `rogatio edit` toggles
