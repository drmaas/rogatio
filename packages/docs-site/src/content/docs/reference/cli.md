---
title: CLI reference
description: The rogatio CLI commands edit, verify, test, runtime, and ai.
---

The public CLI consists of `edit`, `verify`, `test`, `runtime`, and `ai`.

## `rogatio edit [path]`

Starts a local editor server (bound to `127.0.0.1`, random port) and opens the shared
editor in your browser. Edits are validated and saved back to the `.rogatio.json` file.
The session is local-only and short-lived; file access is confined to the target path.
Use `--port <n>` to fix the port and `--no-open` to start the server without launching
a browser (prints the editor URL instead).

## `rogatio verify [path]`

Validates a `.rogatio.json` file (default `cwd/.rogatio.json`, or `-` for stdin):

- Runs schema validation, then compiler validation.
- Human-readable output by default; `--json` for machine-readable structured diagnostics.
- Exit codes: `0` = valid, `1` = invalid (diagnostics), `2` = error (IO/parse).

## `rogatio test [path]`

Runs the offline dry-run test engine against a `.rogatio.json` file (see
[Dry-run testing](/guides/dry-run/)). Accepts `--urls` (comma-separated), `--urls-file`
(JSON array path or `-` for stdin), optional `--method` / `--resource-type` defaults, and
`--max-cases` (default 256); `--json` for machine-readable output.

## `rogatio runtime <subcommand>`

Trust lifecycle and native-host entry (see [Local runtime](/guides/runtime/)):

- `rogatio runtime install --extension-id <id>` — register the native-messaging host
  manifest for your loaded extension ID and, on capable platforms, provision and trust the
  device-local CA for request-body rules in one call. When elevation is unavailable the
  command prints `trust unsupported: <reasons>` and exits `0` (manifest still installed;
  only the CA trust step is skipped).
- `rogatio runtime uninstall` — remove the host manifest, the device-local CA files, and
  the trust installation (idempotent).
- `rogatio runtime host <path>` — run the consolidated native-messaging host for a project
  on stdio (normally launched by the browser extension; run manually only for debugging).

Start/stop of the runtime session itself is driven from the extension's **Start runtime** /
**Stop runtime** controls; the CLI does not have a session lifecycle subcommand.

## `rogatio ai <subcommand>`

Local AI provider configuration for the editor's AI Assist / Create using AI surfaces:

- `setup` — interactive configuration (provider URL, model, API key)
- `ls` — list configured providers
- `show` — show redacted configuration
- `delete` — remove configuration
- `test` — connection check

Keys and endpoints stay on your machine. See the repository root `README.md` for setup
detail and supported OpenAI-compatible providers.

## Notes

- The CLI is distributed as `@rogatio/cli` from the public npm registry.
- Requires **Node.js 24** or newer.
