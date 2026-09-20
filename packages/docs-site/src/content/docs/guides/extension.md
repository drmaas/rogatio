---
title: Chrome extension
description: Import, export, switch, grant, and activate Rogatio projects in Chrome.
---

The Chrome MV3 extension is the browser boundary for Rogatio. It translates neutral rules
to WebExtensions Declarative Net Request (DNR) rules and manages project lifecycle.

## Project management

- **Create, import/update, switch, edit, export, and remove** projects from the extension
  management page.
- Merely choosing a project in the selector has no effect until you select **Switch
  project**.
- Creation, import/update, and browser save leave every group disabled.

The toolbar **popup** lists the active project's saved groups with one enable/disable
switch each, truthful runtime status, **Match logging**, **Open app** (management page
Overview / Dashboard), and a pencil that opens the management page on that group. It also
offers **New project** (inline name form) and **Import project** (file picker). The popup
has no editor, search, proxy, permission, or rule-authoring controls.

The management page uses a **Dashboard** overview and a **Workspace** editor shell. When a
rule fails to install, the status word `error` is an activatable control that opens that
rule in the workspace, and a distinct error card shows the concrete install failure reason.

## Permissions and activation

- Importing a project lets you **review** the complete project and **grant** only its
  declared site access. Permission requests never include undeclared origins or broad host
  patterns.
- **Group activation** is kept separate from permission. Activating a group does not grant
  permission; granting permission does not activate a group.

## Rule status and badge

Rules report `active`, `disabled`, `needs permission`, `needs runtime`,
`unsupported`, or `error`. Body rules report `needs runtime` until the native runtime
is started. The toolbar badge reflects the successfully installed active rules. Actionless
matcher operations are reported as `unsupported` and are not installed until a later
action slice defines their DNR action.

## Match logging

When Chrome authoritatively reports a Rogatio-installed DNR rule match, the extension can
inject one bounded, redacted, live-only lowercase `[rogatio]` line into the matched page's
DevTools Console. Turn logging on or off with the **Match logging** checkbox in the toolbar
popup and the management sidebar (default **on** when the setting has never been changed).

Match logging requires an **unpacked** extension load. Chrome fires the underlying
`onRuleMatchedDebug` event (granted by the `declarativeNetRequestFeedback` permission) only
for unpacked extensions, so no lines appear under packed or store distribution.

**Coverage:** redirect, query, and header rules. Matcher and body rules are not logged
(body-rule match logging is tracked in [GitHub issue #163](https://github.com/drmaas/rogatio/issues/163)).

**Live vs intended:** the line labels present fields (`method=`, `type=`, `url=`,
`ruleId=`, `name=`, `kind=`, `initiator=`) with live URL, method, initiator, and resource
type from the Chrome match event, plus rule id, display name (when set), kind, and the
**intended** redirect destination, query transform, or header operation from your rule
config. Absent fields omit their key. It reports a **match** and **intended action** — not
proof the network operation succeeded. Request and response bodies are **not** logged; neither
are wire-applied header values.

**Redaction:** on non-body rule cards, optional **Redact sensitive fields in logs** (default
off) applies a deny-list to sensitive query and header values when enabled. URLs are always
stripped of userinfo and fragments and truncated per field.

**Limitations:** logging is skipped when Chrome supplies `tabId === -1`, when the top-level tab
URL is outside granted origins (even if a granted-origin subresource matched), or when
injection into that tab fails. Iframe/subframe matches depend on Chrome supplying a real tab
id and successful top-frame injection. Matches that arrive while Chrome has the extension's
service worker terminated and does not wake it are dropped; no keepalive is used.

No match history or management-page feed is created.

See [Platforms & capabilities](/reference/platforms/) for where each rule type runs.
