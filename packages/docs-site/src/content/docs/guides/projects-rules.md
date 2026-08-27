---
title: Projects & rules
description: How Rogatio organizes projects, groups, and rules in .rogatio.json.
---

Rogatio stores everything in a single version-controlled `.rogatio.json` file. The file is
the source of truth; the browser holds a copy that you import or export explicitly.

## Projects

A project has metadata (name, description) and a set of **groups**. Each browser profile
can retain up to **64 uniquely named projects** and has exactly **one active project**
whenever any exist.

- Creation, import/update, and browser save leave every group **disabled**.
- Permission and group activation are separate, visible actions.
- **Switching** restores the destination project's saved enablement without requesting
  permission or contacting a runtime.
- Conflicts preserve committed state and provide an explicit refresh path.
- Removal uses a named, cancelable confirmation.

## Groups

Groups organize rules and can define shared **site origins** that their rules inherit.
Origins must be explicit `http`/`https` origins — credentials, paths, query strings,
fragments, wildcard hosts, and other schemes are rejected.

## Rules

Every rule can specify:

- A stable **ID**.
- A **label**.
- A case-sensitive **URL regular expression**.
- Optional **origins** (added on top of the group's).
- Allowed **resource types**.
- A **priority**.
- Where supported, an HTTP **method**.

Rules visibly report one of: `active`, `disabled`, `needs permission`, `needs proxy`,
`unsupported`, or `error`. The toolbar badge reflects the count of successfully installed
active rules.

See the [rules reference](/rules/redirects/) for each rule type's behavior.
