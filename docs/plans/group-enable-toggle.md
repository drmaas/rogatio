> Status: frozen 2026-09-27

# Group enable toggle

Audience: hybrid

## Architecture note

- The editor draws an Enable/Disable button on the open group heading only when the host passes `EditorOptions.groupEnablement`. The CLI omits that port.
- The extension still sends `set-group-enabled`. Enablement stays out of the project draft.
- A group enablement refresh does not remount the editor. The heading button, the open route, and a dirty draft all stay. Sidebar, badge, and status still refresh.
- The popup replaces the checkbox with a labeled Enable/Disable button. Group status stays a separate element.
- Runtime start/stop and request-body activation are unchanged.

Rejected: injecting the button from the extension into editor DOM. The heading is editor-owned, so the host callback is the stable seam.

## Plan

1. Editor port, heading button, and `syncGroupEnablement`. Covers AC-002, AC-003, AC-005. Proof: `packages/editor/test/editor.test.ts`.
2. Extension wires the port, removes the sidebar Group activation list, and skips editor remount. Covers AC-001, AC-004, AC-009. Proof: extension unit test plus Workspace browser tests.
3. Popup button, separate status pill, and click that does not toggle the details row. Covers AC-006, AC-007, AC-008. Proof: popup browser test.
4. Update Workspace and real-extension browser tests that still drive a checkbox.
5. Update living docs: architecture, README, overview, sample, and extension guides. `set-group-enabled` stays (AC-010).
