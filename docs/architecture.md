# Rogatio Architecture

## Overview
Rogatio is a local-first tool for creating, reviewing, and running browser request/response rules. It consists of a version-controlled `.rogatio.json` file, a CLI, and a Chrome extension, with an extensible browser-extension boundary.

## Package Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        @rogatio/schema (F2)                      │
│  JSON Schema v1, AJV validation, origins, bounds, forbidden hdrs │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @rogatio/compiler (F3)                      │
│  Validated source → browser-neutral operations + diagnostics    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌────────────────────┐
│ @rogatio/        │ │ @rogatio/    │ │ @rogatio/          │
│ browser-core (F4)│ │ editor (F5)  │ │ runtime (F6)       │
│ Storage, perms,  │ │ Framework-   │ │ Mock/response      │
│ enablement, CAS  │ │ free DOM     │ │ server foundation  │
└────────┬─────────┘ └──────┬───────┘ └────────┬───────────┘
         │                  │                   │
         └──────────────────┼───────────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ @rogatio/cli (F8)    │ ◄── NEW
                 │ edit, verify, runtime│
                 └──────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     ┌─────────────────┐           ┌───────────────┐
     │ Chrome MV3 Ext  │           │ Native Runtime │
     │ (F7, F9-F13)    │           │ (F14-F17)      │
     └─────────────────┘           └───────────────┘
```

## F8: CLI Package Architecture

### Components

**1. CLI Entry Point (`src/index.ts`)**
- Command router using minimal argument parsing (no external deps)
- Subcommands: `edit`, `verify`, `runtime` (stub)
- Global options: `--help`, `--version`

**2. Edit Command (`src/commands/edit.ts`)**
- HTTP server (Node `http` module) bound to `127.0.0.1:0` (random port, or a fixed port via `--port`)
- Static file serving for the editor page (`GET /editor.html`) and the `@rogatio/editor` browser bundle (`GET /vendor/editor.js`)
- API endpoints:
  - `GET /api/project` → returns current project JSON
  - `POST /api/validate` → runs schema + compiler validation
  - `POST /api/save` → writes project to file
  - `POST /api/cancel` → shuts down server
- Cross-platform browser launch (macOS `open`, Linux `xdg-open`, Windows `start`)
- CSRF protection via random token in HTML and validated on mutating endpoints
- Cleanup on SIGINT/SIGTERM, save, cancel, or browser close detection

**3. Verify Command (`src/commands/verify.ts`)**
- Reads `.rogatio.json` from path (default: cwd/.rogatio.json) or stdin (`-`)
- Runs `validateProjectDetailed` from `@rogatio/schema`
- If valid, runs `compileProject` from `@rogatio/compiler`
- Outputs diagnostics:
  - Human-readable (default): grouped by severity, colored if TTY
  - JSON (`--json`): structured array for scripting
- Exit codes: 0=valid, 1=invalid (diagnostics), 2=error (IO/parse)

**4. Editor Hosting (`src/server/`, `src/commands/edit.ts`)**
- `editor.html` is generated inline (`generateEditorHtml`) with embedded config (API base URL, CSRF token, file path) plus an import map
- The import map maps `@rogatio/editor` to `/vendor/editor.js`, served by the CLI's own HTTP server
- The `@rogatio/editor` browser bundle is resolved at runtime via `import.meta.resolve("@rogatio/editor")` and streamed from disk on `GET /vendor/editor.js` — no separate CLI browser build target is required
- Editor instantiates via `createEditor(root, options)` with HTTP-based callbacks (`validate`, `save`, `onCancel`)

**5. Utilities (`src/utils/`)**
- `file.ts`: read/write JSON with atomic write (temp + rename)
- `browser.ts`: cross-platform `open` with fallback handling

### Data Flow

```
rogatio edit [path]
       │
       ▼
┌──────────────────┐
│ Resolve file     │
│ Read or create   │
│ empty project    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Start HTTP server│
│ (127.0.0.1:0)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Generate editor  │
│ HTML with config │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Launch browser   │
│ to editor URL    │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
[User edits] [API calls]
    │         │
    ▼         ▼
[Save]    [Validate]
    │         │
    └────┬────┘
         ▼
┌──────────────────┐
│ Write file /     │
│ Return diagnostics│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Shutdown server  │
│ Exit process     │
└──────────────────┘
```

### Security Boundaries
- Server binds only to `127.0.0.1` (never `0.0.0.0`)
- CSRF token required for mutating endpoints (`/api/save`, `/api/cancel`)
- No authentication (local-only, short-lived)
- File access confined to target `.rogatio.json` path
- No network requests except browser launch

### Error Handling
- Schema validation errors → structured diagnostics
- Compiler diagnostics → included in verify output
- IO errors → exit code 2 with stderr message
- Browser launch failure → fallback instructions printed, server still runs
- Port conflict → retry with new random port (max 3 attempts)

### Testing Seams
- HTTP server: unit test with `fetch` against running server
- Edit command: integration test with temp file, mock browser launch
- Verify command: unit test with various valid/invalid inputs
- File utils: unit test atomic write, error cases
- Browser launch: unit test platform detection logic

## Decisions

| Decision | Rationale |
|----------|-----------|
| HTTP server + browser for `edit` | Shares editor code with extension; no Electron dependency |
| `127.0.0.1` binding | Prevents LAN exposure; matches runtime server pattern |
| CSRF token | Mitigates localhost CSRF from malicious pages |
| Atomic file write | Prevents corruption on crash/kill |
| Random port | Avoids conflicts; no config needed |
| Minimal deps (stdlib only) | Faster install; smaller attack surface; matches repo philosophy |
| Exit codes for verify | Scriptable CI/CD integration |
| JSON output option | Machine-readable for tooling |

## Rejected Alternatives

| Alternative | Reason |
|-------------|--------|
| Electron/Tauri | Heavy binary; contradicts "npm package" distribution |
| Terminal UI (ink) | Editor is DOM-based; would require rewrite |
| WebSocket for editor comms | HTTP sufficient; simpler; no WS dependency |
| Fixed port | Conflicts common; random + open browser is UX standard |
| Long-lived server | Edit is single-session; no need for daemon |
