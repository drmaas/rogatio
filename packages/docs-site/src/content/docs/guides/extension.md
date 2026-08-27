---
title: Chrome extension
description: Import, export, switch, grant, and activate Rogatio projects in Chrome.
---

The Chrome MV3 extension is the browser boundary for Rogatio. It translates neutral rules
to WebExtensions Declarative Net Request (DNR) rules and manages project lifecycle.

## Project management

- **Create, import/update, switch, edit, export, and remove** projects from the extension
  selector.
- Merely choosing a project in the selector has no effect until you select **Switch
  project**.
- Creation, import/update, and browser save leave every group disabled.

## Permissions and activation

- Importing a project lets you **review** the complete project and **grant** only its
  declared site access. Permission requests never include undeclared origins or broad host
  patterns.
- **Group activation** is kept separate from permission. Activating a group does not grant
  permission; granting permission does not activate a group.

## Rule status and badge

Rules report `active`, `disabled`, `needs permission`, `needs proxy`, `unsupported`, or
`error`. The toolbar badge reflects the successfully installed active rules. Actionless
matcher operations are reported as `unsupported` and are not installed until a later
action slice defines their DNR action.

## DevTools Console record

Chrome can place one bounded, redacted, live-only `[Rogatio]` record in the matched
website's DevTools Console when Chrome authoritatively reports a current Rogatio DNR match.
It shows the intended action — not proof that the network operation succeeded — and creates
no history or management-page feed.

See [Platforms & capabilities](/reference/platforms/) for where each rule type runs.
