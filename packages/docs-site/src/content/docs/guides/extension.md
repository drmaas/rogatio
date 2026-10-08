---
title: Chrome extension
description: Import, export, switch, and enable groups in Chrome.
---

The Chrome MV3 extension is the browser boundary for Rogatio. It translates neutral rules
to WebExtensions Declarative Net Request (DNR) rules and manages project lifecycle.

## Project management

- **Create, import/update, switch, edit, export, and remove** projects from the extension
  management page.
- Merely choosing a project in the selector has no effect until you select **Switch
  project**.
- Creation, import/update, and browser save leave every group disabled.
- **Import** accepts any filename, including a file with no extension. Rogatio decides by the file contents. A file that is not a project fails with `not a Rogatio project: <reason>`.
- **Export** opens a save dialog filled in with `.rogatio.json`. You can change the name and folder (for example `staging.json`). `.rogatio.json` is the name `rogatio verify` finds when you run it with no path. If the save dialog is unavailable, Rogatio asks for a filename and downloads that file, appending `.json` only when you type no extension.

The toolbar **popup** lists the active project's saved groups. Each row has the group
name, a separate status indicator, a prominent **Enable** or **Disable** button, and a
pencil that opens the management page on that group. The popup also has **Match logging**,
**Open app** (management page Overview / Dashboard), **New project** (inline name form),
**Import project** (a file picker that accepts any filename), and **Run checks**. The popup has no editor, search, proxy, permission,
or rule-authoring controls.

The management page uses a **Dashboard** overview and a **Workspace** editor shell. The
Workspace breadcrumb is the editor's project name and group link. The group link opens a
picker. **Refresh**, **Export project**, and **Remove project** sit on Project details.
**Mock files** sits there too. **Choose folder** opens a system directory dialog through the runtime host, and a pasted path must be a full path to an existing folder. A relative path is rejected next to the field.
The Active rules label sits on the Rules card. The Dashboard keeps its project cards and
does not show this breadcrumb.

The Workspace sidebar is a set of cards. **Runtime** holds Start/Stop, **Run checks**, the runtime status, the
extension ID, and a **Show diagnostics** control when the runtime has failed. **Run checks** asks the native host for the same report as `rogatio doctor` (Node, project, host manifest, device CA, a loopback PAC answer, and optional AI Assist). The dashboard runtime block and the toolbar popup use that same action. When Chrome
rejects the native host because that ID is not in `allowed_origins`, the card names the
mismatch and shows the `rogatio runtime install` command that re-pins it. **AI** reports
whether AI is configured: `Configured` with the provider URL and model the native host will
use (the API key never reaches the extension), `Not configured`, `not reported` against an
older runtime host, or `needs runtime` before the runtime starts. **Rules** starts with the Active rules label, then lists every rule
with its install status; each rule is a
link that opens that rule in the editor, and a rule that failed to install also selects a
card showing the concrete install failure reason. **Match logging** sits in the **Rules**
card.

## Host access and enablement

- The extension declares broad host access (`*://*/*`) at install time so DNR rules can
  match any HTTP(S) URL your projects describe. There is no per-origin grant UI.
- **Enable** / **Disable** on the Workspace group heading is separate from **Start
  runtime**. Enabling a group installs DNR rules; starting the native runtime is required
  for body rules. The left sidebar does not list group on/off controls.

## Rule status and badge

Rules report `active`, `disabled`, `needs runtime`, `needs root directory`, `unsupported`, or `error`. Response-body rules match their URL regex in the browser and report `needs runtime` until the native runtime
is started, then `active`. A file mock reports `needs root directory` until a mock files folder is saved, then `needs runtime` until the runtime is started, then `active`. Saving or clearing that folder while the runtime is already running updates the live host; a restart is not required. An inline mock body does not need a folder. Request-body rules report `active` after start when the regex names one literal host (`^https://api.example.com/`, escaped dots, a slash after the host, no top-level `|`). A request-body regex that does not name one literal host stays `needs runtime`. The toolbar badge reflects the successfully installed active rules. Actionless
matcher operations are reported as `unsupported` and are not installed until a later
action slice defines their DNR action.

## Match logging

When Chrome authoritatively reports a Rogatio-installed DNR rule match, the extension can
inject one bounded, redacted, live-only lowercase `[rogatio]` line into the matched page's
DevTools Console. Turn logging on or off with the **Match logging** checkbox in the toolbar
popup and in the management page's **Rules** card (default **on** when the setting has never
been changed).

Match logging requires an **unpacked** extension load. Chrome fires the underlying
`onRuleMatchedDebug` event (granted by the `declarativeNetRequestFeedback` permission) only
for unpacked extensions, so no lines appear under packed or store distribution.

**Coverage:** redirect, query, and header rules, plus body (`request-body` /
`response-body`) when session URL-match markers are installed and indexed on the same
`onRuleMatchedDebug` pipeline; matcher rules are not logged. Body markers install only
while a native session is active and the runtime strip path is available — production
keeps that strip gate fail-closed (`false`) until live traffic hits strip, so body kinds
stay silent until the gate flips. When a body line does appear, it means URL match ⇒ will
attempt rewrite — not rewrite success. Native-host events are never a match-logging
source.

**Live vs intended:** the line labels present fields (`method=`, `type=`, `url=`,
`ruleId=`, `name=`, `kind=`, `initiator=`) with live URL, method, initiator, and resource
type from the Chrome match event, plus rule id, display name (when set), kind, and the
**intended** redirect destination, query transform, header operation, or body rewrite
summary from your rule config. Absent fields omit their key. It reports a **match** and
**intended action** — not proof the network operation succeeded. Live request and response
bodies are **not** logged; neither are wire-applied header values.

**Redaction:** on any rule card, optional **Redact sensitive fields in logs** (default
off) applies a deny-list to sensitive query, header, and intended body-rewrite values when
enabled. URLs are always stripped of userinfo and fragments and truncated per field.

**Limitations:** logging is skipped when Chrome supplies `tabId === -1`, when
injection into that tab fails, or when body markers were not installed (no strip path /
fail-closed gate). Iframe/subframe matches depend on Chrome supplying a real tab
id and successful top-frame injection. Matches that arrive while Chrome has the extension's
service worker terminated and does not wake it are dropped; no keepalive is used.

No match history or management-page feed is created.

See [Platforms & capabilities](/reference/platforms/) for where each rule type runs.
