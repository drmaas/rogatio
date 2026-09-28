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
- Enabling a group and **Start runtime** are separate, visible actions. The Workspace group heading has an **Enable** / **Disable** button. The toolbar popup uses the same words, with group status as its own indicator.
- **Switching** restores the destination project's saved enablement without contacting a
  runtime.
- Conflicts preserve committed state and provide an explicit refresh path.
- Removal uses a named, cancelable confirmation.

## Groups

Groups organize rules. Matching scope is expressed per rule through a **source condition**.

## Rules

Every rule can specify:

- A stable **ID**. You do not write this: the editor derives it from the name when the rule
  is created or copied, and keeps it for the rule's lifetime.
- A **name**, unique across every group and rule in the project.
- A **source condition**: `key` (`url` or `host`), `operator` (`regex` only), and `value`
  (case-sensitive regular expression).
- Allowed **resource types**.
- A **priority**.
- Where supported, an HTTP **method**.
- **Redact sensitive fields in logs** (default off), which applies a deny-list to
  sensitive query, header, and intended body-rewrite values in
  [match logging](/guides/extension/#match-logging).

Rules visibly report one of: `active`, `disabled`, `needs runtime`, `unsupported`, or
`error`. Response-body rules match their URL regex in the browser and report
`needs runtime` until the native runtime is started, then `active`. Request-body rules
report `active` after start when the regex names one literal host
(`^https://api.example.com/`, escaped dots, a slash after the host, no top-level `|`).
A request-body regex that does not name one literal host stays `needs runtime`. The toolbar badge reflects the count of successfully installed
active rules.

See the [rules reference](/rules/redirects/) for each rule type's behavior.
