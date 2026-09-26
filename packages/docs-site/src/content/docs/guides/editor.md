---
title: Using the editor
description: The shared framework-free Rogatio editor for editing, validating, and saving projects.
---

The CLI (`rogatio edit`) and the Chrome extension share one accessible, framework-free
editor.

## Editing

- Edit project metadata.
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
  group sit next to their section or entity.
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
