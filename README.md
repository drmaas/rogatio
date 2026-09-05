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
  Chrome Manifest V3 Declarative Net Request. Mocks and body rewriting use an optional local
  runtime.
- **Private by design.** No accounts, no cloud, no telemetry. Site access is granted only
  for declared origins, and you activate groups explicitly.

## Features

Rules belong to named groups. Each rule can target a stable ID, a case-sensitive URL regular
expression, resource types, priority, and (where supported) an HTTP method.

- **Redirects** — send matching HTTP(S) requests to an absolute destination, including
  regular-expression capture substitution.
- **Query parameters** — add missing parameters and replace existing values for configured
  names while preserving everything else.
- **Headers** — set, append, or remove a named request/response header, subject to
  immutable forbidden-header lists.
- **Mocks** — return a configured status, headers, optional delay, and an inline body or a
  single approved local file snapshot. Mocks never contact upstream.
- **Response-body rewriting** — fetch an authorized public GET and perform bounded
  replacement through a local runtime.
- **Request-body modification** — replace or apply bounded regex replacement to eligible
  POST/PUT/PATCH XHR bodies, via native messaging to a local runtime.

Every rule can be dry-run against a bounded batch of URLs before saving. The offline check
reports regex, origin, method, and resource-type results without contacting the target or
changing installed rules.

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

The public CLI consists exactly of `edit`, `verify`, `test`, and `runtime` (which
includes the `host` subcommand).

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
extension does not request broad host permissions up front; you grant only each
project's declared site access when you import a project.

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
| `rogatio edit [path]` | Opens the browser editor bound to `127.0.0.1`; `--port <n>` fixes the port. |
| `rogatio test [path]` | Run offline dry-run tests. `--urls` comma-separated; `--urls-file` JSON array path or `-` for stdin; `--method`/`--resource-type` defaults; `--max-cases` limit (default 256); `--json` for machine-readable output. |
| `rogatio verify [path]` | Validates a file with the schema and compiler. `-` reads stdin; `--json` for diagnostics. |
| `rogatio runtime <install\|uninstall>` | Request-body trust lifecycle. `install` registers the native-messaging host manifest and (on capable platforms) provisions and trusts the device-local CA in a single, transactional call. `uninstall` removes the host manifest, the device-local CA files, and the trust installation (idempotent). The CA/trust provisioning remains capability-gated at the OS level and reports `unsupported` without error on incapable platforms. |
| `rogatio runtime host <path>` | Runs the consolidated native-messaging host for the project on stdio. Launched automatically by the browser extension via the native-messaging manifest; run manually only for debugging. Mock delivery, pairing, and authorization all flow through this single host; no separate HTTP mock server exists. |

Typical workflow: run `rogatio edit`, build and test rules with `rogatio test`, `rogatio verify`, then import
the file into Chrome, grant only declared site access, and activate the groups you need.

## Dry-run testing

```sh
# Test URLs against a project (human-readable output)
rogatio test .rogatio.json --urls "https://example.com/,https://other.com/" --method GET --resource-type main_frame

# Test from JSON file with explicit cases
rogatio test .rogatio.json --urls-file test-cases.json --json

# Test from stdin
cat test-cases.json | rogatio test .rogatio.json --urls-file -
```

## Mock rules

A `mock` rule returns a configured status, optional headers, optional delay, and
an inline body or a live UTF-8 snapshot of one approved local file — without
contacting upstream. Mocks are delivered by the consolidated native-messaging
host; the extension performs the one-time `mock.connect` handshake when you
click **Start runtime**.

```sh
# Register the native-messaging host once (required before Start runtime works)
# <extension ID> is shown in the extension sidebar ("Extension ID: …")
rogatio runtime install --extension-id <extension ID>

# Start the runtime from the extension's Start runtime control
# (Stop runtime stops it; mocks/response-body rules need only the host installed)

# Run the native-messaging host (normally launched by the browser; useful for debugging)
rogatio runtime host .rogatio.json

# Override the confined file root
rogatio runtime host .rogatio.json --root ~/projects/demo
```

Then open the extension, click **Start runtime**, and matched requests
will be redirected to the configured mock response. Mock rules report
`needs proxy` while the runtime is stopped and `active` when connected; the
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
| `@rogatio/schema` | Version-1 JSON schema, validation, origins, bounds, forbidden headers. |
| `@rogatio/compiler` | Transforms validated source into browser-neutral operations and stable diagnostics. |
| `@rogatio/dry-run` | Pure-offline bounded URL batch test engine (4-dim matching, preview seam). |
| `@rogatio/browser-core` | Versioned storage, migrations, permissions, enablement, lifecycle, runtime state. |
| `@rogatio/editor` | Shared framework-free DOM controller and accessible view. |
| `@rogatio/extension` | Chrome MV3 service worker and extension page (WebExtensions/DNR translation). |
| `@rogatio/runtime` | Reusable mock, response-body, and request-body transformation components. |
| `@rogatio/cli` | Editor host, file verification, test runner, and runtime dispatch (`rogatio` binary). |

## Local development

Prerequisites:

- Node.js **24** or newer (Node 24 is the CI baseline)
- pnpm **10.32.1**
- Chromium, for browser smoke tests

Install dependencies and the browser test binary:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Common scripts:

| Script | What it does |
| --- | --- |
| `pnpm format` / `pnpm format:check` | Write or check Biome formatting. |
| `pnpm lint` | Run Biome linting. |
| `pnpm typecheck` | Run the pinned strict TypeScript compiler. |
| `pnpm build` | Build and verify Node and browser ESM artifacts. |
| `pnpm test` | Build and run the Vitest unit and real-process integration suites. |
| `pnpm test:browser` | Build and run the Chromium Playwright smoke journey. |
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
