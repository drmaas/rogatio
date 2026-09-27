> Status: frozen 2026-09-27

# Group enable toggle notes

Audience: hybrid

Enable and disable a group from the group heading and from the toolbar popup. Drop the Workspace sidebar list labeled Group activation.

## Acceptance checks

- AC-001. Workspace sidebar has no Group activation list.
- AC-002. The open group heading shows a primary Enable or Disable button. The label is Enable when the group is off and Disable when it is on.
- AC-003. The button calls the host and does not mark the editor draft dirty.
- AC-004. A dirty draft stays mounted. The heading label updates after the toggle. The open group route stays open.
- AC-005. Hosts that omit `groupEnablement`, including the CLI editor, show no button.
- AC-006. The popup control is a button whose visible text is Enable or Disable.
- AC-007. Popup group status is a separate indicator, not the button label.
- AC-008. Clicking the popup button does not open or close the group details.
- AC-009. Workspace status text says enabled or disabled.
- AC-010. The `set-group-enabled` command is unchanged. Create, import, and save still leave groups disabled. Start runtime stays a separate control.

## Assumptions

- The button belongs on the open group heading, not on every group-list row.
- Other groups are enabled from the popup, or by opening that group.
- Frozen decision records stay frozen. Living docs describe the new control.
