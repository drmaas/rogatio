# File mocks — implementation checklist

Audience: agent. Work phases in order. Do not start a phase until the previous
phase's acceptance holds. Run the listed tests for a phase before checking its
acceptance box.

Rules for every phase:

- Do not read or write outside the worktree.
- Do not put a logical or absolute path in any diagnostic, status, log line, or
  HTTP failure body.
- Reuse existing limits in `packages/schema/src/limits.ts`. Do not add a limits
  module.
- Keep diagnostics stable and independent of third-party wording or iteration
  order.

Statuses `204`, `205`, and `304` are rejected in Phase 2 semantic validation.

## Phase 1 — Schema: public mock shape

- [x] Add `MockAction` to `packages/schema/src/types.ts` with `status`, optional
      `headers: { name; value }[]`, optional `delayMs`, optional `body`, and
      optional `file`.
- [x] Add `mock?: MockAction` to `RogatioRule` and `"mock"` to `RuleType`.
- [x] Add `"mock"` to the `rule.type` enum in `packages/schema/src/schema.ts` and
      add a `$defs/mockAction` with `additionalProperties: false`.
- [x] Add the `if type === "mock" then required: ["mock"]` conditional beside the
      existing five conditionals.
- [x] Bind every bound to `LIMITS`: `minMockStatus`, `maxMockStatus`,
      `maxMockHeadersPerRule`, `maxMockHeaderNameLength`,
      `maxMockHeaderValueLength`, `maxMockInlineBodyLength`, `maxMockDelayMs`,
      `maxMockFilePathLength`.
- [x] Confirm `migrateV1Project` needs no change, because version 1 has no mock
      rules. Add a test that proves it.

**Acceptance:** a valid mock project passes Ajv validation; a mock rule missing
its `mock` payload, carrying an unknown property, or breaching a `LIMITS` bound
fails at the Ajv layer; no other rule type's output changes.

**Tests:** `packages/schema/test/mock.test.ts` — valid mock, missing payload,
unknown property at rule and payload level, each bound at and past its limit,
and a v1 migration no-op test.

- [x] Phase 1 acceptance verified.

## Phase 2 — Schema: mock semantic validation

- [x] Add `"mock"` to the rule-type enum check in
      `packages/schema/src/validation.ts` and update its `allowedValues` and
      message.
- [x] Add semantic validation with stable instance paths: `/mock/status`,
      `/mock/delayMs`, `/mock/body`, `/mock/file`, `/mock/headers/<i>/name`,
      `/mock/headers/<i>/value`.
- [x] Reject exactly-one-of violations: both `body` and `file`, or neither.
- [x] Reject control characters in header names and header values, and reject
      response-framing and forbidden headers using the existing forbidden-header
      list.
- [x] Reject duplicate header names case-insensitively.
- [x] Validate `file` as a relative logical path: reject absolute paths,
      backslashes, percent escapes, control characters, dot segments, colons,
      and glob characters.
- [x] Replace the negative assertions in `packages/schema/test/mock.test.ts` with
      positive coverage.

**Acceptance:** every invalid case above fails with its own stable path and
code; a valid mock produces no diagnostics.

**Tests:** `packages/schema/test/mock.test.ts` — both-sources, neither-source,
control characters in name and value, forbidden and duplicate headers, each
rejected path form, boundary status and delay values, and adversarial input
(inherited properties, accessors that throw, proxies, cycles, sparse arrays).

- [x] Phase 2 acceptance verified.

## Phase 3 — Browser schema: mirror mock validation

- [x] Add `"mock"` to the rule-type list in
      `packages/extension/src/browser-schema.ts`.
- [x] Mirror every phase 1 and phase 2 rule with identical instance paths,
      codes, and messages.
- [x] Mirror the forbidden-header and logical-path checks.
- [x] Keep the mirror free of Ajv, `node:` imports, and `@rogatio/dry-run`.

**Acceptance:** for every fixture in the phase 1 and 2 suites, the mirror
returns the same ordered diagnostics as `@rogatio/schema`.

**Tests:** a parity test in `packages/extension/test/` that feeds the shared
mock fixtures to both validators and asserts deep equality of the diagnostic
lists; the existing browser-bundle import check still passes.

- [x] Phase 3 acceptance verified.

## Phase 4 — Compiler: `MockOperation`

- [x] Add `MockOperation { kind: "mock"; matcher; mock }` to
      `packages/compiler/src/types.ts` and to the `RogatioOperation` union.
- [x] Add mock-specific codes to `CompilerDiagnosticCode` for forbidden headers
      and body-source violations.
- [x] Add an explicit `type === "mock"` branch in
      `packages/compiler/src/compile.ts` before the fallback matcher branch, so
      a mock rule never compiles to a bare `MatcherOperation`.
- [x] Carry `groupId`, `ruleId`, `name`, `redactSensitiveInLogs`, and the
      normalized matcher unchanged.
- [x] Confirm no existing consumer breaks on the widened union; fix exhaustive
      switches rather than adding default cases.

**Acceptance:** a mock rule compiles to exactly one `MockOperation` with the
normalized matcher; an invalid mock produces a stable diagnostic and no
operation.

**Tests:** `packages/compiler/test/` — mock compiles, operation field-by-field
assertion, diagnostic codes and paths, adversarial rule input, and a test that
the operation union stays exhaustive.

- [x] Phase 4 acceptance verified.

## Phase 5 — Dry run: mock preview

- [x] Add a `kind === "mock"` branch to `previewRuleAction` in
      `packages/dry-run/src/preview.ts`.
- [x] Return `{ kind: "mock", summary }` where the summary states the status, the
      delay when set, the header count when non-zero, and the body source as
      either inline or file-backed.
- [x] Do not read the file, do not stat it, do not contact the runtime, and do
      not report file existence or its path.

**Acceptance:** a matched mock case returns a deterministic summary; the
`dry-run` package still has no network, filesystem, permission, or runtime
import.

**Tests:** `packages/dry-run/test/` — summary text for inline and file-backed
mocks, delay present and absent, zero and many headers, unmatched case returns
`null`, no path disclosure, and an import check proving no filesystem access.

- [x] Phase 5 acceptance verified.

## Phase 6 — Editor: mock rule type

- [x] Add `packages/editor/src/rule-types/mock.ts` exporting
      `createMockRuleType()` with `id: "mock"`, a label, `matches`, `mount`, and
      `validate`.
- [x] Set `actionField: "mock"` and `defaultAction` so type switching initializes
      and clears the payload through the existing path.
- [x] Register it in `packages/editor/src/rule-types/index.ts` beside the five
      built-ins.
- [x] Mount fields for status, delay, a repeatable header list, a body-source
      selector, an inline body textarea, and a relative file path input.
- [x] Author the file path as a logical relative path. Do not add a file upload
      or a directory picker.
- [x] Route validation through the host-supplied `validate` adapter; add no
      editor-local schema.

**Acceptance:** a user can add, edit, copy, remove, save, and reload a mock rule;
switching a rule to and from `mock` initializes and clears `mock` cleanly; an
invalid draft blocks save with field-level errors.

**Tests:** `packages/editor/test/` — add/copy/remove, type switch in both
directions, draft stays detached until save, each field maps to the right
`/mock/...` path, and the browser-bundle check still finds no `node:` import,
Ajv, or `@rogatio/dry-run`.

- [x] Phase 6 acceptance verified.

## Phase 7A — Runtime: confined binary file reads

- [x] Harden the shared confined reader so the opened descriptor is proven
      beneath the canonical root even during intermediate symlink replacement.
      Report `runtime.platform-unsupported` where the platform cannot prove it.
- [x] Replace `packages/runtime/src/mock-file.ts` with a descriptor-based read
      that reuses the hardened reader: no-follow open, bounded chunk reads,
      hard-link rejection, post-read `fstat`, abort handling, raw `Uint8Array`.
- [x] Remove the fatal UTF-8 decode so binary bodies pass through unchanged.
- [x] Do not weaken grant authorization for the existing `readConfinedFile`
      callers.
- [x] On macOS, prove confinement with `openat` and `fcntl(F_GETPATH)` through
      `koffi`. If that library cannot load, report `runtime.platform-unsupported`.
      Do not fall back to a path-only open.

**Acceptance:** the reader returns exact binary bytes only when descriptor
confinement is proved. Every denial has a stable, redacted error.

**Tests:** `packages/runtime/test/mock.test.ts` — non-UTF-8 bytes, leaf and
intermediate symlink races, hard link, replacement race, missing file, file at
and over `maxFileBytes`, out-of-root path, unsupported platform, and no path in
any error.

- [x] Phase 7A acceptance verified.

## Phase 7B — Runtime: render a mock response

- [x] Propagate distinct stable errors from `renderMockResponse`:
      `runtime.file-denied`, `runtime.file-race-rejected`,
      `runtime.platform-unsupported`, `runtime.timeout`, `runtime.size-limit`.
      Stop collapsing them to `runtime.file-denied`.
- [x] Make header handling deterministic: keep configured headers in order, set
      `Content-Length` from the real byte length, apply `Cache-Control: no-store`
      unless the user set it, and default `Content-Type` to
      `application/octet-stream` when absent.
- [x] Apply `delayMs` inside rendering, honoring an `AbortSignal` so a client
      disconnect cancels the wait.
- [x] Add a method parameter so `HEAD` returns the same status and headers with
      no body, and `Content-Length` still reports the full size. Apply the delay
      and file read to `HEAD`.

**Acceptance:** rendering returns exact bytes for binary and inline bodies, a
distinct error per failure mode, deterministic headers, and an abortable delay.

**Tests:** `packages/runtime/test/mock.test.ts` — inline and file bytes, each
stable render error, zero delay, delay at `maxMockDelayMs`, aborted delay,
duplicate and reserved headers, configured and default headers, `HEAD`, and no
path in any error.

- [x] Phase 7B acceptance verified.

## Phase 8A — Runtime: preset mocks and confined root

- [x] Populate `preset.mocks` from compiled `MockOperation`s in the deferred
      `runtime.project.set` path in `packages/runtime/src/lifecycle.ts`.
- [x] Populate `preset.mocks` the same way in the explicit CLI path in
      `packages/cli/src/commands/runtime.ts`.
- [x] Confirm `normalizeRuntimePreset` accepts the mocks and ties each to its
      matcher; extend it only where a real gap exists.
- [x] Tighten preset header validation to reject control characters in header
      values, not only names.
- [x] Accept optional `fileRoot` and bounded `enabledGroupIds` in
      `runtime.project.set` metadata. Reject unknown, duplicate, or malformed
      group ids. Build mocks only for enabled groups.
- [x] Validate `fileRoot` as an absolute path to an existing directory and
      resolve its real path.
- [x] Reject a relative, missing, non-directory, or unreadable root with a stable
      error, and report it on the `runtime.project.set` reply.
- [x] Use the resolved root for the session; never fall back to the process
      working directory.
- [x] Confirm the canonical preset digest covers mock config and still excludes
      minted per-rule values.

**Acceptance:** a project with mock rules yields a preset whose mocks match the
compiled operations. Its digest is stable across restarts. An invalid or absent
root fails file-backed mocks closed and never uses the process working
directory.

**Tests:** `packages/runtime/test/preset.test.ts` and
`packages/runtime/test/canonical.test.ts` — mocks reach the preset, digest
stability, digest changes when mock config changes, digest unchanged when tokens
change, disabled-group mocks receive no token, and malformed group ids fail.
For the missing-root case, place a matching file in the process working
directory and prove it is not read.

- [x] Phase 8A acceptance verified.

## Phase 8B — Runtime and CLI: native framing and startup

- [x] Make `--root` required when `rogatio runtime host` reads a stdin project
      containing file mocks. Keep `dirname(projectPath)` as the default for an
      explicit project path.
- [x] Exercise the largest valid inline mock through native framing. If
      `runtime.project.set` exceeds 64 KiB, reuse bounded multipart staging for
      project config. Do not raise the envelope limit or use `mock.response`.

**Acceptance:** the maximum valid inline mock reaches the host through real
native framing. CLI root defaults and requirements match the project source.

**Tests:** `packages/cli/test/` — stdin without `--root` exits non-zero with a
stable message only for file mocks, and an explicit path defaults to its
directory. Host-bridge coverage sends the largest valid inline mock through
native framing and proves rendered bytes do not enter a native envelope.

- [x] Phase 8B acceptance verified.

## Phase 9A — Runtime: serve mocks on the loopback listener

- [x] Add a `/.rogatio/mock/<token>/<digest>` route to the loopback listener in
      `packages/runtime/src/intercept-proxy.ts`, beside `/.rogatio/body/`.
- [x] Add a parser next to `parseResponseBodyRedirect` and export the prefix so
      the extension can stay in sync.
- [x] Authorize every request by resolving the fresh session token to one active
      mock and matching the active preset digest. Rule ids and digests alone are
      insufficient. Reject stale, unknown, or stopped-session requests with a
      stable status and empty body.
- [x] Serve the rendered mock for any method the rule allows; handle `HEAD` per
      phase 7B. Never expose a general file route.
- [x] Never inspect or buffer an incoming request body. Drain it with
      backpressure, reuse the existing concurrent-operation bound, and abort
      delay/read work on disconnect.

**Acceptance:** the capability route serves only the active token and digest.
Allowed methods reach rendering. Stale or malformed requests fail with an empty
body. Response bytes remain on loopback HTTP.

**Tests:** `packages/runtime/test/` — hostile route URLs, missing or unknown
token, digest mismatch, stopped session, token expiry after restart, allowed and
disallowed methods, `HEAD`, binary body over the 64 KiB envelope cap, client
disconnect mid-delay, bounded concurrent delayed requests, a large discarded
request body, generic empty HTTP failures, and no path in any reply.

- [x] Phase 9A acceptance verified.

## Phase 9B — Runtime: protocol retirement and redacted file errors

- [ ] Delete `startMockFaucet` from `packages/runtime/src/host.ts`, drop
      `mockPort` from `NativeHostOptions` and the controller, and remove
      `--mock-port` from `rogatio runtime host`.
- [ ] Keep token minting and the internal `mock.connect` exchange. Remove
      `mock.request`, `mock.response`, `mockBody`, and their body-envelope
      exception after proving no caller remains.
- [ ] Add a bounded, redacted per-rule last-error map on the controller. Record a
      request-time file failure, clear the entry on the next successful read,
      and clear the whole map on project replacement, start, and stop.
- [ ] Expose the map through the existing `runtime.status` reply. Never include a
      path.
- [ ] Return a generic HTTP failure status with an empty body for render and file
      failures. Keep the distinct stable code on `runtime.status`, not in the
      page-visible response.
- [ ] Clean up on client disconnect: abort the delay and the read.

**Acceptance:** a file error appears as a stable code and clears exactly as
locked decision 3 specifies. No retired protocol path remains callable.

**Tests:** `packages/runtime/test/` — error recorded then cleared by a later
successful read, error cleared by project replacement and restart, bounded-map
eviction, no retired envelope accepted, generic empty HTTP failures, and no path
in any reply.

- [ ] Phase 9B acceptance verified.

## Phase 10A — Extension: session DNR mock redirects

- [ ] Bound the response-body band: change `isResponseBodyRedirectId` to an
      inclusive range starting at `4_000_001` and ending below the mock band.
- [ ] Add `packages/extension/src/mock-redirect.ts` with `MOCK_REDIRECT_ID_MIN`,
      an `isMockRedirectId` range check, a rule builder, and install and remove
      functions that mirror `response-body-redirect.ts`.
- [ ] Build the redirect target as
      `http://127.0.0.1:<port>/.rogatio/mock/<token>/<digest>` using the
      existing `projectSourceCondition` projection.
- [ ] After runtime start, call the internal `mock.connect` exchange and require
      exactly one token for each enabled mock before installing redirects.
- [ ] Omit `requestMethods` when the rule has no method filter; set exactly the
      filtered method when it has one.
- [ ] Add a higher-priority session `allow` rule that excludes the loopback
      mock route, so a broad user regex cannot redirect the mock response back
      into itself. Set its priority above `LIMITS.maxPriority` and keep its
      condition limited to `127.0.0.1`, the active port, and mock prefix.
- [ ] Retain `kind === "mock"` in the native policy operation filter in
      `packages/extension/src/native-session.ts`.
- [ ] Set `contentListener` true when the project has enabled mock rules, so the
      loopback listener starts without PAC routes.
- [ ] Install mock redirects only after the host reports `started` and a `proxy`
      endpoint; roll back the whole start on install failure.
- [ ] Remove mock redirects and the loop guard on stop and on disconnect.

**Acceptance:** enabling a mock installs exactly one session rule per enabled
mock plus one guard; stopping removes exactly those ids and nothing else;
response-body rules keep working unchanged.

**Tests:** `packages/extension/test/` — band boundaries and no overlap with the
response-body band, builder output for filtered and unfiltered methods, `.*`
regex does not loop, install rollback on failure, stop and disconnect cleanup,
and foreign DNR ids untouched.

- [ ] Phase 10A acceptance verified.

## Phase 10B — Real Chrome mock journey

- [ ] Add a Chrome for Testing journey in `test/browser/` covering a served
      inline mock, a served file mock, and a `POST` mock.
- [ ] Assert the listener receives `POST`. A unit projection test is not a
      substitute for this method-preservation journey.
- [ ] Use an upstream request trap to prove no matched mock request reaches the
      original upstream host.
- [ ] Use a broad authored regex that matches the loopback URL. Prove the
      response serves once without recursion.
- [ ] Stop and disconnect the host, then prove mock session rules and the guard
      are gone.

**Acceptance:** Chrome preserves `POST`, serves both body sources without
upstream traffic or recursion, and removes session rules at lifecycle end.

**Tests:** required Selenium Chrome for Testing journey in `test/browser/`.
Chrome DNR method preservation remains a release risk until this passes.

- [ ] Phase 10B acceptance verified.

## Phase 11A — Extension: mock status and file errors

- [ ] Add a `kind === "mock"` branch to `operationStatuses` in
      `packages/extension/src/service-worker.ts`, following the existing
      body-rule pattern.
- [ ] Map the branch: `disabled` for a disabled group; `unsupported` when the
      native phase is `unsupported` or the source is unprojectable;
      `needs runtime` before the host reaches `started`; `active` only after the
      mock redirect is installed; `error` on projection or install failure.
- [ ] Read the runtime per-rule file-error signal on the existing state refresh
      and override the rule to `error` with a redacted stable diagnostic.
- [ ] Clear the extension's cached file-error overlay immediately after a
      successful project save. A running session is stopped or replaced through
      the existing project-change lifecycle before it can serve stale policy.
- [ ] Add extension diagnostic codes for the mock file-error classes. Do not
      forward the runtime's raw message if it could carry a path.
- [ ] Confirm `computeBadge` counts a mock in error as attention and a mock in
      `needs runtime` as not active.

**Acceptance:** each of the five statuses is reachable and observable from
`get-state`; a request-time file failure flips the rule to `error` and a later
success flips it back; no status or diagnostic contains a path.

**Tests:** `packages/extension/test/` — one case per status, all transitions
through `get-state`, the error override and its clearing, badge math, and
redacted diagnostics.

- [ ] Phase 11A acceptance verified.

## Phase 11B — Extension and core: confined-root storage

- [ ] Add the saved confined root as an optional field on the stored project
      record in `packages/browser-core/src/types.ts`, beside `data`, and read it
      defensively. Exports serialize `data` only. Bump `ENVELOPE_VERSION` only
      if a migration proves unavoidable.
- [ ] Add a management-page control to set and clear the project's mock file
      root, and show it on Project details. Imported browser files do not default
      a root because Chrome does not expose their absolute path.

**Acceptance:** the root round-trips in device-local storage, stays out of
exports, and can be set or cleared from the management page.

**Tests:** `packages/browser-core/test/` and `packages/extension/test/` —
round-trip and export exclusion, defensive read of a corrupt or hostile stored
root, and management-page setting and clearing.

- [ ] Phase 11B acceptance verified.

## Phase 12 — CLI: root and preview surfaces

- [ ] Resolve the confined root for `rogatio edit` from the opened project file's
      directory, and let the user set and clear a saved root through the editor's
      `projectActions`.
- [ ] Persist an override in device-local CLI config keyed by the canonical
      project path. Do not create a project sidecar or place the root inside
      `.rogatio.json`.
- [ ] Confirm `rogatio test` prints the mock preview summary through the shared
      `previewRuleAction` with no CLI-local formatting.
- [ ] Confirm `POST /api/dry-run` returns the same summary for the same case.
- [ ] Confirm `rogatio verify` reports mock diagnostics with their schema paths.
- [ ] Update `rogatio runtime host` help text for the removed `--mock-port` and
      the stdin `--root` requirement.
- [ ] Confirm the bundled CLI still has no workspace dependencies.

**Acceptance:** the three preview surfaces agree byte for byte; the saved root
round-trips; help text matches the real flags.

**Tests:** `packages/cli/test/` — verify output for an invalid mock, test output
for a matched mock, help snapshot, saved-root round-trip;
`test/integration/` — one journey asserting `rogatio test` and
`POST /api/dry-run` return identical summaries from the built artifacts;
`packages/extension/test/` — invoke the extension `dry-run` command with the
same fixture and assert the exact same summary.

- [ ] Phase 12 acceptance verified.

## Phase 13 — Contracts, docs, and validation

- [ ] Add `packages/schema/test/mock-contract.test.ts` pinning the public mock
      shape: the exact `rule.type` enum, the exact `mockAction` property set,
      `additionalProperties: false`, and every bound read from `LIMITS`.
- [ ] Keep the test a pin, not a second schema. Assert against
      `packages/schema/src/schema.ts`; do not restate it.
- [ ] Add a dry-run contract test that pins the mock preview summary from
      `previewRuleAction`. Keep downstream imports out of schema tests.
- [ ] Verify every tooling pointer in `docs/contracts.md` names an existing
      test or canonical command and passes in its owning phase.
- [ ] Confirm `docs/contracts.md` matches the shipped surface and fix any drift.
- [ ] Update `docs/architecture.md` with the mock package boundaries, the DNR
      band amendment, the loopback mock route, and the confined root contract.
- [ ] Update `README.md`, the affected `packages/*/README.md`, and
      `packages/docs-site/` for the new rule type.
- [ ] Run `pnpm validate` and record the evidence against the plan's acceptance
      criteria.
- [ ] Audit staged, unstaged, tracked, and untracked files for generated output,
      local settings, and secrets.

**Acceptance:** `pnpm validate` passes; the schema and dry-run contract tests
fail if their surfaces change; the orientation docs describe shipped behavior.

**Tests:** `packages/schema/test/mock-contract.test.ts`, the dry-run contract
test, plus the full `pnpm validate` sequence.

- [ ] Phase 13 acceptance verified.
