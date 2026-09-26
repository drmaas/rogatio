# Rogatio

> Local-first browser request & response rules, version-controlled in a single `.rogatio.json` file.

[![Deploy docs site](https://github.com/drmaas/rogatio/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/drmaas/rogatio/actions/workflows/deploy-site.yml)
[![Checks](https://github.com/drmaas/rogatio/actions/workflows/checks.yml/badge.svg)](https://github.com/drmaas/rogatio/actions/workflows/checks.yml)
[![Site](https://img.shields.io/badge/site-drmaas.github.io%2Frogatio-blue)](https://drmaas.github.io/rogatio/)

📖 **[Live docs site → https://drmaas.github.io/rogatio/](https://drmaas.github.io/rogatio/)**

<img src="packages/docs-site/src/assets/logo.svg" alt="Rogatio logo" width="64" align="right" style="margin-left: 1rem; float: right;" />

Rogatio is a local-first tool for creating, reviewing, and running browser request and
response rules. It replaces scattered Requestly-style workflows with one
version-controlled file, a CLI, and a Chrome extension. There are no accounts, no hosted
runtime, no cloud sync, no telemetry, and no retained traffic history.

- **One canonical file.** All rules live in a `.rogatio.json` file you keep in version
  control. Moving changes between the file and your browser is an explicit import/export.
- **Visual editor.** Edit, test, and verify rules in an accessible, framework-free editor
  shared by the CLI and the Chrome extension.
- **Browser-native.** Redirects, query params, and headers run entirely in the browser via
  Chrome Manifest V3 Declarative Net Request. Response-body and request-body rules use an
  optional local runtime.
- **Private by design.** No accounts, no cloud, no telemetry. The extension uses broad
  install-time host access; you activate groups explicitly.

## Features

Rules belong to named groups. Each rule has a stable ID, a source condition (`key` `url` or
`host`, `operator` `regex`, case-sensitive `value`), resource types, priority, and (where
supported) an HTTP method.

- **Redirects** — send matching HTTP(S) requests to an absolute destination, including
  `$1`–`$9` regular-expression capture substitution (`\\1` remains compatible).
- **Query parameters** — set or remove configured names. Set adds missing parameters and
  replaces existing values; remove drops configured names. Set values can use `$1`–`$9`
  URL captures. Unrelated parameters and the rest of the URL stay intact.
- **Headers** — set, append, or remove a named request/response header, subject to
  immutable forbidden-header lists. Set and append values can use `$1`–`$9` URL captures.
- **Response body** — fetch an authorized public GET, then either replace the entire
  body or apply bounded regex rewrites through a local runtime. Replace bodies can use
  `$1`–`$9` URL captures. Upstream status and headers are preserved.
- **Request-body modification** — replace or apply bounded regex replacement to eligible
  POST/PUT/PATCH XHR bodies, via native messaging to a local runtime. Replace bodies can
  use `$1`–`$9` URL captures; regex-mode `$1`–`$9` remain body captures.

Every rule can be dry-run against a bounded batch of URLs before saving. The offline check
reports source, method, and resource-type results, plus substituted action previews,
without contacting the target or changing installed rules.

## CLI

The CLI is distributed as an npm package from the public npm registry. It
requires **Node.js 24 or newer**. Install the CLI globally with your preferred
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

Verify the install:

```sh
rogatio --help
```

The public CLI consists of `edit`, `verify`, `test`, `runtime` (with
`install`, `uninstall`, and `host` subcommands), and `ai`.

## Chrome extension

The extension is **unsigned** and manually loaded from a GitHub Release ZIP.
There is no browser-store install or automatic update.

1. Download the extension ZIP attached to the latest
   [GitHub Release](https://github.com/drmaas/rogatio/releases).
2. Unpack it to a stable local directory.
3. Open `chrome://extensions`, enable **Developer mode**, and choose
   **Load unpacked**.
4. Select the unpacked extension directory.

Chrome sideloading may require the organization's extension entitlement. The
extension declares broad host access (`*://*/*`) at install time so DNR rules can
match any HTTP(S) URL your projects describe; there is no per-origin grant step.

The editor, extension management page, and toolbar popup share a dark design
system (Hanken Grotesk + JetBrains Mono bundled offline, dot-grid page background,
surface cards, top navigation). Styling ships as standalone CSS artifacts inside the
editor and extension distributions; no fonts or assets are fetched at runtime.

The toolbar button opens a compact popup that lists the active project's saved groups with
one enable/disable switch each, a truthful runtime status, an **Open app** button (the full
management page at Overview), and a pencil that opens the management page on that group. It
also offers **New project** (an inline name form) and **Import project** (a file picker)
actions that reuse the management page's create/import lifecycle. The popup reuses the
existing group-enablement lifecycle; it contains no editor, search, proxy, permission, or
rule-authoring controls.

On the management page, each rule reports `active`, `disabled`, `needs runtime`,
`unsupported`, or `error`. When a rule fails to install, the status word
`error` is an activatable control that opens that rule in the workspace editor, and a
distinct error card shows the concrete install failure reason (Chrome's Declarative Net
Request message when available). The popup continues to show status labels only.

## Quick start

```sh
# Launch the visual editor for a project (creates an empty .rogatio.json if missing)
rogatio edit

# Validate a .rogatio.json file (0 = valid, 1 = invalid, 2 = error)
rogatio verify path/to/.rogatio.json

# Validate from stdin with machine-readable diagnostics
cat .rogatio.json | rogatio verify - --json
```

| Command | Description |
| --- | --- |
| `rogatio edit [path]` | Opens the browser editor bound to `127.0.0.1`; `--port <n>` fixes the port; `--no-open` starts the server without opening a browser. |
| `rogatio test [path]` | Run offline dry-run tests. `--urls` comma-separated; `--urls-file` JSON array path or `-` for stdin; `--method`/`--resource-type` defaults; `--max-cases` limit (default 256); `--json` for machine-readable output. |
| `rogatio verify [path]` | Validates a file with the schema and compiler. `-` reads stdin; `--json` for diagnostics. |
| `rogatio ai <setup\|ls\|show\|delete\|test>` | AI provider configuration. `setup` interactive; `ls` list; `show` redacted; `delete` remove; `test` connection. |
| `rogatio runtime <install\|uninstall>` | Request-body trust lifecycle. `install` registers the native-messaging host manifest and (on capable platforms) provisions and trusts the device-local CA in a single, transactional call. `uninstall` removes the host manifest, the device-local CA files, and the trust installation (idempotent). The CA/trust provisioning remains capability-gated at the OS level and reports `unsupported` without error on incapable platforms. |
| `rogatio runtime host <path>` | Runs the consolidated native-messaging host for the project on stdio. Launched automatically by the browser extension via the native-messaging manifest; run manually only for debugging. Pairing, authorization, and body transforms flow through this single host. |

Typical workflow: run `rogatio edit`, build and test rules with `rogatio test`, `rogatio verify`, then import
the file into Chrome and activate the groups you need.

## AI-Assisted Rule Authoring

Rogatio includes an AI assistant to help generate, fix, and explain rules. The AI runs locally on your machine using your configured provider (OpenAI, Ollama, OpenRouter, vLLM, or any OpenAI-compatible endpoint).

### Setup

```sh
# Interactive configuration (prompts for provider URL, model, API key)
rogatio ai setup

# List current configuration
rogatio ai ls

# Show configuration (API key redacted)
rogatio ai show

# Test connection to provider
rogatio ai test

# Remove configuration
rogatio ai delete
```

Configuration is stored at:
- **Linux**: `~/.config/rogatio/provider.json`
- **macOS**: `~/Library/Application Support/rogatio/provider.json`
- **Windows**: `%LOCALAPPDATA%\rogatio\provider.json`

The config file has `600` permissions (owner read/write only). The API key never appears in `.rogatio.json` or git history.

### Using AI in the Editor

1. Run `rogatio edit` to open the editor
2. Click **AI Assist** in the command bar (or use the mobile nav)
3. Type a natural language prompt like:
   - "Create a redirect rule for api.example.com to staging.example.com"
   - "Add a response-body replace rule that returns {'status': 'ok'}"
   - "Fix the invalid regex on rule xyz"
4. AI returns a validated proposal (CLI Assist uses the configured model; token streaming is optional and may be absent)
5. Click **Apply** to add the rule to your project, or **Reject** to discard

### AI Capabilities

| Feature | Description |
|---------|-------------|
| **Generate** | Create new rules from natural language |
| **Fix** | Automatically fix schema validation errors (max 3 iterations on CLI; extension validates once) |
| **Fix dry-run** | Modify rules to match failing test cases |
| **Explain** | Describe what a rule or project does |

### In the Chrome Extension

When the native runtime is started (`Start runtime`) and a provider is configured (`rogatio ai setup`), the extension management page shows an **AI Status** indicator. **Create using AI** on the Dashboard and **AI Assist** in the Workspace editor both go through the service worker to the native host — they do not call the CLI edit server. If you configure AI while the management page is already open, use **Refresh** (or restart the runtime) so Workspace remounts with Assist available.

### Security & Privacy

- **Zero telemetry** — No data sent to Rogatio servers
- **Your provider, your data** — Requests go only to your configured AI endpoint
- **API key isolation** — Stored in config file (600 perms), read only by `rogatio edit` and `rogatio runtime host`
- **Validation gate** — All AI output passes through schema + compiler validation before being applied
- **No browser direct calls** — AI runs in CLI server process or native host, not in browser

### Provider Compatibility

Tested with: OpenAI, Ollama, OpenRouter, vLLM. Any OpenAI-compatible chat completions endpoint works.

## Runtime

Response-body and request-body rules run through the consolidated native-messaging
host. Register it once, then start the runtime from the extension.

```sh
# Register the native-messaging host once (required before Start runtime works)
# <extension ID> is shown in the extension sidebar ("Extension ID: …")
rogatio runtime install --extension-id <extension ID>

# Start the runtime from the extension's Start runtime control
# (Stop runtime stops it)

# Run the native-messaging host (normally launched by the browser; useful for debugging)
rogatio runtime host .rogatio.json

# Override the confined file root
rogatio runtime host .rogatio.json --root ~/projects/demo
```

Then open the extension, click **Start runtime**, and response-body and
request-body rules become active through the native host. The
sidebar runtime status line shows the current phase next to the Start/Stop
controls, with the browser-assigned extension ID shown beneath it. If the host
manifest is not installed, starting shows the exact ready-to-run
`rogatio runtime install --extension-id <your extension ID>` command with a
one-click copy button. If the project has request-body rules and the
device-local CA is not yet trusted, the message points to
`rogatio runtime install --extension-id <your extension ID>` instead (the same
install command also provisions the device-local CA on capable platforms).
To remove the host and the device-local CA trust, run
`rogatio runtime uninstall` (idempotent).

## Project layout

This is a strict-TypeScript 7, ESM/NodeNext pnpm monorepo.

| Package | Purpose |
| --- | --- |
| `@rogatio/schema` | Version-2 JSON schema, validation, source conditions, bounds, forbidden headers, v1 migration. |
| `@rogatio/compiler` | Transforms validated source into browser-neutral operations and stable diagnostics. |
| `@rogatio/dry-run` | Pure-offline bounded URL batch test engine (3-dim matching, preview seam). |
| `@rogatio/browser-core` | Versioned storage, migrations, enablement, lifecycle, runtime state. |
| `@rogatio/editor` | Shared framework-free DOM controller and accessible view. |
| `@rogatio/extension` | Chrome MV3 service worker and extension page (WebExtensions/DNR translation). |
| `@rogatio/runtime` | Reusable response-body and request-body transformation components. |
| `@rogatio/cli` | Editor host, file verification, test runner, AI config, and runtime dispatch (`rogatio` binary). |
| `@rogatio/docs-site` | Astro + Starlight user documentation site (not on the product package DAG). |
| `@rogatio/smoke` | Tiny workspace stub used by package wiring checks. |
| `@rogatio/sanity` | Tiny workspace stub that depends on `@rogatio/smoke`. |

## Local development

Prerequisites:

- Node.js **24** or newer (Node 24 is the CI baseline)
- pnpm **12.4.1**
- Chrome for Testing, for browser e2e (`pnpm browser:install`)

Install dependencies and the browser test binary:

```sh
pnpm install --frozen-lockfile
pnpm browser:install
```

Browser e2e uses Selenium WebDriver against [Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/download-test-binaries) (not branded Chrome — branded builds dropped `--load-extension`). Override with `ROGATIO_CHROME_PATH` if needed (`CHROME_BIN` is only a last-resort fallback). Headed debug via `SELENIUM_HEADED=1`.

Common scripts:

| Script | What it does |
| --- | --- |
| `pnpm format` / `pnpm format:check` | Write or check Biome formatting. |
| `pnpm lint` | Run Biome linting. |
| `pnpm typecheck` | Run the pinned strict TypeScript compiler. |
| `pnpm build` | Build and verify Node and browser ESM artifacts. |
| `pnpm test` | Build and run the Vitest unit and real-process integration suites. |
| `pnpm test:browser` | Build and run Selenium browser journeys (Chrome for Testing). |
| `pnpm browser:install` | Download Chrome for Testing into `.browser-cache/`. |
| `pnpm validate` | Run the complete fail-fast validation sequence (includes negative fixtures). |

Use `pnpm validate` before opening a pull request.

## Contributing

Contributions are welcome. Please read
[`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, branching, coding standards, and the
validation workflow before you start.

## Documentation

- [`rogatio-overview.md`](rogatio-overview.md) — product and technical overview.
- [`docs/architecture.md`](docs/architecture.md) — package boundaries and decisions.
- [`docs/decisions/`](docs/decisions) — active decision records (specs, plans, workflow logs) for current and upcoming features.
- [`docs/specs/`](docs/specs), [`docs/plans/`](docs/plans), and [`docs/workflows/`](docs/workflows) — frozen per-area decision history. New work writes to `docs/decisions/`.

The published user documentation site is built from `packages/docs-site` (Astro + Starlight).
Run it locally from the repo root:

- `pnpm site` — start the dev server with hot reload.
- `pnpm site:build` — build the static site (emits `packages/docs-site/dist/`, gitignored).
- `pnpm site:preview` — preview the production build locally.

Equivalents scoped to the package also work, e.g. `pnpm --filter @rogatio/docs-site dev`.
The static site is deployed to GitHub Pages on every merge to `main` by the
`Deploy docs site` workflow, and the docs build is validated on pull requests by the
`Docs site` job in `checks.yml`.

## Release pipeline

- `Release` runs on merge to `main`, using semantic-release to cut a version, publish
  `@rogatio/cli` to the public npm registry, and attach the unsigned Chrome extension ZIP
  to the GitHub Release. Configure `NPM_TOKEN` (and rely on the automatic `GITHUB_TOKEN`)
  in repository secrets.
- `Deploy docs site` builds `packages/docs-site` and publishes it to GitHub Pages on merge
  to `main`. Enable Pages in repository settings with source **GitHub Actions**.

## License

[MIT](LICENSE) © 2026 Dan Maas
