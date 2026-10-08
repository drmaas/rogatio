# In-UI doctor checks — specification

> Audience: hybrid
> Status: approved with the implementation (issue #319). The repository owner asked to start the issue, which is the approval gate for this spec.
> Issue: [#319](https://github.com/drmaas/rogatio/issues/319)

## 1. Problem and goals

`rogatio doctor` and the extension **Run checks** action report the six host checks from `@rogatio/runtime`. Failures that only the browser or the `rogatio edit` page can see are collapsed into one host-unreachable line, or they are not checked at all.

**Goals**

- **Run checks** on the popup, the sidebar runtime card, and the dashboard runtime block shows browser checks first, then the host report unchanged.
- The `rogatio edit` page has its own **Run checks** action and a CSRF-protected `POST /api/doctor`.
- **Copy diagnostics** writes one JSON document. The nested `host` object is the CLI report.
- Checks run only when the user clicks. No telemetry and no timers.

## 2. Scope and non-goals

### In scope

- Extension checks `ext.worker`, `ext.native`, `ext.id`, `ext.version`, `ext.proxy`, `ext.access`, `ext.rules`, `ext.incognito`, and popup-only `ext.tab`.
- Editor checks `editor.server`, `editor.session`, `editor.project`, `editor.ai`, and optional `editor.mockRoot`.
- Additive `cliVersion` on the `runtime.doctor` reply, beside `report`.
- Combined diagnostics JSON, redaction, the bug-form field, and the user docs.

### Non-goals

- Changing the six CLI check ids, their fix strings, the `--json` schema, or the exit codes.
- Changing Chrome proxy settings, or applying a fix automatically.
- New extension permissions.
- Live match history.
- Background or periodic checks.
- Extension checks inside the extension Workspace editor. That surface uses the extension doctor.

## 3. Package boundary

```
schema → compiler → runtime → cli (edit server, POST /api/doctor)
                         ↑
                    native host (report + cliVersion)
                         ↑
                    extension service worker (UI checks + dry-run)
                         ↑
                    popup / management page (render only)
```

The extension does not import `@rogatio/runtime`. Popup and management-page bundles do not import `@rogatio/dry-run` or Ajv. Dry-run for `ext.tab` stays in the service worker. The editor package is unchanged. The `rogatio edit` page script talks only to its loopback server.

## 4. Permission audit

No manifest permission is added. `packages/extension/public/manifest.json` `permissions` stay:

`storage`, `declarativeNetRequest`, `declarativeNetRequestFeedback`, `scripting`, `nativeMessaging`, `proxy`.

`host_permissions` stays `["*://*/*"]`. There is no `tabs` permission and no `optional_host_permissions`.

| Call | Why it needs nothing new |
| --- | --- |
| `chrome.permissions.contains` | Reads granted permissions. |
| `chrome.proxy.settings.get` | `proxy` is already granted. |
| `chrome.runtime.getManifest` | Extension API. |
| `chrome.extension.isAllowedIncognitoAccess` | Extension API. |
| `chrome.tabs.query({ active: true, currentWindow: true })` | Allowed without the `tabs` permission. `url` is present only when host access already covers the tab. |

`packages/extension/test/manifest.test.ts` asserts that permission list exactly.

## 5. Extension checks

Checks run in this order. A check that does not apply is omitted. `optional: false` with status `fail` makes the combined `ok` false. A `warn` does not.

| Order | id | Title | optional | When |
| --- | --- | --- | --- | --- |
| 1 | `ext.worker` | Service worker | false | Always, from the page |
| 2 | `ext.native` | Native connection | false | The service worker answered |
| 3 | `ext.id` | Extension ID | true | The service worker answered |
| 4 | `ext.version` | Version | true | The service worker answered |
| 5 | `ext.proxy` | Proxy | false | The service worker answered |
| 6 | `ext.access` | Site access | false | The service worker answered |
| 7 | `ext.rules` | Rules | false | The service worker answered |
| 8 | `ext.incognito` | Incognito | true | The service worker answered |
| 9 | `ext.tab` | Current tab | true | Popup only |

Titles are fixed. The line format matches the CLI: `status  Title  summary`, then `Fix: <fix>` when `fix` is not null. Rendering uses `textContent`.

### 5.1 Service worker

The page records this check. The service worker cannot record its own absence.

| Result | Status | Summary | Fix |
| --- | --- | --- | --- |
| `run-doctor` returned a report | `pass` | `The extension service worker answered.` | none |
| `client.send` threw, or the reply was not a report | `fail` | `The extension service worker did not answer.` | `Reload the extension at chrome://extensions` |

When the service worker does not answer, the report is only this check and `host` is null. The page does not invent `ext.native` or the six host rows.

### 5.2 Native connection

The service worker classifies the failure. Chrome's error text is not copied. Recognized codes:

| Code | Summary | Fix |
| --- | --- | --- |
| `ok` | `The native host answered.` | none |
| `host-missing` | `Native host manifest was not found. Reload the extension after installing the host.` | `runtimeInstallCommand(id)` |
| `origin-forbidden` | `This extension ID is not in the native host manifest allowed_origins. Reload the extension after installing the host.` | `runtimeInstallCommand(id)` |
| `timeout` | `The native host did not answer within 25000ms.` | `rogatio doctor` |
| `disconnected` | `The native host disconnected before answering.` | `rogatio doctor` |
| `unreadable` | `The native host reply could not be read.` | `rogatio doctor` |

`host-missing` is `extension.native-host-missing`, a missing `send` port, or a Chrome "native messaging host not found" message. `origin-forbidden` is `extension.native-host-origin-forbidden` or `isNativeHostOriginForbiddenMessage`. `timeout` is only the extension's own `Native messaging host timed out before responding.` Any other text, including a Chrome message that contains a secret, is `disconnected` and is not stored.

`runtimeInstallCommand` is the existing helper. The release id fixes to `rogatio runtime install`. A 32-character `a`–`p` id fixes to `rogatio runtime install --extension-id <id>`. Any other id fixes to `rogatio runtime install --extension-id <extension ID>` and the raw value is not inserted.

`host` is the parsed six-check report only when the code is `ok`. A one-check payload is not nested.

### 5.3 Extension ID

| `chrome.runtime.id` | Status | Summary |
| --- | --- | --- |
| `RELEASE_EXTENSION_ID` | `pass` | `This is the release extension.` |
| other id matching `^[a-p]{32}$` | `warn` | `This is a development or fork build (<id>).` |
| anything else | `warn` | `Extension ID is unavailable.` |

`fix` is null. The id is inserted only when it matches the grammar.

### 5.4 Version

The host adds `cliVersion` next to `report` when the value is exactly `major.minor.patch` (`^(\d+)\.(\d+)\.(\d+)$`). Any other string is omitted. The report object is unchanged.

The extension version is `chrome.runtime.getManifest().version`, accepted only when it matches that same grammar. A version is never copied into a fix unless the whole string matches.

| Versions | Status | Summary | Fix |
| --- | --- | --- | --- |
| CLI missing or rejected | `warn` | `CLI version is unavailable.` | none |
| either side rejected | `warn` | `Extension and CLI versions could not be compared.` | none |
| equal | `pass` | `Extension <v> matches CLI <v>.` | none |
| CLI older | `warn` | `CLI <cli> is older than extension <ext>.` | `npm install -g @rogatio/cli@<ext>` |
| extension older | `warn` | `Extension <ext> is older than CLI <cli>.` | `Install the Rogatio extension release that matches CLI <cli>.` |

### 5.5 Proxy

`chrome.proxy.settings.get` supplies `levelOfControl` and `value.mode`. The runtime phase is the extension's phase. The error string from `chrome.runtime.lastError` is not stored.

| Condition | Status | Summary | Fix |
| --- | --- | --- | --- |
| settings could not be read | `warn` | `Chrome proxy settings could not be read.` | none |
| phase `started` or `failed`, and `controlled_by_other_extensions` | `fail` | `Another extension controls the proxy.` | `Disable the other proxy/VPN extension, then click Start runtime.` |
| phase `started` or `failed`, and `not_controllable` | `fail` | `The proxy is set by policy.` | none |
| phase `started` and `controllable_by_this_extension` | `fail` | `Runtime is started, but this extension does not control the proxy.` | `Click Stop runtime, then Start runtime.` |
| phase `started` and `controlled_by_this_extension` | `pass` | `This extension controls the proxy.` | none |
| phase `stopped`, this extension still has `mode: pac_script` and `controlled_by_this_extension` | `warn` | `A Rogatio PAC script is still set after the runtime stopped.` | `Click Start runtime, then Stop runtime.` |
| otherwise, including `starting` and a `failed` phase that this extension still controls | `pass` | `Chrome proxy settings do not block Rogatio.` | none |

Doctor does not call `settings.set` or `settings.clear`.

### 5.6 Site access

| `chrome.permissions.contains({ origins: ["*://*/*"] })` | Status | Summary | Fix |
| --- | --- | --- | --- |
| true | `pass` | `Site access includes all sites.` | none |
| false | `warn` | `Site access is narrower than all sites.` | `chrome://extensions → Rogatio → Site access → On all sites` |
| unavailable | `warn` | `Site access could not be checked.` | none |

### 5.7 Rules

Read-only. Doctor does not install or remove DNR rules. Status values other than `error`, `needs runtime`, `needs root directory`, and `unsupported` are not copied into the summary. A rule id is shown only when it matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; otherwise the text says `a rule`.

| Condition | Status | Summary | Fix |
| --- | --- | --- | --- |
| no active project | `warn` | `No active project is loaded.` | none |
| statuses could not be read | `warn` | `Rule statuses could not be read.` | none |
| no enabled group | `warn` | `The active project has no enabled groups.` | `Enable a group.` |
| no attention status | `pass` | `Enabled rules have no attention status.` | none |
| one or more `error` | `fail` | counts, then `First problem: <id> (<status>).` | `Open the rule and read its error.` |
| otherwise | `warn` | the same count sentence | `Click Start runtime.` for needs runtime, except when the phase is `started`: `This rule's source can't be routed.` `Set mock file root.` for a mock root. `This rule is unsupported in this browser.` for unsupported |

Counts use `1 error` / `N errors`, `1 needs runtime` / `N need runtime`, `1 needs a mock file root` / `N need a mock file root`, and `1 unsupported` / `N unsupported`, in that order, joined by `, ` and ending with `.`. Precedence for the fix and the first problem is error, needs runtime, needs root directory, unsupported. A `needs runtime` status while the phase is `started` is a request-body source the proxy cannot steer. The fix does not tell the user to start the runtime.

### 5.8 Incognito

| `chrome.extension.isAllowedIncognitoAccess()` | Status | Summary | Fix |
| --- | --- | --- | --- |
| true | `pass` | `Incognito access is allowed.` | none |
| false | `warn` | `Incognito windows are not covered. The PAC is installed for regular windows only.` | `chrome://extensions → Rogatio → Allow in Incognito` |
| unavailable | `warn` | `Incognito access could not be checked.` | none |

The PAC install scope stays `regular`. This check does not change it.

### 5.9 Current tab (popup)

The service worker queries the active tab and dry-runs `{ url, method: "GET", resourceType: "main_frame" }` with the existing `runExtensionDryRun`. The URL is not sent to the host, the page, or the report. Dimension `detail` strings are not copied. A missing URL is `warn`, summary `The current tab has no URL this extension can read.` A dry-run that cannot run is `warn`, summary `The current tab could not be checked.`

A completed check is `pass` and optional. The summary lists:

- `Matches: <id>, <id>.` for matches whose group is enabled and whose status is not an attention status.
- `Does not match: <id> (source <state>, method <state>, resourceType <state>).` for every other non-match. States are `matched`, `unmatched`, or `not tested`.
- `<id> matches but its group is disabled.`
- `<id> matches but its status is <status>.` for an attention status.

At most 12 rules are named, then `N more.` An empty project says `No rules to compare with this tab.`

Sidebar and dashboard omit `ext.tab`.

## 6. Editor checks

The `rogatio edit` page adds a Project details action **Run checks**. The extension Workspace does not.

| Order | id | Title | optional |
| --- | --- | --- | --- |
| 1 | `editor.server` | Editor server | false |
| 2 | `editor.session` | Editor session | false |
| 3 | `editor.project` | Draft | false |
| 4 | `editor.ai` | AI Assist | true |
| 5 | `editor.mockRoot` | Mock file root | true |

`editor.mockRoot` is omitted when the draft has no rule whose `type` is `mock`. The walker does not read `mock` bodies.

### 6.1 Server and session

These two are known only to the page.

| Result | Checks |
| --- | --- |
| `fetch` throws | only `editor.server` `fail`, summary `The editor server stopped.`, fix `rogatio edit <path>` quoted for the editor server's platform. `host` is null. |
| HTTP 403 and body `code` is `csrf-invalid` | `editor.server` `pass` `The editor server answered.`, then `editor.session` `fail` `This tab is stale. Its editor token was rejected.` fix `Reload this tab`. `host` is null. |
| any other non-OK response | `editor.server` `fail` `The editor server could not finish doctor.` fix `rogatio doctor`. The response body is not copied. |
| HTTP 200 | the server's combined report, which includes `editor.server` `pass` and `editor.session` `pass` `The editor token was accepted.` |

The path is the open file. On Windows the argument is wrapped in double quotes, with an embedded `"` written as `""` and an embedded `%` written as `%%`. On every other platform `quoteDoctorArg` wraps values that are not a bare shell word. The page embeds that already-quoted fix. It does not build a shell command itself. The six host checks still use `quoteDoctorArg` on every platform.

### 6.2 Draft

`POST /api/doctor` validates the JSON body with `diagnoseProject`. At most 20 lines of `path: message (code)` are included. Control characters are replaced. The thrown parser message is not copied.

| Result | Status | Summary | Fix |
| --- | --- | --- | --- |
| body is not JSON | `fail` | `The draft is not JSON.` | `rogatio verify <path>` |
| diagnostics | `fail` | `The draft is invalid.` plus the lines | `rogatio verify <path>` |
| none | `pass` | `The draft is valid.` | none |

### 6.3 AI Assist

`!!context.aiClient` is the flag baked into the page. `readProviderConfig()` is the config now. The config object is not copied.

| Page | Config now | Status | Summary | Fix |
| --- | --- | --- | --- | --- |
| no | no | `warn` | `Optional. No AI provider is configured.` | `rogatio ai setup` |
| no | yes | `warn` | `AI Assist was configured after this editor started.` | `Restart rogatio edit` |
| yes | yes | `pass` | `AI Assist is available in this page.` | none |
| yes | no | `warn` | `AI Assist is no longer configured.` | `rogatio ai setup` |

A throw while reading the config counts as not configured.

### 6.4 Mock file root

| Saved root | Status | Summary | Fix |
| --- | --- | --- | --- |
| yes | `pass` | `A mock file root is saved.` | none |
| no | `warn` | `Mock rules have no saved mock file root.` | `Set mock file root` |

The saved path is not included. A read throw counts as not saved.

### 6.5 `POST /api/doctor`

CSRF is required, the same `X-CSRF-Token` check as `/api/save`. A missing or wrong token is `403` `{ "code": "csrf-invalid" }` and does not run doctor.

The handler calls `runInstalledDoctor` with `source: "file"`, `context.filePath`, and `checkUpdates: false`. The returned report is nested as `host` without adding or removing checks. A throw becomes `doctorInterruptedReport()` so the page still receives six host checks and no thrown message.

The draft in the body is used for `editor.project` and `editor.mockRoot` only. It is not passed to `runInstalledDoctor`.

## 7. Combined JSON

UTF-8, two-space indent, trailing newline. Key order:

```json
{
  "version": 1,
  "surface": "extension",
  "ok": false,
  "ui": {
    "checks": [
      {
        "id": "ext.proxy",
        "status": "fail",
        "optional": false,
        "summary": "Another extension controls the proxy.",
        "fix": "Disable the other proxy/VPN extension, then click Start runtime."
      }
    ]
  },
  "host": {
    "version": 1,
    "ok": true,
    "exitCode": 0,
    "checks": []
  }
}
```

- `surface` is `extension` or `editor`.
- `ok` is false when a required UI check failed or when `host` is a report whose `ok` is false.
- Each UI check uses the keys `id`, `status`, `optional`, `summary`, `fix`, in that order. `fix` is a string or `null`. `status` is `pass`, `warn`, or `fail`.
- `host` is null when the host did not answer. Otherwise `JSON.stringify(host, null, 2)` plus a trailing newline equals `serializeDoctorReport` of that report. `parseDoctorReport`, the CLI schema, and the CLI exit codes are unchanged.
- There is no timestamp, tab URL, project body, API key, provider URL, or raw error string.

**Copy diagnostics** on the extension report, and on the editor page, writes this document. The Runtime Diagnostics modal copies it after **Run checks** has produced one, and otherwise keeps its plain-text copy.

## 8. Redaction

| Data | Rule |
| --- | --- |
| Tab URL, path, and query | Used only inside the service worker for the dry-run. Absent from the report and from the host request. |
| Project body and other project fields | Not copied. Draft diagnostics may include a schema path and message, capped and stripped of control characters. |
| API key and provider URL | Not copied. AI checks say whether a config exists. |
| Chrome, socket, and parser errors | Mapped to a fixed summary. The original text is not stored. |
| Extension id | Included only when it matches `^[a-p]{32}$`. |
| Versions | Included only when they match `^(\d+)\.(\d+)\.(\d+)$`. |
| Rule id | Included only when it matches the schema id grammar above. |

## 9. Network

| Call | When |
| --- | --- |
| Native host `runtime.doctor` | Extension **Run checks** click. `checkUpdates` stays false. |
| Configured AI provider | Only the existing host `ai` check, unchanged. |
| `POST /api/doctor` on `127.0.0.1` | Editor **Run checks** click. |

No registry call from either UI. No timer.
