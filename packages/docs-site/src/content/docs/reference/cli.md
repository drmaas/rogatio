---
title: CLI reference
description: The rogatio CLI commands edit, verify, test, doctor, runtime, ai, and import.
---

The public CLI consists of `edit`, `verify`, `test`, `doctor`, `runtime`, `ai`, and `import`.

`edit`, `verify`, and `test` accept a project file with any filename. When the path is
omitted they look for `.rogatio.json` in the current directory. A directory listing
includes that file, `*.rogatio.json`, and any other `*.json` file that validates as a
Rogatio project. Other JSON, such as `package.json`, is left out.

## `rogatio edit [path]`

Starts a local editor server (bound to `127.0.0.1`, random port) and opens the shared
editor in your browser. Edits are validated and saved back to the file that was opened.
Any filename is accepted. When `path` is omitted, the CLI looks for `.rogatio.json`
in the current directory.

The session is local-only and short-lived; file access is confined to the target path.
Use `--port <n>` to fix the port and `--no-open` to start the server without launching
a browser (prints the editor URL instead).

## `rogatio verify [path]`

Validates a project file (any filename; default `cwd/.rogatio.json`, or `-` for stdin):

- Runs schema validation, then compiler validation.
- Human-readable output by default; `--json` for machine-readable structured diagnostics.
- Exit codes: `0` = valid, `1` = invalid (diagnostics), `2` = error (IO/parse).

## `rogatio doctor [path]`

Checks the local stack and prints `pass`, `warn`, or `fail` with one copy-paste fix for each problem. The path is any filename and defaults to `.rogatio.json` in the current directory.

Checks, in order:

1. Node.js 26 or newer, and this CLI version.
2. The project file, using the same schema and compiler checks as `verify`.
3. The native-host manifest, including whether `allowed_origins` matches the extension ID.
4. The device CA, using the same signal as `rogatio runtime verify`.
5. A loopback PAC answer within 10 seconds. This does not change Chrome's proxy settings.
6. AI Assist, marked optional. When a provider is configured, doctor sends the same Hello request as `rogatio ai test`.

`--json` prints a stable report (`version`, `ok`, `exitCode`, `checks`). `--check-updates` is the only time doctor contacts the npm registry. Without that flag, and without a configured AI provider, nothing leaves the machine.

Release users never pass `--extension-id`. That flag is only for development (a local unpacked build without the release key) and for forks.

Exit codes: `0` every required check passed (warnings are allowed), `1` a required check failed, `2` usage error.

The extension's **Run checks** button runs these same checks through the native host and lists browser-side checks before them. `rogatio edit` has **Run checks** too. `POST /api/doctor` on that loopback server requires the editor's CSRF token and returns this same report for the open file, nested under `host`, with editor checks for the server, the session, the draft, AI Assist, and an optional mock file root. Neither UI passes `--check-updates`.

The CLI `--json` schema, check ids, and exit codes are unchanged.

## `rogatio test [path]`

Runs the offline dry-run test engine against a project file (any filename; default
`cwd/.rogatio.json`). See [Dry-run testing](/guides/dry-run/). Accepts `--urls`
(comma-separated), `--urls-file`
(JSON array path or `-` for stdin), optional `--method` / `--resource-type` defaults, and
`--max-cases` (default 256); `--json` for machine-readable output.

## `rogatio runtime <subcommand>`

Trust lifecycle and native-host entry (see [Local runtime](/guides/runtime/)):

- `rogatio runtime install` — register the native-messaging host manifest for the
  pinned release extension ID and provision and trust the device-local CA for
  request-body rules in one **transactional** call. Release users never pass
  `--extension-id`. That flag is only for development (a local unpacked build
  without the release key) and for forks. CA trust needs elevated privileges
  (Linux `sudo`, macOS keychain authorization, Windows Administrator). When elevation or
  any required capability is unavailable the command prints `trust unsupported: <reasons>`
  with a remediation hint and exits `1` after rolling the manifest back — nothing is
  half-installed, so re-run it with elevated privileges.
- `rogatio runtime uninstall` — remove the host manifest, the device-local CA files, and
  the trust installation (idempotent).
- `rogatio runtime verify` — report whether the manifest, the `runtime-host` wrapper, the
  allowed origins, and the device-local CA trust are all present and valid, and whether
  `allowed_origins` includes the release ID. Exits `0` only
  when every check passes. A mismatch prints the re-pin command. Release users
  never pass `--extension-id` on verify. That flag is only for development (a
  local unpacked build without the release key) and for forks.
- `rogatio runtime host [path]` — run the consolidated native-messaging host for a project
  on stdio (normally launched by the browser extension; run manually only for debugging).
  Accepts `--root <dir>` to override the confined mock file root. When omitted, a saved
  device-local root for that project file is used, otherwise the project directory. A
  stdin project that contains a file mock requires `--root`.

Start/stop of the runtime session itself is driven from the extension's **Start runtime** /
**Stop runtime** controls; the CLI does not have a session lifecycle subcommand.

## `rogatio import requestly <export.json>`

Migrates a Requestly rule export into a version-2 `.rogatio.json` file. See
[Migrating from Requestly](/guides/migrating-from-requestly/).

- `--out <path>` writes that file (default `cwd/.rogatio.json`).
- `--merge` appends imported groups onto an existing version-2 project. Without it, an existing file is left untouched.
- `--json` prints the import report as JSON.
- The mapped project is validated with the schema and compiler before anything is written.
- Exit codes: `0` = written, `1` = validation failed (nothing written), `2` = usage, unreadable input, or refusal to overwrite.

## `rogatio ai <subcommand>`

Local AI provider configuration for the editor's AI Assist / Create using AI surfaces:

- `setup` — interactive configuration (provider URL, model, API key)
- `ls` — list configured providers
- `show` — show redacted configuration
- `delete` — remove configuration
- `test` — connection check

Keys and endpoints stay on your machine. CLI Assist (`rogatio edit`) uses the edit-server
`/api/ai/assist` route; the Chrome extension Assist / Create using AI surfaces use the
native messaging host. See the repository root `README.md` for setup detail and supported
OpenAI-compatible providers.

## Notes

- The CLI is distributed as `@rogatio/cli` from the public npm registry.
- Requires **Node.js 26** or newer.
