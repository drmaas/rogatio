# `rogatio doctor` — specification

> Audience: hybrid
> Status: approved with the implementation (issue #264). The repository owner asked to implement the issue, which is the approval gate for this spec.
> Issue: [#264](https://github.com/drmaas/rogatio/issues/264)

## 1. Problem and goals

Getting body rules working depends on Node, the CLI, a project file, the native-host manifest, the device CA, a runtime that can answer PAC, and optionally AI Assist. `rogatio runtime verify` covers the manifest and the CA. It does not answer "why isn't my rule applying?" in one place.

**Goals**

- `rogatio doctor [path]` runs six checks in a fixed order and prints `pass`, `warn`, or `fail` with one copy-paste fix for each problem.
- `rogatio doctor --json` prints a stable report.
- The extension runtime card's **Run checks** action asks the native host to run the same function. The popup, the management-page sidebar, and the dashboard runtime block display that report.
- Nothing leaves the machine except the two opt-in network checks below.

## 2. Scope and non-goals

### In scope

- CLI command `doctor`, help text, and exit codes.
- Shared check runner in `@rogatio/runtime`, called by the CLI and by the `runtime.doctor` envelope.
- Extension command `run-doctor` and the **Run checks** button.
- Bug-report form field for `rogatio doctor --json`.
- README, package README, architecture note, and the docs site.

### Non-goals

- Telemetry, or a background check on a timer.
- Changing Chrome proxy settings. The PAC check is a loopback request.
- Reading an arbitrary filesystem path from an extension message.
- Replacing `rogatio verify` or `rogatio runtime verify`.
- A newer-release check unless the user passes `--check-updates`.

## 3. Package boundary

```
schema → compiler → runtime → cli
                         ↑
                    native host
                         ↑
                    extension (envelope only; no runtime import)
```

`@rogatio/runtime` owns the check order, the fix strings, the report, and the loopback PAC probe. The CLI parses arguments and reads the project file. The extension sends `runtime.doctor` and renders the report. It does not reimplement the checks.

Project validation is `diagnoseProjectData` in `@rogatio/runtime` (schema, then compiler). `rogatio verify` calls that same function.

## 4. Checks

Checks always run, in this order, even after an earlier failure. `id` values are stable.

| Order | id | Title | Required |
| --- | --- | --- | --- |
| 1 | `node` | Node and CLI | yes |
| 2 | `project` | Project file | yes |
| 3 | `host` | Native host | yes |
| 4 | `ca` | Device CA | yes |
| 5 | `pac` | Runtime PAC | yes |
| 6 | `ai` | AI Assist | no (`optional: true`) |

Status is `pass`, `warn`, or `fail`. A required `fail` makes the process exit 1. A `warn` does not. The AI check is the only optional check. A newer CLI release is a `warn` on `node`, not a failure.

### 4.1 Node and CLI

- Node's major version is read from the process. It must be at least 26 (`engines.node` is `>=26`). Older or unparseable: `fail`.
- Fix: `Install Node.js 26 or newer, then run: npm install -g @rogatio/cli`
- A blank CLI version: `fail`. Fix: `npm install -g @rogatio/cli`
- Otherwise `pass`, summary `Node <version>, CLI <version>.`
- `--check-updates` GETs `https://registry.npmjs.org/@rogatio/cli/latest` and reads `version`. No other registry call exists. The request is skipped when Node is too old or the CLI version is blank, because the install fix already covers that case.
- A newer `major.minor.patch`: `warn`. Fix: `npm install -g @rogatio/cli@<version>`
- The registry does not answer, or the version is not numeric: `warn`, `fix: null`. The command still exits 0 when every required check passed.

### 4.2 Project file

The CLI reads `[path]`, defaulting to `./.rogatio.json`. The read uses the same JSON-file storage as `verify`, including v1 migration. Doctor does not read stdin.

| Read result | Summary | Fix |
| --- | --- | --- |
| missing | `Project file not found: <path>` | `rogatio edit <path>` |
| not JSON, or JSON that is not an object | `Project file is not JSON: <path>` | `rogatio edit <path>` |
| unreadable | `Project file could not be read: <path>` | `rogatio edit <path>` |
| schema or compiler diagnostics | `Project file is invalid: <path>` plus the verify lines `path: message (code)` | `rogatio verify <path>` |
| valid | `Project file is valid: <path>` | none |

Paths that are not a bare shell word are wrapped in POSIX single quotes. At most 20 diagnostics are included.

The native host does not accept a path. It validates the active project object on the envelope, with the same `diagnoseProjectData` function.

| Active project | Summary | Fix |
| --- | --- | --- |
| omitted because it does not fit in the envelope | `The active project is too large to check through the native host.` | `rogatio doctor` |
| absent | `No active project.` | `rogatio edit` |
| invalid | `Active project is invalid.` plus the same diagnostic lines | `rogatio edit` |
| valid | `Active project is valid.` | none |

A validator throw becomes `Project file could not be checked.` The thrown message is not copied into the report.

### 4.3 Native host

This is `createInstalledTrustController().verify()`, the same controller as `rogatio runtime verify`, plus `extensionOriginListed` from the stable-extension-id work (#263). The first matching row wins.

| Condition | Summary | Fix |
| --- | --- | --- |
| verify throws | `Native host could not be checked.` | `rogatio runtime install` |
| extension id is not 32 characters from `a` through `p` | `Extension ID is not a Chrome extension ID.` | `rogatio runtime install` |
| manifest missing | `Native host manifest was not found.` | `rogatio runtime install` |
| manifest invalid | `Native host manifest is invalid.` | `rogatio runtime install` |
| `runtime-host` wrapper missing | `runtime-host wrapper was not found.` | `rogatio runtime install` |
| wrapper not executable | `runtime-host wrapper is not executable.` | `rogatio runtime install` |
| no `allowed_origins` | `Native host manifest has no allowed_origins.` | `rogatio runtime install` |
| origins omit the id | `Extension ID <id> is not in the host manifest allowed_origins.` | `extensionIdInstallCommand(id)` |
| match | `allowed_origins includes chrome-extension://<id>/` | none |

`extensionIdInstallCommand` is `rogatio runtime install` for the release id and `rogatio runtime install --extension-id <id>` otherwise. Release users never pass `--extension-id`. The flag is only for development (a local unpacked build without the release key) and for forks.

The default id is the release id. `--extension-id` uses the same grammar as `rogatio runtime verify`.

### 4.4 Device CA

`verify().caTrusted` is the signal `rogatio runtime verify` already uses: the device-local CA key and certificate files exist after `rogatio runtime install` has trusted them in the OS store. Doctor does not add a second OS-store query.

- Trusted: `pass`, `Device CA is present and trusted.`
- Not trusted: `fail`, `Device CA is not present or not trusted.` Fix: `rogatio runtime install`
- Verify throws: `fail`, `Device CA could not be checked.` Fix: `rogatio runtime install`

### 4.5 Runtime PAC

Doctor generates a PAC script with `generatePacScript`, listens on `127.0.0.1` port 0, and GETs `/pac` with Node's `http` client. That client does not follow proxy environment variables, so the probe stays on the loopback interface. The body must contain `FindProxyForURL` and the probe hostname. The wait is 10000ms, the same budget the host uses for a PAC reply (#257). The listener is closed afterwards. Chrome proxy settings are not changed.

- Answered: `pass`, `Runtime answered a PAC request.`
- Timeout, bind failure, or a throw: `fail`, `Runtime did not answer a PAC request within 10000ms.` Fix: `rogatio runtime install`

The error text from the socket is not copied into the report.

### 4.6 AI Assist (optional)

This is the Hello completion `rogatio ai test` sends, with a 10000ms abort. It runs only when a provider config file exists. The provider's error text and the API key are not copied into the report.

| Result | Status | Summary | Fix |
| --- | --- | --- | --- |
| no config | `warn` | `Optional. No AI provider is configured.` | `rogatio ai setup` |
| config, no answer | `warn` | `Optional. The configured AI provider did not respond.` | `rogatio ai test` |
| answer | `pass` | `AI provider responded.` | none |

## 5. Network

| Call | When |
| --- | --- |
| npm registry `GET /@rogatio/cli/latest` | `--check-updates` only, and only when Node and the CLI version are usable |
| configured AI provider chat completion | a provider config file exists |

No telemetry. No call on a timer. The extension sets `checkUpdates` to false, so **Run checks** does not contact the registry. It does contact a configured AI provider, because that check is part of doctor.

## 6. Human output

One line per check, then a fix line when `fix` is not null:

```
pass  Node and CLI  Node 26.11.1, CLI 1.2.3.
fail  Project file  Project file not found: /tmp/.rogatio.json
  Fix: rogatio edit /tmp/.rogatio.json
warn  AI Assist  Optional. No AI provider is configured.
  Fix: rogatio ai setup
```

The title column is the table in section 4. Usage errors go to stderr and do not print a report.

## 7. JSON

`rogatio doctor --json` writes UTF-8 JSON with a trailing newline. Keys are in this order, two-space indent:

```json
{
  "version": 1,
  "ok": false,
  "exitCode": 1,
  "checks": [
    {
      "id": "project",
      "status": "fail",
      "optional": false,
      "summary": "Project file not found: /tmp/.rogatio.json",
      "fix": "rogatio edit /tmp/.rogatio.json"
    }
  ]
}
```

`checks` always has the six ids in section 4. `fix` is a string or `null`. `ok` is true when no required check has status `fail`. `exitCode` is `0` or `1` and matches `ok`. There is no timestamp, path to the CA, API key, or provider error string.

## 8. Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every required check passed. Warnings are allowed. |
| 1 | One or more required checks failed. |
| 2 | Usage error: unknown flag, extra path, or a bad `--extension-id`. No report is printed. |

`--help` exits 0.

## 9. Native host

Envelope type `runtime.doctor` (protocol `v1`).

Request metadata:

- `extensionId` (optional). Invalid values fail the host check and are not copied into a shell command.
- `project` (optional). The active project. This type may carry authored project fields, including `body`, the same way `runtime.project.set` may. The reply does not contain the project.
- `projectOmitted: "too-large"` when the extension cannot fit the project in the envelope.
- `checkUpdates: true` only when that boolean is set. The extension always sends false.

The host handles the envelope before the session controller, so Run checks does not require **Start runtime** and does not install a PAC into Chrome. A throw inside the handler still replies, with every check summarized as `Doctor could not finish.` and fix `rogatio doctor`, so the extension does not time out.

The extension waits 25000ms. That covers the 10000ms PAC probe plus the 10000ms AI probe.

If `connectNative` fails, the extension shows one check and does not invent the other five:

- id `host`, status `fail`, summary `Could not reach the native host.`, fix `rogatio runtime install`

That fallback is the only one-check report the extension will render. Any other one-check payload is ignored and replaced with this fallback.

## 10. Extension UI

**Run checks** is on the sidebar runtime card, the dashboard runtime block, and the toolbar popup. All three send `run-doctor` and render `status`, the title, the summary, and `Fix: <command>` with `textContent`.
