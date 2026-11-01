# F8: CLI `edit` + `verify` — Specification

## 1. Problem Statement and Goals

**Problem:** Users need a CLI to create, edit, and verify `.rogatio.json` files locally before importing into the Chrome extension. The CLI must share the same editor implementation as the extension (F5) and use the schema (F2) and compiler (F3) for verification.

**Goals:**
- Implement `rogatio edit [path]` — launches browser-based editor for `.rogatio.json`
- Implement `rogatio verify [path]` — validates `.rogatio.json` with schema + compiler
- Implement `rogatio runtime` — stub for future native messaging runtime (F14+)
- Package as `@rogatio/cli` with `rogatio` binary for GitHub Packages distribution
- Zero external dependencies beyond workspace packages and Node stdlib

## 2. Scope and Non-Goals

### In Scope
- CLI package with three commands: `edit`, `verify`, `runtime`
- HTTP server + browser launch for `edit` command
- Schema validation + compiler diagnostics for `verify` command
- Cross-platform support (Linux, Windows, macOS)
- Atomic file writes, CSRF protection, 127.0.0.1 binding
- Human-readable and JSON output for `verify`
- Proper exit codes for scripting

### Non-Goals
- Electron/Tauri binary distribution
- Terminal-based editor (editor is DOM-based)
- Watch mode or daemon operation
- Cloud sync, accounts, telemetry
- Full `runtime` implementation (F14+)
- Browser extension communication (separate F7)

## 3. Actors, Entry Points, and Environments

| Actor | Entry Point | Environment |
|-------|-------------|-------------|
| Developer | `rogatio edit` | Terminal with browser available |
| Developer | `rogatio verify` | Terminal (CI/CD compatible) |
| CI/CD | `rogatio verify --json` | Headless Linux (no browser needed) |
| Future | `rogatio runtime` | macOS (native messaging) |

Supported platforms: Linux, Windows, macOS (Node 24+)
Browser required for `edit`: Any modern browser (Chrome, Firefox, Safari, Edge)

## 4. Functional Requirements

### REQ-001: CLI Entry Point
The `rogatio` binary shall route to subcommands `edit`, `verify`, `runtime` and support `--help`, `--version` globally.

### REQ-002: Edit Command — File Resolution
`rogatio edit [path]` shall:
- Default to `.rogatio.json` in current working directory if no path given
- Accept relative or absolute path
- Create empty project structure if file does not exist
- Reject if path exists as directory

### REQ-003: Edit Command — HTTP Server
The edit command shall start an HTTP server that:
- Binds to `127.0.0.1:0` (random ephemeral port)
- Retries up to 3 times on port conflict
- Serves static editor assets (HTML, JS, CSS)
- Provides API endpoints:
  - `GET /api/project` — returns current project JSON
  - `POST /api/validate` — validates project, returns diagnostics
  - `POST /api/save` — writes project to file atomically
  - `POST /api/cancel` — initiates clean shutdown
- Requires CSRF token on mutating endpoints (POST)
- Shuts down on save, cancel, SIGINT, SIGTERM, or client disconnect

### REQ-004: Edit Command — Browser Launch
After server starts, the command shall:
- Generate `editor.html` with embedded config (API base URL, CSRF token, file path)
- Launch default browser to `http://127.0.0.1:<port>/editor.html`
- Use platform-appropriate launcher: `open` (macOS), `xdg-open` (Linux), `start` (Windows)
- Print server URL and instructions if browser launch fails
- Continue running server even if browser launch fails

### REQ-005: Edit Command — Editor Integration
The served editor page shall:
- Load the `@rogatio/editor` bundle (esbuild output for browser)
- Instantiate editor via `createEditor(root, options)`
- Provide `validate` callback → `POST /api/validate`
- Provide `save` callback → `POST /api/save`
- Provide `onCancel` callback → `POST /api/cancel`
- Support all F5 editor features (metadata, groups, rules, URL→regex, search, command bar, accessibility)

### REQ-006: Verify Command — File Resolution
`rogatio verify [path]` shall:
- Default to `.rogatio.json` in cwd if no path given
- Accept `-` to read from stdin
- Accept relative or absolute path

### REQ-007: Verify Command — Validation Pipeline
The verify command shall:
1. Parse JSON from file/stdin (exit 2 on parse error)
2. Run `validateProjectDetailed` from `@rogatio/schema`
3. If schema valid, run `compileProject` from `@rogatio/compiler`
4. Collect all diagnostics (schema + compiler)
5. Output diagnostics in requested format
6. Exit with appropriate code

### REQ-008: Verify Command — Output Formats
- **Human (default)**: Grouped by severity (error), colored if stdout is TTY, paths relative to file
- **JSON (`--json`)**: Array of `{ code, severity, path, message, params }` for scripting

### REQ-009: Verify Command — Exit Codes
- `0`: Valid (no diagnostics)
- `1`: Invalid (diagnostics present)
- `2`: Error (IO, JSON parse, unexpected failure)

### REQ-010: Runtime Command — Stub
`rogatio runtime` shall print "Not yet implemented" and exit 1 (placeholder for F14+).

### REQ-011: Build and Distribution
- Package builds via repo `scripts/build.ts` (esbuild)
- Entry point: `src/index.ts` → `dist/node/index.js`
- `package.json` declares `"bin": { "rogatio": "./dist/node/index.js" }`
- TypeScript 7, ESM/NodeNext, Biome formatted/linted

## 5. Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-001 | `rogatio edit` launches editor for `.rogatio.json` in cwd | Manual test |
| AC-002 | `rogatio edit path/to/file.json` edits specified file | Manual test |
| AC-003 | `rogatio edit` creates new file with empty project if missing | Manual test |
| AC-004 | Editor loads, allows create/edit/save/cancel | Manual test |
| AC-005 | Save writes valid `.rogatio.json` atomically | Manual test + file check |
| AC-006 | Cancel exits without writing | Manual test |
| AC-007 | `rogatio verify` validates file in cwd | Unit/integration test |
| AC-008 | `rogatio verify path/to/file.json` validates specified file | Unit test |
| AC-009 | `rogatio verify -` reads from stdin | Unit test |
| AC-010 | Verify runs schema validation (F2) | Unit test with invalid schema |
| AC-011 | Verify runs compiler diagnostics (F3) | Unit test with valid schema, compiler errors |
| AC-012 | Verify human output shows diagnostics clearly | Manual test |
| AC-013 | Verify `--json` outputs valid JSON array | Unit test |
| AC-014 | Verify exit code 0 for valid, 1 for invalid, 2 for error | Unit test |
| AC-015 | Edit server binds to 127.0.0.1 only | Unit test (netstat/ss) |
| AC-016 | Edit server requires CSRF on POST | Unit test (missing token rejected) |
| AC-017 | Edit cleans up on SIGINT/SIGTERM | Integration test |
| AC-018 | Works on Linux, Windows, macOS | CI matrix test |
| AC-019 | No external deps beyond workspace + stdlib | `package.json` audit |
| AC-020 | Build passes `pnpm validate` | CI |

## 6. API, CLI, and File Format Changes

### CLI Interface
```
rogatio <command> [options] [args]

Commands:
  edit [path]     Launch browser editor for .rogatio.json
  verify [path]   Validate .rogatio.json file
  runtime         Native messaging runtime (not yet implemented)

Global Options:
  --help          Show help
  --version       Show version

Edit Options:
  --port <n>      Fixed port (default: random)

Verify Options:
  --json          Output diagnostics as JSON
```

### File Format
No changes to `.rogatio.json` format (owned by `schema` package v1).

## 7. Security, Privacy, Performance, Accessibility, Operational

### Security
- Server binds `127.0.0.1` only — no LAN exposure
- CSRF token on mutating endpoints — prevents localhost CSRF
- No authentication — local user only, short-lived process
- File access confined to target path — no directory traversal
- No outbound network requests

### Privacy
- No telemetry, analytics, or data collection
- No accounts or cloud sync
- Project data never leaves local machine

### Performance
- Server starts in <500ms typical
- Editor bundle cached by browser
- Verify completes in <200ms for typical projects
- Minimal memory footprint (Node stdlib only)

### Accessibility
- Editor inherits F5 accessibility (keyboard, screen reader, forced colors, 200% zoom)
- CLI output respects `NO_COLOR` and `TERM` for color support
- Verify human output uses semantic structure

### Operational
- Atomic file writes prevent corruption
- Clean shutdown on signals
- Port retry logic handles conflicts
- Clear error messages with actionable guidance

## 8. Migration, Rollout, Backward Compatibility

- New package `@rogatio/cli` — no existing users
- No migration needed
- Version 0.0.0 initially, follows semantic-release with other packages
- CLI version locked to extension version per repo policy

## 9. Open Questions and Assumptions

| Question | Assumption |
|----------|------------|
| Browser launch failure behavior | Print URL + instructions, keep server running |
| Editor bundle strategy | esbuild browser build served as static files |
| Maximum project size for verify | No explicit limit (schema has rule limits) |
| Concurrent edit sessions | Not supported (single file, single server) |
| Windows `start` command reliability | Use `cmd /c start "" <url>` pattern |

