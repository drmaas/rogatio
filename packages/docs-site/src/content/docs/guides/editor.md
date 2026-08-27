---
title: Using the editor
description: The shared framework-free Rogatio editor for editing, validating, and saving projects.
---

The CLI (`rogatio edit`) and the Chrome extension share one accessible, framework-free
editor.

## Editing

- Edit project metadata.
- Create, reorder, and remove groups and rules.
- Convert URLs to exact-match regular expressions.
- Validate, save, or cancel unsaved changes.
- Inspect field-level errors.

## Navigation and accessibility

- Project destination, one destination per group, and project-wide group/rule **search**.
- A contextual command bar and a desktop route rail; a compact mobile navigation.
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
