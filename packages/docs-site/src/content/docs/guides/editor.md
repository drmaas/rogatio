---
title: Using the editor
description: The shared framework-free Rogatio editor for editing, validating, and saving projects.
---

The CLI (`rogatio edit`) and the Chrome extension share one accessible, framework-free
editor.

## Editing

- Edit project metadata.
- Rename a group or rule on its own heading: click the pencil, type, then save with the check mark or `Enter`. Cancel with the cross or `Escape`.
- Create, copy, reorder, and remove rules; create, copy, and remove groups (groups are selected from the rail, not reordered).
- Convert URLs to exact-match regular expressions.
- Validate, save, or cancel unsaved changes.
- Inspect field-level errors.

## Navigation and accessibility

- In the CLI editor and extension Workspace: project destination, one destination per
  group, **Test console**, and project-wide group/rule **search**.
- The extension management shell also provides a **Dashboard** overview (including **Create using AI** when the native runtime is started and a provider is configured via `rogatio ai`) and a **Workspace** for rule editing. Workspace **AI Assist** uses the same native-host path when available; the CLI editor uses `rogatio edit`'s local `/api/ai/assist` route instead. When the draft has validation errors, AI Assist sends a **fix** request: the returned proposal repairs the offending rules in place (keeping their rule ids and positions) and the host validates the repaired project before accepting it — the extension rejects proposals that do not repair the project (`extension.ai-invalid-proposal`). Otherwise the proposal's rules are appended as new rules.
- A contextual command bar (Validate / Save / Cancel and route actions) and a desktop route
  rail; a compact mobile navigation. Add/copy rule, rule reorder/remove, and Copy/Remove
  group sit next to their section or entity. The same project and group actions repeat in a
  labeled ledger under the last rule, under the group list, or under the test results.
- Group and rule **names are unique per project**: a group and a rule cannot share a name, and names that differ only by case or spacing count as the same. A duplicate is refused where you typed it, and the message names the entity that already holds the name.
- **IDs are managed for you.** A group's and a rule's ID stay in your `.rogatio.json` file and are derived from the name at the moment the entity is created or copied, but you never see, type, or change one. Renaming a group or rule does not change its ID, so links, installed rules, and enablement survive a rename. If a hand-written file has a duplicate or malformed ID, the error list offers **Assign a new ID**.
- Full keyboard use, screen-reader support, forced-colors support, and 200% zoom support.

## Validate and save

`validate` checks the current draft and renders sorted, stable diagnostics without saving.
`save` validates first, then writes the project. `cancel` requires confirmation when there
are unsaved changes and restores the committed snapshot.

The editor does not evaluate user regular expressions, contact a network, access a
filesystem, request permissions, or emit telemetry. Defensive snapshots reject hostile
objects (proxies, accessors, cycles) without invoking them.

See also [`rogatio verify`](/reference/cli/#verify) for offline file validation outside the
editor.
