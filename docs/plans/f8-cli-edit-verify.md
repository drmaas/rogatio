# F8: CLI `edit` + `verify` — Implementation Plan

## Architecture Note (Summary)

The CLI package (`@rogatio/cli`) implements three commands:
- `edit`: HTTP server (127.0.0.1) + browser launch hosting the F5 editor
- `verify`: Schema + compiler validation pipeline with human/JSON output
- `runtime`: Stub for F14+

Key boundaries:
- Server binds `127.0.0.1` only, CSRF on POST, atomic file writes
- Editor served as static esbuild browser bundle
- Verify uses `@rogatio/schema` + `@rogatio/compiler` directly (no server)
- Zero external deps beyond workspace + Node stdlib

## Ordered Plan

### Task 1: Create CLI Package Structure
**Files:** `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/vitest.config.ts`
**Behavior:** New workspace package with proper config matching repo conventions
**Deps:** None (first task)
**AC:** AC-019, AC-020
**Verify:** `pnpm -F @rogatio/cli typecheck` passes

### Task 2: CLI Entry Point & Argument Parsing
**File:** `packages/cli/src/index.ts`
**Behavior:** Route `edit`/`verify`/`runtime` subcommands, global `--help`/`--version`
**Deps:** Task 1
**AC:** AC-001, AC-002, AC-006, AC-008, AC-010
**Verify:** Unit test command routing

### Task 3: File Utilities — Atomic Read/Write
**File:** `packages/cli/src/utils/file.ts`
**Behavior:** `readProject(path)`, `writeProject(path, project)` with atomic temp+rename
**Deps:** Task 1
**AC:** AC-003, AC-005, AC-006
**Verify:** Unit test atomic write, error cases, concurrent safety

### Task 4: Cross-Platform Browser Launch
**File:** `packages/cli/src/utils/browser.ts`
**Behavior:** `launchBrowser(url)` using `open`/`xdg-open`/`start`, returns success/failure
**Deps:** Task 1
**AC:** AC-004, AC-011, AC-018
**Verify:** Unit test platform detection, mock spawn

### Task 5: HTTP Server Core
**File:** `packages/cli/src/server/http.ts`
**Behavior:** `createServer(handler)` → `http.Server` bound to `127.0.0.1:0`, port retry (3x)
**Deps:** Task 1
**AC:** AC-015, AC-017
**Verify:** Unit test binding, port retry, shutdown

### Task 6: API Routes & CSRF
**File:** `packages/cli/src/server/routes.ts`
**Behavior:** 
- `GET /api/project` → project JSON
- `POST /api/validate` → schema+compiler diagnostics (requires CSRF)
- `POST /api/save` → atomic write (requires CSRF)
- `POST /api/cancel` → shutdown signal (requires CSRF)
- CSRF token generation + validation middleware
**Deps:** Task 3, Task 5, `@rogatio/schema`, `@rogatio/compiler`
**AC:** AC-004, AC-005, AC-006, AC-010, AC-011, AC-016
**Verify:** Unit test each endpoint, CSRF enforcement, diagnostics format

### Task 7: Editor HTML Template & Static Assets
**Files:** `packages/cli/src/server/editor.html`, `packages/cli/src/server/editor.ts` (browser entry)
**Behavior:** 
- HTML template with embedded config (apiBase, csrfToken, filePath)
- Browser entry imports `@rogatio/editor`, calls `createEditor` with HTTP callbacks
- esbuild browser build output served as static files
**Deps:** Task 6, `@rogatio/editor`
**AC:** AC-004
**Verify:** Manual test editor loads; unit test HTML generation

### Task 8: Edit Command Implementation
**File:** `packages/cli/src/commands/edit.ts`
**Behavior:** 
- Resolve file path (default `.rogatio.json`)
- Read or create empty project
- Start server with routes
- Generate HTML, launch browser
- Wait for save/cancel/shutdown
- Cleanup on signals
**Deps:** Task 2, Task 3, Task 4, Task 5, Task 6, Task 7
**AC:** AC-001 through AC-006, AC-015, AC-017
**Verify:** Integration test with temp file, mock browser launch

### Task 9: Verify Command Implementation
**File:** `packages/cli/src/commands/verify.ts`
**Behavior:**
- Resolve path (default `.rogatio.json`, `-` for stdin)
- Parse JSON
- Run `validateProjectDetailed` (schema)
- If valid, run `compileProject` (compiler)
- Format diagnostics (human/JSON)
- Exit with code 0/1/2
**Deps:** Task 2, Task 3, `@rogatio/schema`, `@rogatio/compiler`
**AC:** AC-007 through AC-014
**Verify:** Unit tests for each format, exit codes, stdin, error cases

### Task 10: Runtime Command Stub
**File:** `packages/cli/src/commands/runtime.ts`
**Behavior:** Print "Not yet implemented", exit 1
**Deps:** Task 2
**AC:** AC-010 (REQ-010)
**Verify:** Unit test

### Task 11: Build Integration
**Files:** Update `scripts/build.ts` to include CLI package
**Behavior:** esbuild builds CLI for Node (`dist/node/index.js`) and editor for browser (`dist/browser/`)
**Deps:** Task 1, Task 7
**AC:** AC-019, AC-020
**Verify:** `pnpm build` succeeds, `dist/node/index.js` executable

### Task 12: Package.json Bin Entry & Testing
**File:** `packages/cli/package.json` — add `"bin": { "rogatio": "./dist/node/index.js" }`
**Behavior:** `rogatio` command available after install
**Deps:** Task 11
**AC:** AC-019, AC-020
**Verify:** `pnpm build && node packages/cli/dist/node/index.js --help`

### Task 13: Root Package.json Workspace Registration
**File:** `/package.json` — add `@rogatio/cli` to workspaces (already implicit via packages/*)
**Behavior:** CLI package included in monorepo build/test
**Deps:** Task 1
**AC:** AC-020
**Verify:** `pnpm test` includes CLI tests

### Task 14: Documentation Updates
**Files:** `docs/architecture.md` (already updated), `README.md`, `AGENTS.md`
**Behavior:** Document CLI usage, add to architecture
**Deps:** Task 11
**AC:** Documentation completeness
**Verify:** Links work, examples accurate

## Test Strategy

| Component | Test Type | Coverage |
|-----------|-----------|----------|
| Argument parsing | Unit | All commands, options, edge cases |
| File utils | Unit | Atomic write, errors, permissions |
| Browser launch | Unit | Platform logic, mock spawn |
| HTTP server | Unit | Binding, retry, shutdown |
| API routes | Unit | Each endpoint, CSRF, diagnostics |
| Edit command | Integration | Temp file, mock browser, full flow |
| Verify command | Unit | Schema, compiler, formats, exit codes, stdin |
| Runtime stub | Unit | Output, exit code |

## Verification Commands

```bash
# Format/lint/typecheck
pnpm format:check && pnpm lint && pnpm typecheck

# Unit tests
pnpm -F @rogatio/cli test

# Full build + test
pnpm build && pnpm test

# Manual smoke tests
node packages/cli/dist/node/index.js edit --help
node packages/cli/dist/node/index.js verify --help
node packages/cli/dist/node/index.js runtime
```

## Rollback Steps

If issues arise:
1. Remove `packages/cli/` directory
2. Revert `scripts/build.ts` changes
3. Revert root `package.json` if modified
4. No database/migrations to roll back

## Dependencies Summary

```
Task 1 (package structure)
  ├── Task 2 (entry point)
  ├── Task 3 (file utils)
  ├── Task 4 (browser launch)
  ├── Task 5 (HTTP server)
  ├── Task 7 (editor assets) ──► Task 6 (routes) ──► Task 8 (edit command)
  └── Task 9 (verify command) ◄── Task 3, @schema, @compiler
  └── Task 10 (runtime stub)
  └── Task 11 (build integration) ◄── Task 1, Task 7
  └── Task 12 (bin entry) ◄── Task 11
  └── Task 13 (workspace) ◄── Task 1
  └── Task 14 (docs) ◄── Task 11
```

