---
title: CLI reference
description: The rogatio CLI commands edit, verify, and runtime.
---

The public CLI consists exactly of `edit`, `verify`, and `runtime`.

## `rogatio edit [path]`

Starts a local editor server (bound to `127.0.0.1`, random port) and opens the shared
editor in your browser. Edits are validated and saved back to the `.rogatio.json` file.
The session is local-only and short-lived; file access is confined to the target path.

## `rogatio verify [path]`

Validates a `.rogatio.json` file (default `cwd/.rogatio.json`, or `-` for stdin):

- Runs schema validation, then compiler validation.
- Human-readable output by default; `--json` for machine-readable structured diagnostics.
- Exit codes: `0` = valid, `1` = invalid (diagnostics), `2` = error (IO/parse).

## `rogatio runtime <subcommand>`

Controls the local runtime (see [Local runtime](/guides/runtime/)):

- `rogatio runtime start` / `stop` / `status` — control the running runtime process.
- `rogatio runtime install | status | trust | untrust | uninstall` — manage the
  device-local native-messaging host registration and CA trust for request-body rules.

## Notes

- `rogatio test` performs the [offline dry-run](/guides/dry-run/) from the CLI.
- The CLI is distributed through the organization's authenticated GitHub Packages registry.
