# @rogatio/cli

Local-first browser request & response rules — editor host, file verification, test
runner, and runtime dispatch for [Rogatio](https://github.com/drmaas/rogatio).

Rogatio keeps all rules in a single version-controlled `.rogatio.json` file. The CLI
launches the visual editor, validates and dry-runs rules offline, and controls the
optional local runtime used for mocks and response/request body rewriting.

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
| `rogatio edit [path]` | Launch the browser editor for `.rogatio.json`. |
| `rogatio verify [path]` | Validate a `.rogatio.json` file (schema + compiler). |
| `rogatio test [path] [url...]` | Run offline dry-run tests against `.rogatio.json`. |
| `rogatio runtime <start\|stop\|status\|install\|trust\|untrust\|uninstall>` | Control the native messaging runtime and request-body trust. |
| `rogatio runtime-host <path>` | Start the consolidated native-messaging host for the project (mock/pair/authorize over stdio). |

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

# Start the native-messaging host for the project (launched by the extension)
rogatio runtime-host .rogatio.json
```

## Exit codes

- `0` — success
- `1` — invalid project (diagnostics present) or test/validation errors
- `2` — usage or IO error

## Related

- [Rogatio repository](https://github.com/drmaas/rogatio)
- [Chrome extension](https://github.com/drmaas/rogatio/releases) (Manifest V3)

## License

MIT
