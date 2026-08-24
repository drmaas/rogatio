# F13 Workflow Log — Mock Rules

## Scope And Preflight

- **Feature:** F13 — Mock rules (configured status, headers, optional delay, inline
  body or live UTF-8 snapshot of one approved local file; never contacts upstream;
  integrates the rule slice with the F6 runtime server, the editor, and the extension,
  including the single user-clicked Check-and-connect request).
- **Base commit:** `b8c8ab6` (`main`).
- **Branch:** `feature/f13-mock-rules`.
- **Worktree:** `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/f13-mock-rules`.
- **Tier:** Single-model session per explicit user decision ("stay with your current
  model for all phases in this session"). Session model: `z-ai/glm-5.2`. Per AGENTS.md
  single-model rule, every SDD role pass is executed by the session model with distinct
  role framing; the fresh-context review is a deliberate self-review.
- **Requested scope:** Full SDD workflow through Stage 11 (release), with explicit user
  approval before each release action (commit, push, PR).
- **Dependencies:** F2 `@rogatio/schema`, F3 `@rogatio/compiler`, F5 `@rogatio/editor`,
  F6 `@rogatio/runtime` (mock/response server foundation), F7 `@rogatio/extension` all
  landed at the base commit. F14 native-messaging runtime and F15/F17 runtime rule types
  are explicitly out of scope.

## Stage Status

- [x] Stage 0 - isolated worktree, setup, model preflight, baseline
- [x] Stage 1 - primary and adversarial brainstorming (ephemeral)
- [x] Stage 2 - architecture synthesis recorded in `docs/architecture.md`
- [x] Stage 3 - proposed specification recorded in `docs/specs/f13-mock-rules.md`
- [x] Stage 4 - human approval recorded; spec approved as written; OQ-1..OQ-5 resolved
  (fixed port 8890, open-loopback connect, proposed bounds, root-confined file paths,
  dry-run previews included)
- [x] Stage 5 - implementation plan recorded in `docs/plans/f13-mock-rules.md`
- [x] Stage 6 - tests first (6 files, 43 new test cases; baseline run confirmed red)
- [x] Stage 7 - production implementation (schema → compiler → runtime → cli →
  extension → editor → host wiring; dry-run preview)
- [x] Stage 8 - verification (`pnpm validate` green: format → lint → typecheck →
  build 14 artifacts → 322 vitest tests → artifact/emitted-module/boundary checks →
  negative fixtures → 14 Playwright browser tests)
- [x] Stage 9 - independent review (self-review, fresh role framing; 3 findings
  addressed: convoluted `hasFileMock` type, misleading `runtime.file-denied` code
  for header-set failures, unused imports/non-null assertions flagged by linter)
- [x] Stage 10 - documentation (README `rogatio runtime` row corrected; mock-rules
  usage section added; architecture.md + spec + plan + workflow log already
  synchronized)
- [x] Stage 11 - release actions (commit-only authorization completed; no push/PR)

## Stage 0 Evidence

- Confirmed repository root: `/home/drmaas/Projects/github/drmaas/rogatio` (main,
  clean, `HEAD` `b8c8ab6`).
- Created the dedicated worktree from `b8c8ab6`:
  `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/f13-mock-rules`,
  branch `feature/f13-mock-rules`. Confirmed worktree root, branch, and clean status.
- A pre-existing worktree `feature/f14-macos-runtime` exists; it is outside F13 scope.
- `node --version` `v24.18.0`, `pnpm --version` `10.32.1`.
- `pnpm install --frozen-lockfile`: passed (esbuild build-script default block warning
  only, pre-existing).
- Baseline: `pnpm build` emitted 13 ESM artifacts; `pnpm exec vitest run` → 37 test
  files, 279 tests passing.
- Canonical validation is `pnpm validate` (format:check → lint → typecheck → build →
  vitest → artifact/emitted-module/boundary checks → negative fixtures → Playwright).
- Model preflight: `opencode models` confirms the free catalog and normal-tier chains
  are available; the user chose a single-model session, so no role dispatch is used.

## Stage 1 Brainstorm Synthesis

Raw brainstorm outputs are ephemeral and were not saved. The primary and adversarial
passes were executed as distinct role framings of the session model.

### User problem and desired outcome

Rogatio rules today run entirely in the browser (redirect/query/header). Users have no
way to serve fixed responses for development — mocking an API with a canned status,
headers, body, or delay — so front-end work against an unstable or absent backend is
impossible. F13 adds a `mock` rule type that returns a configured status, optional
headers, optional delay, and either an inline body or a live UTF-8 snapshot of one
approved local file, never contacting upstream, integrated with the F6 runtime server,
the editor, the extension, and a single user-clicked Check-and-connect.

### Affected systems

- `@rogatio/schema` (F2): `type: "mock"` rule variant, mock action payload, bounds,
  semantic validation.
- `@rogatio/compiler` (F3): emit `MockOperation`.
- `@rogatio/runtime` (F6): mock-serving route, per-rule capability tokens, connection
  endpoint for the extension, confined-file snapshot reads, bounded delay.
- `@rogatio/cli` (F8): implement `rogatio runtime` (starts the mock server from the
  project file).
- `@rogatio/extension` (F7): DNR redirect translation for mock rules, Check-and-connect
  command, mock runtime state + status, manifest `declarativeNetRequest` permission.
- `@rogatio/browser-core` (F4): status computation for mock ops (`needs proxy` when the
  runtime is not connected), runtime state wiring.
- `@rogatio/editor` (F5): mock rule-type extension (status/headers/delay/body/file
  fields).
- `@rogatio/dry-run` (F12): mock action preview via the existing `previewAction` seam.

### Current behavior and limitations

- F6 serves only `POST /v1/pair` and `POST /v1/authorize` (authorization decisions, no
  content); the outbound connector and confined-file reader are primitives for later
  consumers (F13 owns mock response semantics).
- The rule `type` enum is `redirect | query | header`; no mock payload exists.
- The extension reports runtime-dependent statuses as `unsupported`/`needs proxy` but
  nothing populates them yet; `RuntimeStateController` already models
  `mock: disconnected/checking/connected/failed` with `lastCheck`.
- `rogatio runtime` is a stub.
- The F6 control server binds an ephemeral port (port 0); the browser needs a stable
  address for DNR redirect targets.
- The MV3 manifest does not declare the `declarativeNetRequest` permission, so real
  browser DNR installs (F9/F11 and F13 mocks) would no-op; F13 must add it.

### Key constraints and invariants

- F6 security model preserved: loopback-only, capability-based authorization, exact
  grants, confined files, no generic proxy/file server, stable redacted errors, no
  permissive CORS on the control protocol.
- Mocks never contact upstream; the mock route must not use the outbound connector.
- Exactly one approved local file per file-based mock; live UTF-8 snapshot (re-read per
  request, valid UTF-8 required).
- DNR redirects cannot carry custom headers → the mock route needs unguessable per-rule
  capability tokens carried in the redirect URL.
- MV3 extension cannot read arbitrary local files → connection info must be exchanged
  over loopback HTTP from the runtime.
- Editor browser bundle stays free of Node imports.
- Deterministic stable diagnostics; no raw input/paths in public output.
- Rule status model: mock rules report `needs proxy` while the runtime is not connected
  (the model's runtime-dependent status), `active` when connected + installed.
- Single user-clicked Check-and-connect; status = last check, in-memory, not persisted.

### Approaches considered

- **A (selected direction): DNR redirect to a tokenized loopback mock URL + fixed
  default port + runtime connection endpoint.** The extension translates mock ops to
  DNR `redirect` rules targeting `http://127.0.0.1:<port>/mock/<per-rule-token>`; the
  runtime serves the configured response; the extension's Check-and-connect fetches the
  runtime's connection info (port, digest, per-rule tokens), verifies rule coverage, and
  installs the mock DNR rules. Simple, MV3-compatible, matches the one-click UX.
- **B (rejected): ephemeral port + connection file.** The CLI writes connection info to
  a known file for the extension to read; MV3 cannot read arbitrary local files without
  native messaging (F14) or file URLs.
- **C (rejected for connect UX): extension pairs via the F6 control protocol.** Requires
  conveying the bootstrap capability from CLI output into the extension; contradicts the
  "exactly one user-clicked Check and connect" UX.

### Adversarial findings (retained)

1. **CORS:** an XHR/fetch from a web page to `http://127.0.0.1:<port>` is cross-origin;
   the mock route must send permissive CORS headers (or mirror the Origin) or mocks will
   not work for XHR. This is allowed only on the F13 mock route, never the F6 control
   protocol. Preflight (OPTIONS) should be handled.
2. **Redirect loop:** Chrome DNR re-evaluates the redirected request as a new request; a
   broad `regexFilter` (e.g. `.*`) would also match the mock URL and loop. Mitigation:
   install a high-priority `allow` rule matching the mock URL substring
   (`127.0.0.1:<port>/mock/`) so the extension's own redirect rules never apply to the
   mock server. Verified against the Chrome DNR docs (redirect → new request; allow
   beats redirect at equal/higher priority).
3. **Token disclosure:** the connection endpoint returns per-rule tokens to any loopback
   process; a local process could then read configured mock content (including the one
   approved file snapshot). Bounded because content is user-configured/approved and the
   route is loopback-only; the runtime must not log tokens or place them in error
   responses. Flagged as a gate decision (open loopback vs. shared-secret handshake).
4. **Digest/stability:** mock *config* is covered by the F6 preset digest; per-rule
   tokens are capability-like and excluded (stable digest per project). The extension
   cannot cheaply recompute the F6 digest in the browser, so Check-and-connect verifies
   *rule coverage* (every enabled mock rule has a token) rather than the digest; a rule
   missing from the runtime (project changed after start) reports a stable error and the
   message directs restarting `rogatio runtime`.
5. **Fixed-port conflict:** a second `rogatio runtime` or a stale process must fail
   clearly; `--port` override is provided.
6. **Delay lifecycle:** the mock delay must be cancelled on client disconnect and server
   stop, and bounded (schema limit).
7. **UTF-8 file snapshot:** invalid UTF-8 → stable error response (never the path).
   Missing/unreadable file → stable error status with a redacted body.
8. **Method/body:** DNR redirect re-issues the request as GET; mock semantics are
   method-agnostic (never upstream), so this is acceptable. The mock route accepts
   GET/HEAD/OPTIONS only; other methods → stable 405.
9. **Manifest permission:** `declarativeNetRequest` must be added to the manifest so DNR
   installs (and thus mock redirects) work in a real browser; the permission grants
   implicit redirect access without host permissions (verified against Chrome docs).
10. **Status semantics:** mock rules are `needs proxy` while disconnected; when connected
    but the runtime lacks a token for a rule → stable `error` diagnostic directing a
    runtime restart.

### Open questions for the gate

- OQ-1: Fixed default port (proposal: `8890`) for `rogatio runtime` — acceptable?
- OQ-2: Connection endpoint authorization — open loopback (recommended, documented
  threat model) vs. a shared secret pasted once by the user.
- OQ-3: Bounds — inline body max (proposal 64 KiB), delay max (proposal 30 s), status
  range (proposal 200–599), max mock headers (proposal 32), header name/value length
  (reuse header limits).
- OQ-4: File path storage — absolute paths allowed but must resolve inside the
  configured root (default: project directory); editor stores the configured path as a
  string (no browser file picking).
- OQ-5: Include a mock action preview in `rogatio test`/editor dry-run (recommended:
  yes, small, uses the existing `previewAction` seam).

### Provisional success definition

A `mock` rule compiles, validates, edits, dry-runs, and — once `rogatio runtime` is
started and the extension's Check-and-connect succeeds — serves the configured
status/headers/delay/body (inline or live file snapshot) to matched browser requests
without contacting upstream, with correct `needs proxy`/`active` statuses, all under the
canonical `pnpm validate` gate and the F6 security model.

## Stage 6 Evidence — Tests First

Six tests-first files were authored before any production code, exercising the
approved specification (REQ-001..027 / AC-001..024):

- `packages/schema/test/mock.test.ts` (12 cases): `type: "mock"` accepted, status range
  and bounds (inline body 64 KiB, file path 2048, delay 30 s, max 32 headers), exactly-one
  of body/file, unknown property rejection, duplicate header names.
- `packages/compiler/test/mock.test.ts` (3 cases): emits `MockOperation`, preserves
  status/headers/delay/body/file, stable across recompilation.
- `packages/runtime/test/mock.test.ts` (9 cases): serves inline + file mocks, applies
  delay, returns configured status/headers/CORS, 404 on unknown token, 405 on non-GET,
  redacted errors for invalid UTF-8 / unreadable file, connection endpoint returns tokens
  + digest, no-upstream invariant.
- `packages/extension/test/mock-status.test.ts` (8 cases): Check-and-connect probes the
  runtime `/v1/connection`, verifies rule coverage, stores tokens, installs mock DNR
  rules with loop-protection allow rule, transitions `RuntimeStateController` mock state
  through disconnected → checking → connected / failed, reports `needs proxy` while
  disconnected and `active` when installed, stable `error` when a rule is missing.
- `packages/editor/test/mock.test.ts` (7 cases): mock rule type is selectable, sets
  top-level `type: "mock"`, renders status/headers/delay/body/file fields, clears action
  fields on type switch, validates bounds and exactly-one-of body/file.
- `packages/cli/test/runtime.test.ts` (4 cases): `rogatio runtime` reads
  `.rogatio.json`, starts the mock server on port 8890 (override via `--port`), prints
  connection info, exits non-zero on bind failure.

Baseline pre-implementation run: `pnpm exec vitest run` with the new tests in place
against the unchanged production code → 27 failed / 9 passed (red). Confirmed the
tests fail for the intended reasons (missing symbols, wrong behavior), not for setup
or import errors.

## Stage 7 Evidence — Production Implementation

Implemented in dependency order (T1 → T7):

- **T1 schema** (`packages/schema/src/{types,limits,schema,validation,index}.ts`):
  added `type: "mock"` to the rule enum, `MockAction` shape with `status`, optional
  `headers`/`delayMs`/`body`/`file`, semantic validation (status 200–599, exactly one
  of body/file, bounds reusing header limits), `additionalProperties: false`.
- **T2 compiler** (`packages/compiler/src/{types,compile,index}.ts`): added
  `MockOperation` and emit it from `type === "mock"` rules; deterministic ordering.
- **T3 runtime** (`packages/runtime/src/{types,preset,canonical,mock,server,index}.ts`):
  new `packages/runtime/src/mock.ts` serving inline + file mocks (confined-file reader,
  live re-read, valid UTF-8 enforced, redacted errors), per-rule unguessable capability
  tokens, `GET /v1/connection` returning `{ protocol, port, presetDigest, mocks[] }`,
  permissive CORS on the mock route only (preflight handled), bounded/cancellable delay,
  `--port` / default 8890, no upstream contact.
- **T4 cli** (`packages/cli/src/{commands/runtime,commands/test,server/routes,index}.ts`,
  `packages/cli/src/utils/mock-preview.ts`, `packages/cli/package.json`): `rogatio runtime`
  starts the mock server from `.rogatio.json`, prints connection info, exits non-zero on
  bind failure; `rogatio test` and the edit server emit a mock action preview via the
  existing `previewAction` seam; `@rogatio/runtime` added as a workspace dependency.
- **T5 extension** (`packages/extension/src/{mock-runtime,dnr,projection,diagnostics,protocol,service-worker,background,index}.ts`,
  `packages/extension/public/manifest.json`,
  `packages/extension/src/extension-page-entry.ts`): DNR redirect translation for mock
  ops, high-priority `allow` rule on the mock URL substring for loop protection,
  `check-mock-runtime` command (probes `/v1/connection`, verifies rule coverage, stores
  tokens, installs mock DNR rules, transitions `RuntimeStateController` mock state),
  mock status readout + Check-and-connect button on the extension page, manifest
  `declarativeNetRequest` permission (also unblocks F9/F11 installs in real browsers).
- **T6 editor** (`packages/editor/src/{types,rule-types/mock,rule-types/index,index,editor}.ts`):
  new `createMockRuleType()` registering status/headers/delay/body/file fields; editor
  `setRuleType` now writes top-level `type` (compiler dispatches on `rule.type`),
  `setValueAtPath` allows the mock action sub-paths, `clearActionFields` resets them on
  type switch; browser-safe (no Node imports).
- **T7 host wiring** (`packages/cli/src/commands/edit.ts`,
  `packages/extension/src/extension-page-entry.ts`): the CLI edit server and the
  extension page both register `createMockRuleType()` alongside `createRedirectRuleType()`.
- Build config (`scripts/build.ts`, `vitest.config.ts`, `scripts/validate.ts`): added
  the runtime build target, the CLI external + vitest alias for `@rogatio/runtime`, and
  the runtime artifact to the validator's expected-artifact list.

No F6 security invariant was relaxed: loopback-only, capability-based authorization,
exact grants, confined files, no generic proxy/file server, stable redacted errors, no
permissive CORS on the control protocol. Mock serving never uses the outbound connector.

## Stage 8 Evidence — Verification

Final `pnpm validate` run (canonical validation):

- `format:check` (biome formatter): 172 files, clean.
- `lint` (biome linter): 172 files, clean.
- `typecheck` (`tsc --noEmit`): clean.
- `build` (`scripts/build.ts`): 14 ESM artifacts emitted (was 13; +runtime).
- `vitest run`: 43 test files, 322 tests passing (baseline was 37 files / 279 tests;
  +6 files, +43 tests).
- Artifact / emitted-module / boundary checks: all pass (runtime artifact added to the
  expected list; editor browser bundle stays free of Node imports).
- Negative fixtures: preserved (intentional failures still fail as designed).
- `test:browser` (Playwright, 11 workers, chromium): 14 tests passing.

Final `pnpm validate` exit code: `0` ("Validation completed successfully.").

## Stage 9 Evidence — Independent Review

Per AGENTS.md single-model rule, the independent review was executed as a deliberate
self-review with fresh role framing (the session model reviewing its own F13 work as a
different reviewer would). The review examined the full diff against the approved
specification (REQ-001..027 / AC-001..024) and the F6 security invariants.

### Findings addressed

1. **Convoluted type in `server.ts`:** `hasFileMock` used a complex conditional type
   (`ReturnType<typeof normalizeRuntimePreset> extends RuntimeResult<infer T> ? T :
   never`) where `NormalizedRuntimePreset` was the direct, correct type. Simplified to a
   plain named-parameter type; imported `NormalizedRuntimePreset`.
2. **Misleading stable error code in `mock.ts`:** header-set failures (e.g. a header
   name containing invalid characters that `response.setHeader` rejects) returned
   `runtime.file-denied`, which is semantically wrong (the failure has nothing to do
   with the confined-file read). Introduced a distinct `runtime.mock-headers` code so
   the public diagnostic is honest about the failure class while remaining stable and
   path/content-free.
3. **Lint findings (formatter + linter):** reformatted 15 files; fixed 4 lint issues —
   non-null assertions in `mock.ts` rule type (replaced with locally-narrowed
   `const body = mock.body as string` after the `hasBody` guard), an arrow-function
   `forEach` callback returning `row.remove()` (changed to a block body), and two
   unused imports in test files. All auto-fixed where safe; the rest fixed by hand.

### No-issues confirmed

- **Security model:** loopback-only on both the mock route and the connection
  endpoint (consistent with F6's `protocol.ts` IPv4 loopback check); permissive CORS
  only on the mock route; no CORS on the control protocol; tokens never logged or
  echoed in errors; confined-file reader reused for file snapshots with fatal UTF-8
  validation; no upstream contact (mock route never invokes the outbound connector).
- **Stable diagnostics:** all public error codes are stable and independent of raw
  input/paths/content/iteration order.
- **Browser boundary:** the editor browser bundle has no Node imports (Playwright
  `ships a browser artifact without Node runtime leakage` test passes); the extension
  page registers `createMockRuleType()` alongside `createRedirectRuleType()`.
- **Scope:** no F14 native-messaging or F15/F17 runtime rule types pulled in; schema
  stays v1; actionless matchers unaffected.
- **Determinism:** canonical bytes and preset digest cover mock config; compiler
  `MockOperation` emission is stable across recompilation.

### Out-of-scope finding (Stage 11 concern, not a code defect)

`main` has advanced to `64fda51` (F14 native-messaging runtime, PR #18) since the F13
base commit `b8c8ab6`. F14 also touches `packages/runtime` and `packages/cli`, so a
rebase or merge of `feature/f13-mock-rules` onto current `main` will likely conflict
in those packages. The F13 branch is self-consistent and validates green against its
own base; the conflict resolution is a release-stage concern and does not affectthe F13 code's correctness or the approval of the specification/plan.

## Stage 10 Evidence — Documentation

- `docs/architecture.md`: F13 section appended (Stage 2); describes the mock rule
  slice, DNR redirect-to-loopback design, connection endpoint, loop protection, and
  security invariants.
- `docs/specs/f13-mock-rules.md`: approved specification (Stage 3/4).
- `docs/plans/f13-mock-rules.md`: implementation plan with T1–T7 task breakdown
  (Stage 5).
- `docs/f13-workflow.md`: this log, kept current through each stage.
- `README.md`: corrected the `rogatio runtime` command row (was "Documented stub
  … currently exits `1`") to describe the real mock-runtime start command and flags;
  added a "Mock rules" usage section with start/connect workflow and status semantics.
- `rogatio-overview.md` / `sequence.md`: already describe F13 mock rules and the
  single Check-and-connect UX at the right level of detail; no changes needed.
- `AGENTS.md`: no process changes; no edits needed.
- `format:check`: 183 files clean on the combined F13+F14 tree.

## Stage 11 Evidence — Release

- User explicitly authorized **commit only**; no push or PR was performed.
- Original F13 commits were rebased onto current `main` (`64fda51`, F14).
- Rebase conflicts in README, architecture, CLI runtime, and CLI help were resolved
  by preserving F14 native runtime commands (`start`, `stop`, `status`) and adding
  F13 mock-runtime startup as the path/option form of `rogatio runtime`.
- Rebasing replayed the implementation as `2bd07d6`; the final local follow-up commit
  `3f7de99` preserves F14 command compatibility, updates the CLI tests, and records
  the rebase/validation evidence.
- Combined-tree validation after conflict resolution: `pnpm validate` passed — 48
  Vitest files / 357 tests, 14 Playwright tests, build/typecheck/lint/artifact checks.
- No push or PR was performed.
