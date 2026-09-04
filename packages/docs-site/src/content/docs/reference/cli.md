---
title: CLI reference
description: The rogatio CLI commands edit, verify, test, and runtime.
---

The public CLI consists exactly of `edit`, `verify`, `test`, and `runtime`.

## `rogatio edit [path]`

Starts a local editor server (bound to `127.0.0.1`, random port) and opens the shared
editor in your browser. Edits are validated and saved back to the `.rogatio.json` file.
The session is local-only and short-lived; file access is confined to the target path.

## `rogatio verify [path]`

Validates a `.rogatio.json` file (default `cwd/.rogatio.json`, or `-` for stdin):

- Runs schema validation, then compiler validation.
- Human-readable output by default; `--json` for machine-readable structured diagnostics.
- Exit codes: `0` = valid, `1` = invalid (diagnostics), `2` = error (IO/parse).

## `rogatio test [path] [url...]`

Runs the offline dry-run test engine against a `.rogatio.json` file (see
[Dry-run testing](/guides/dry-run/)). Accepts inline URLs, a JSON case file, or stdin;
`--json` for machine-readable output.

## `rogatio runtime <subcommand>`

Controls the local runtime (see [Local runtime](/guides/runtime/)):

- `rogatio runtime host <path>` — run the consolidated native-messaging host for a project
  on stdio (normally launched by the browser extension; run manually only for debugging).
- `rogatio runtime install | untrust | uninstall` — register the
  device-local native-messaging host and (on capable platforms) trust the
  device-local CA for request-body rules in a single install call; `untrust`
  removes CA trust, `uninstall` removes the host.
- Start/stop of the runtime itself is driven from the extension's Start/Stop controls;
  the CLI does not have a lifecycle subcommand.

## Notes

- `rogatio test` performs the [offline dry-run](/guides/dry-run/) from the CLI.
- The CLI is distributed through the organization's authenticated GitHub Packages registry.
