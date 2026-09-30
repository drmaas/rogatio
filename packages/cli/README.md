# @rogatio/cli

Local-first browser request & response rules — editor host, file verification, test
runner, and runtime dispatch for [Rogatio](https://github.com/drmaas/rogatio).

Rogatio keeps all rules in a single version-controlled `.rogatio.json` file. The CLI
launches the visual editor, validates and dry-runs rules offline, and controls the
optional local runtime used for response/request body rewriting.

## Install

Requires Node.js 24 or newer. Install the CLI globally with your preferred
package manager:

```sh
npm install -g @rogatio/cli
```

```sh
pnpm add -g @rogatio/cli
```

```sh
bun add -g @rogatio/cli
```

```sh
vp install -g @rogatio/cli
```

## Usage

```sh
rogatio <command> [options]
```

| Command | Description |
| --- | --- |
| `rogatio edit [path]` | Launch the browser editor for `.rogatio.json`. `--port <n>` fixes the port; `--no-open` skips opening a browser. |
| `rogatio verify [path]` | Validate a `.rogatio.json` file (schema + compiler). |
| `rogatio test [path] [url...]` | Run offline dry-run tests against `.rogatio.json`. |
| `rogatio ai <setup\|ls\|show\|delete\|test>` | AI provider configuration. `setup` interactive; `ls` list; `show` redacted; `delete` remove; `test` connection. |
| `rogatio runtime <install\|uninstall\|verify>` | Register the native-messaging host with `install` (optional `--extension-id <id>`; release builds use the pinned ID) and trust the device-local CA in one **transactional** call; it needs elevated privileges (Linux `sudo`, macOS keychain authorization, Windows Administrator) and rolls back with exit `1` and `trust unsupported: <reasons>` when a capability or elevation is missing. `uninstall` removes the host manifest, the device-local CA files, and the CA trust installation (idempotent). `verify` reports whether manifest, `runtime-host` wrapper, allowed origins, and CA trust are all valid, and fails when `allowed_origins` omits the release ID (or `--extension-id`). |
| `rogatio runtime host [path]` | Run the consolidated native-messaging host for the project (pair/authorize/body transforms over stdio). Normally launched by the browser; run manually only for debugging. `--root <dir>` overrides the confined file root; `--mock-port <n>` binds the loopback mock-response faucet. |

Global options: `--help, -h` and `--version, -v`. Run `rogatio <command> --help`
for command-specific usage.

### Examples

```sh
# Open the editor for the project file in the current directory
rogatio edit

# Validate a project file (reads stdin with '-')
rogatio verify .rogatio.json

# Dry-run rules against a set of URLs
rogatio test .rogatio.json https://example.com/ https://example.com/app.js

# Run the native-messaging host for the project (normally launched by the browser)
rogatio runtime host .rogatio.json
```

## Exit codes

- `0` — success
- `1` — invalid project (diagnostics present), test/validation errors, or a failed
  `runtime install` / `runtime verify` check
- `2` — usage or IO error

## Local runtime

```sh
# Register the native-messaging host and trust the device-local CA (needs elevation).
# Release builds omit --extension-id. Dev or forked builds pass --extension-id <id>.
rogatio runtime install

# Check manifest, runtime-host wrapper, allowed origins, and CA trust
rogatio runtime verify

# Remove the host manifest, CA files, and trust installation
rogatio runtime uninstall

# Run the native-messaging host (normally launched by the browser)
rogatio runtime host .rogatio.json
```

Start and stop of the runtime **session** is driven from the extension's **Start runtime** /
**Stop runtime** controls. The CLI has no session lifecycle subcommand.

## AI-Assisted Rule Authoring

```sh
# Configure AI provider (interactive)
rogatio ai setup

# List/show/test/delete AI configuration
rogatio ai ls
rogatio ai show
rogatio ai test
rogatio ai delete
```

Configuration is stored at `~/.config/rogatio/provider.json` (Linux), `~/Library/Application Support/rogatio/provider.json` (macOS), or `%LOCALAPPDATA%\rogatio\provider.json` (Windows) with `600` permissions.

When AI is configured, `rogatio edit` shows an **AI Assist** button in the command bar. Click it to:
- Generate rules from natural language
- Fix validation errors by repairing the offending rules in place (keeping their rule ids; max 3 auto-fix iterations)

## Related

- [Rogatio repository](https://github.com/drmaas/rogatio)
- [Chrome extension](https://github.com/drmaas/rogatio/releases) (Manifest V3)

## License

MIT
