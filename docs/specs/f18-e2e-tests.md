# F18 — E2E and Integration Test Suite

**Status:** Approved and implemented
**Feature:** F18
**Depends on:** all features (F1-F17)
**Packages:** `@rogatio/cli`, `@rogatio/editor`, `@rogatio/extension`, `@rogatio/runtime`,
`@rogatio/schema`, `@rogatio/compiler`, `@rogatio/dry-run`; new `test/integration/` and
`test/browser/` suites
**Reference base:** `c3fb505` on `main`

## Problem and goals

Every feature F1-F17 ships with per-package unit tests and small fixture-based browser
tests, but there is no full-product suite that proves the shipped artifacts work together
the way a user consumes them. The existing `test/browser/extension.spec.ts` mocks the
`chrome` API; the editor fixture bypasses the CLI; the runtime is tested in isolation;
and nothing installs the packed CLI and runs it as a real binary. As a result, real
boundary defects survive: the extension passed bare origin patterns to
`chrome.permissions` (rejected by Chrome), the permission grant lost its user gesture
across the service-worker message round trip, the extension editor crashed because hosts
re-register built-in rule types, the packed CLI binary could not execute, and
enabled+granted redirect/query rules were never installed into DNR.

F18 adds the missing end-to-end and integration suite:

- **Integration tests** (`test/integration/`, Vitest): real-process journeys over the
  built artifacts — the CLI `edit` HTTP server, the CLI `verify`/`test` commands, and the
  mock runtime pairing/authorization/mock-response journey over real loopback HTTP.
- **Packaged-install tests**: `pnpm pack` every `@rogatio/*` workspace package, install
  the tarballs offline into a temp directory, and run the installed `rogatio` binary as a
  real user would.
- **Playwright headless browser journeys** (`test/browser/`): the real built extension
  loaded into real headless Chromium (lifecycle, DNR rule-shape acceptance, mock
  check-and-connect), and the real CLI `edit` server driven from a real browser.

Goals:

- Prove the full lifecycle of each shipped artifact with real processes and a real
  browser, not mocks.
- Keep every test cross-platform (Linux, Windows, macOS CI) and deterministic.
- Surface and fix the real boundary defects the suite exposes, with regression coverage.
- Keep the permission prompt and the F17 live path as explicit, documented manual or
  capability-gated boundaries rather than fake-greening them.

## Scope

### In scope

- `test/integration/` Vitest suite with real CLI/runtime processes and real HTTP.
- Packaged-install test for the CLI (pack → install → run).
- Playwright journeys: CLI `edit`, extension lifecycle, extension DNR rule-shape
  acceptance, mock check-and-connect.
- Product repairs required by the suite (permission origin patterns, gesture-bound
  grant, editor rule-type registration, CLI shebang and Windows path, DNR install
  wiring), each with a regression test.
- Test harness helpers (spawn/cleanup processes, temp dirs, extension context).

### Explicit non-goals

- Automating the Chrome optional-host-permission prompt. It is un-automatable
  (evidence: `chrome.permissions.request` never resolves when a prompt is required;
  profile pre-seeding is rejected; Playwright upstream issue #32755). The F18 suite
  asserts `needs permission` statuses from real `chrome.permissions.contains`, covers the
  grant flow at the injected-adapter seam, and documents the grant click as a manual
  check.
- Re-running the F17 capable-macOS live E2E (kept gated by `F17_LIVE_E2E`).
- New product features beyond the repairs listed above.
- New third-party dependencies, browser binaries, golden Chrome profiles, or test-only
  product hooks.
- Mocking `chrome` APIs inside the browser journeys.
- Performance/load testing, coverage thresholds, or mutation testing.

## Actors and supported environments

| Actor | Responsibility |
| --- | --- |
| CI (Ubuntu, Windows, macOS) | Runs the canonical validation, including the new suites. |
| Developer | Runs `pnpm test:browser` / `pnpm validate` locally; grants permissions manually when the browser journey requires it. |
| Packaged CLI | Real binary produced by `pnpm pack` + `npm install --offline`. |
| Real Chromium | Headless `channel: "chromium"` with the real unpacked extension. |
| Mock runtime | Real `rogatio runtime` process over loopback HTTP. |

Supported on Node.js `>=24`, TypeScript 7, ESM/NodeNext, Linux, Windows, macOS. Chrome is
the browser target; the browser journeys run in the Ubuntu CI job (`pnpm validate`), and
the integration/packaged suites also run in the cross-platform job.

## Functional requirements

### Integration suite (`test/integration/`)

- **REQ-001:** The packaged CLI is produced by packing every `@rogatio/*` workspace
  package (`schema`, `compiler`, `dry-run`, `editor`, `runtime`, `cli`) with `pnpm pack`
  into a temp directory, then `npm install --offline` into a second temp project.
- **REQ-002:** The installed `rogatio` binary runs `verify` against a valid fixture
  (exit 0), an invalid fixture (exit 1, stable diagnostics), stdin input (`-`), and
  `--json` output.
- **REQ-003:** The installed binary runs `test` with `--urls`, `--urls-file`, and
  `--json`, producing deterministic dry-run results.
- **REQ-004:** The installed binary runs `runtime status` (capability-negative without
  error on incapable platforms), `--version`, and `--help` without crashing.
- **REQ-005:** The CLI `edit` server journey runs over real HTTP: `GET /editor.html`,
  `GET /vendor/editor.js`, `GET /api/project`, CSRF-protected `POST /api/validate`,
  `POST /api/save` (writes the file), and `POST /api/cancel` (shuts down the server).
- **REQ-006:** The mock runtime journey starts the real runtime process with a fixture
  project, fetches `/v1/connection`, obtains the preset digest and mock tokens, performs
  an authorized mock request that returns the configured status/body, and denies
  unauthorized requests with stable errors. The process is stopped cleanly.
- **REQ-007:** Every integration test cleans up its temp directories, child processes,
  and sockets in `finally` blocks, and uses random/ephemeral ports.

### Packaged-install

- **REQ-008:** The packaged CLI test installs only the packed tarballs (no registry
  network); `npm install --offline` succeeds.
- **REQ-009:** The packaged binary resolves its own version and package.json from the
  installed location on every supported platform (POSIX and Windows separators).

### Browser journeys (`test/browser/`)

- **REQ-010:** The extension E2E loads the real built extension into a persistent
  headless Chromium context (`channel: "chromium"`, `--disable-extensions-except`,
  `--load-extension`), discovers the service worker and the extension page from the
  path-derived extension id, and drives the real extension page.
- **REQ-011:** The extension journey imports a real project through the page file input,
  reviews declared permissions (real `chrome.permissions.contains`), activates groups,
  reads rule statuses and the badge, switches/creates/exports/removes projects, and
  proves storage persistence across service-worker restarts.
- **REQ-012:** The extension page mounts the real editor for the active project (no
  `EditorInitializationError`).
- **REQ-013:** The DNR journey installs a redirect rule in the extension's own translated
  shape through the real `chrome.declarativeNetRequest.updateDynamicRules` API and
  asserts Chrome accepts it (no shape rejection).
- **REQ-014:** The mock journey starts the real mock runtime and drives the extension's
  "Check and connect" flow to a `connected` runtime state.
- **REQ-015:** The CLI `edit` browser journey spawns the built CLI with a temp project,
  edits the project in the browser, validates, saves, verifies the file on disk, cancels,
  and asserts the server process exits cleanly.
- **REQ-016:** Browser journeys run with bounded timeouts, tolerate service-worker
  restarts by re-acquiring the worker, and close every context/process they open.

### Product repairs (regression-tested)

- **REQ-017:** The permission adapter converts origins to match patterns
  (`origin + "/*"`) before `chrome.permissions.contains/request/remove`.
- **REQ-018:** The extension page performs `chrome.permissions.request` inside the click
  gesture and the service worker accepts the page-reported grant (`granted: true`) to
  re-sync stored grants without a second worker-side request.
- **REQ-019:** The editor's rule-type registry replaces built-in ids with passed
  extensions of the same id and rejects duplicates within the passed list.
- **REQ-020:** The CLI built entry carries a shebang and the `isDist` check handles both
  POSIX and Windows separators.
- **REQ-021:** The extension installs enabled+granted installable operations (redirect,
  query, connected mock) through the real installer when project state changes, so they
  reach `active` instead of `error`.

### Determinism and safety

- **REQ-022:** No new dependencies; Node-only orchestration; no shell-only scripts.
- **REQ-023:** Assertions never depend on third-party wording or incidental iteration
  order; diagnostics are stable codes.
- **REQ-024:** Tests use real artifacts (built dist, packed tarballs, real Chrome APIs);
  a test that cannot reach its subject fails rather than skipping, except the documented
  F17 live E2E and the manual grant check.
- **REQ-025:** The canonical validation command (`pnpm validate`) runs the new suites;
  CI runs the same authoritative validation.

## Public data contracts and diagnostics

No new public product API, schema, protocol, or diagnostic vocabulary is introduced.
Repairs keep existing codes and messages. New test helpers live under `test/` and are not
shipped. The extension and editor diagnostics for the repaired paths reuse existing codes
(`extension.invalid-origin`, `editor.extension-registration`, etc.) and do not alter
stable messages.

## Security, privacy, and performance

- The permission boundary is preserved: the grant remains a real user gesture; no fake
  grants, test hooks, or profile forging enter the product.
- Browser E2E uses fresh temp profiles; no committed browser state, credentials, or
  machine-local data.
- All servers bind `127.0.0.1`; random ports; bounded timeouts; no telemetry.
- Packaged-install runs offline (`npm install --offline`), no registry interaction.
- The suite must not slow the canonical validation unreasonably: integration tests keep
  process startup bounded; browser journeys share contexts and use bounded waits.

## Compatibility and rollout

- New test files and helpers only; no product behavior changes outside the listed
  repairs.
- The repairs are backward-compatible: permission patterns, editor registration,
  shebang, and DNR wiring change no public contract.
- Existing F2-F17 suites must continue to pass; the new suites run in the same
  `pnpm test` / `pnpm test:browser` / `pnpm validate` commands.

## Acceptance criteria

- **AC-001:** `pnpm test` runs the new integration suite; packaged CLI verify/test/
  runtime-status/version journeys pass against real tarballs.
- **AC-002:** The packaged CLI test runs on POSIX and Windows path conventions.
- **AC-003:** The CLI `edit` HTTP journey proves editor page, vendor bundle, project
  read, CSRF-protected validate/save, file write, and cancel-shutdown over real HTTP.
- **AC-004:** The mock runtime journey proves connection, pairing digest, authorized
  mock response, and unauthorized denial over real loopback HTTP, with clean shutdown.
- **AC-005:** The extension lifecycle journey (real Chromium, real extension) proves
  import, review, activation, statuses, badge, switch, export, remove, and restart
  persistence.
- **AC-006:** The extension page mounts the real editor without initialization errors.
- **AC-007:** A redirect DNR rule in the extension's translated shape is accepted by real
  Chrome DNR.
- **AC-008:** The mock check-and-connect journey reaches `connected` against a real
  runtime process.
- **AC-009:** The CLI `edit` browser journey saves a real file and the server exits
  cleanly.
- **AC-010:** The permission adapter passes match patterns; the extension page performs
  the gesture-bound request; the worker re-syncs stored grants.
- **AC-011:** The editor registry replaces built-in ids and rejects passed-list
  duplicates (existing duplicate test still passes).
- **AC-012:** The CLI packaged binary executes from the installed bin with the shebang
  and version resolution on POSIX and Windows.
- **AC-013:** Enabled+granted redirect/query rules install and reach `active` (verified
  via the extension application integration test with injected adapters).
- **AC-014:** The permission prompt is documented as a manual check; the F17 live E2E
  stays gated by `F17_LIVE_E2E`; no test hook or fake grant is added.
- **AC-015:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  `pnpm test`, `pnpm test:browser`, and `pnpm validate` pass with no generated output,
  browser binaries, dependencies, secrets, or unrelated changes in the worktree.

## Required test mapping

| Test level | Coverage |
| --- | --- |
| Integration (Vitest) | AC-001, AC-002, AC-003, AC-004, AC-010, AC-012, AC-013 |
| Browser E2E (Playwright) | AC-005, AC-006, AC-007, AC-008, AC-009 |
| Unit regression | AC-010, AC-011, AC-012, AC-013 |
| Package validation | AC-015 |

## Open questions and assumptions

- **Assumption:** the packed-tarball `npm install --offline` is reliable in CI without a
  registry (verified locally; the tarballs carry no external deps).
- **Assumption:** `channel: "chromium"` headless extension loading behaves the same in
  CI as locally (verified locally; CI installs Chromium via `playwright install`).
- **Open:** whether the extension E2E should also run in the macOS CI job; default is
  Ubuntu-only (the `browser` CI job), with the suite written cross-platform.