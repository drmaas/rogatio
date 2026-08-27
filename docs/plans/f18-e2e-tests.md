# F18 — E2E and Integration Test Suite Plan

**Specification:** `docs/specs/f18-e2e-tests.md`
**Status:** Approved plan basis

## 1. Product repair regression tests

### 1.1 Permission match-pattern adapter

- **Files:** `packages/extension/test/chrome.test.ts`, `packages/extension/src/chrome.ts`
- Add tests asserting `contains`, `request`, and `remove` receive `origin/*` while
  preserving already-suffixed origins.
- Implement the smallest origin-to-match-pattern helper.
- **Covers:** REQ-017, AC-010.

### 1.2 Editor built-in extension replacement

- **Files:** `packages/editor/test/editor.test.ts`, `packages/editor/src/editor.ts`
- Add a regression test that passing the built-in `mock`/`response-body` extensions
  replaces those entries without initialization failure; preserve the existing
  duplicate-passed-list rejection test.
- Adjust duplicate tracking to distinguish built-in replacement from duplicate entries
  in the caller's list.
- **Covers:** REQ-019, AC-011.

### 1.3 Packaged CLI entrypoint

- **Files:** `packages/cli/test/packaged.test.ts`, `packages/cli/src/index.ts`
- Test packed/installed binary execution and version output. Test the path predicate with
  POSIX and Windows-style dist paths through an extracted helper or equivalent public
  behavior.
- Add the Node shebang and cross-platform dist detection.
- **Covers:** REQ-020, AC-012.

### 1.4 DNR install wiring

- **Files:** `packages/extension/test/service-worker.test.ts`,
  `packages/extension/src/service-worker.ts`, `packages/extension/src/dnr.ts`
- Add an application integration test with injected permissions/installer proving an
  enabled, granted redirect and query rule is installed and reported active.
- Extend the installer to translate query projections as well as redirects; install all
  enabled/granted installable operations during state projection, preserving mock's
  connection-dependent behavior and header installation.
- **Covers:** REQ-021, AC-013.

## 2. Integration harness

### 2.1 Shared process helpers

- **Files:** `test/integration/helpers.ts`
- Add cross-platform Node helpers for temporary directories, child-process spawning via
  `process.execPath`, readiness polling, bounded output capture, and `finally` cleanup.
- No shell commands, shell interpolation, or new dependencies.
- **Covers:** REQ-007, REQ-022-024.

### 2.2 Packaged-install journey

- **File:** `test/integration/packaged-cli.test.ts`
- Pack `schema`, `compiler`, `dry-run`, `editor`, `runtime`, and `cli` into a temporary
  package directory; install all tarballs with `npm install --offline` in a temporary
  project; execute the installed `rogatio` bin.
- Assert valid/invalid `verify`, stdin/JSON output, `test --urls`/`--urls-file`, runtime
  status, help, and version. Keep assertions on exit codes and stable output markers.
- **Covers:** REQ-001-004, REQ-008-009, AC-001-002, AC-012.

### 2.3 Real CLI edit HTTP journey

- **File:** `test/integration/cli-edit.test.ts`
- Invoke `editCommand` with a no-op browser launcher, fetch the real server endpoints,
  validate/save a changed project, confirm atomic file output, and cancel/shutdown.
- Assert editor HTML/vendor bundle are real built content and CSRF rejection remains
  enforced.
- **Covers:** REQ-005, AC-003.

### 2.4 Real mock runtime journey

- **File:** `test/integration/mock-runtime.test.ts`
- Start the built CLI runtime command as a child process with an inline-body mock fixture
  and an ephemeral port. Poll `/v1/connection`; authorize the exact mock route; assert
  status/body; assert an altered token/rule is denied; stop in `finally`.
- Never log or assert random capabilities/tokens directly.
- **Covers:** REQ-006-007, AC-004.

## 3. Playwright browser journeys

### 3.1 Browser test harness

- **Files:** `playwright.config.ts`, `test/browser/helpers.ts`
- Configure real Chromium extension loading with `channel: "chromium"`, persistent temp
  profile, `--disable-extensions-except`, and `--load-extension`.
- Compute extension id from the extension path; provide worker discovery/reacquisition
  and bounded wait helpers. Close contexts and servers deterministically.
- **Covers:** REQ-010, REQ-016, AC-005-008.

### 3.2 Real extension lifecycle

- **File:** `test/browser/extension-real.spec.ts`
- Load `packages/extension/dist`, open its extension page, import a fixture, review real
  permissions, assert `needs permission`, activate a group, inspect badge/status, create
  and switch projects, export, remove, reload/restart context, and prove storage state.
- Do not invoke an unautomatable permission prompt; mark the grant action as documented
  manual evidence and test the adapter seam separately.
- **Covers:** REQ-011-012, AC-005-006, AC-014.

### 3.3 Real DNR contract

- **File:** `test/browser/extension-dnr.spec.ts`
- From the real extension page install a translated redirect rule through Chrome's actual
  DNR API, assert installation succeeds and inspect the resulting dynamic rule shape.
- Use a local HTTP server and a pre-granted-independent shape acceptance check; do not
  claim interception without host permission.
- **Covers:** REQ-013, AC-007.

### 3.4 Real mock check-and-connect

- **File:** `test/browser/extension-mock-runtime.spec.ts`
- Start the real runtime child, load the real extension, import a mock project, activate
  its group, click Check and connect, assert `connected`, then stop the runtime and assert
  the extension reports the failed/disconnected state.
- **Covers:** REQ-014, AC-008.

### 3.5 Real CLI editor browser journey

- **File:** `test/browser/cli-edit-real.spec.ts`
- Spawn the built CLI `edit` command against a temp file with a controlled browser URL
  strategy, connect Playwright to the served editor URL, edit/validate/save, verify the
  resulting file, invoke cancel, and assert child exit.
- Use a test-only environment variable or controlled launcher seam only if necessary;
  never change the shipped behavior or add a product test hook.
- **Covers:** REQ-015, AC-009.

## 4. CI and canonical commands

- **Files:** `package.json`, `.github/workflows/checks.yml`, `scripts/validate.ts`,
  `vitest.config.ts`, `playwright.config.ts`
- Include `test/integration/**/*.test.ts` in Vitest's root include.
- Keep `pnpm test` authoritative for unit/integration and `pnpm test:browser` authoritative
  for Playwright. Ensure `pnpm validate` invokes both through existing scripts.
- Keep browser CI on real Chromium and cross-platform integration/packaged tests in the
  existing cross-platform jobs. Do not weaken CI to a duplicate subset.
- **Covers:** REQ-025, AC-015.

## 5. Verification order

1. Run focused unit/regression tests while authoring each contract.
2. Run integration tests against built artifacts and packed tarballs.
3. Run real-browser journeys with `pnpm test:browser`.
4. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`,
   `pnpm test:browser`, and `pnpm validate`.
5. Review generated-output status; remove all tarballs, temp profiles, traces, and spike
   files before release.

## 6. Rollback

All repairs are additive/backward-compatible. If a browser journey exposes a contract
change, revert only the repair and corresponding tests, return to specification review,
and do not weaken the assertion to obtain green.
