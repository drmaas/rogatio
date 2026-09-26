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
- Group activation and **Start runtime** are separate, visible actions.
- **Switching** restores the destination project's saved enablement without contacting a
  runtime.
- Conflicts preserve committed state and provide an explicit refresh path.
- Removal uses a named, cancelable confirmation.

## Groups

Groups organize rules. Matching scope is expressed per rule through a **source condition**.

## Rules

Every rule can specify:

- A stable **ID**.
- A **label**.
- A **source condition**: `key` (`url` or `host`), `operator` (`regex` only), and `value`
  (case-sensitive regular expression).
- Allowed **resource types**.
- A **priority**.
- Where supported, an HTTP **method**.
- **Redact sensitive fields in logs** (default off), which applies a deny-list to
  sensitive query, header, and intended body-rewrite values in
  [match logging](/guides/extension/#match-logging).

Rules visibly report one of: `active`, `disabled`, `needs runtime`, `unsupported`, or
`error`. Runtime-dependent body rules report
`needs runtime` until the native runtime is started. The toolbar badge reflects the count of successfully installed
active rules.

See the [rules reference](/rules/redirects/) for each rule type's behavior.
