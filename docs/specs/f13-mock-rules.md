# F13 — Mock Rules

**Status:** Approved specification (Stage 4 gate passed 2026-08-23).
**Feature:** F13
**Depends on:** F2 (schema), F3 (compiler), F5 (editor), F6 (runtime foundation), F7 (extension shell), F8 (CLI), F12 (dry-run seam).
**Tier:** Single-model session (`z-ai/glm-5.2`) per user decision; all SDD role passes by the session model with distinct role framing.

## 1. Problem statement and goals

Rogatio rules today run entirely in the browser (redirect, query, header). Users have no
way to serve fixed responses for development — mocking an API with a canned status,
headers, body, or delay — so front-end work against an unstable or absent backend is
impossible.

F13 adds a **mock** rule type that, for matched requests, returns a configured HTTP
status, optional response headers, an optional delay, and either an inline body or a
live UTF-8 snapshot of one approved local file. Mocks **never contact upstream**. The
rule slice integrates with the F6 runtime server (which serves the responses), the
editor (rule fields), the CLI (`rogatio runtime` starts the server), and the extension
(DNR redirect + a single user-clicked **Check and connect** whose status represents the
last check, not continuous monitoring).

Goals:
- Add `type: "mock"` to the version-1 schema with a bounded, validated payload.
- Emit a `MockOperation` from the compiler.
- Extend the F6 runtime server to serve configured mock responses (inline or confined
  file snapshot) through unguessable per-rule capability tokens, without weakening the
  F6 security model.
- Let the CLI start the mock runtime from `.rogatio.json`.
- Let the extension redirect matched requests to the mock runtime and report correct
  status (`needs proxy` when disconnected, `active` when connected and installed).
- Let the editor author mock rules and the dry-run preview them.

## 2. Scope and non-goals

In scope:
- Schema: `type: "mock"`, `mock` action payload, bounds, semantic validation.
- Compiler: `MockOperation`.
- Runtime: mock-serving route, per-rule tokens, connection endpoint, bounded delay,
  confined-file live UTF-8 snapshots, CORS on the mock route only.
- CLI: implement `rogatio runtime` (start the mock server from the project file,
  `--port`, `--root`); mock action previews in `rogatio test` and the `edit` server.
- Extension: manifest `declarativeNetRequest` permission; mock DNR redirect translation
  plus loop-protection `allow` rule; `check-mock-runtime` command; mock runtime state
  and statuses; extension-page Check-and-connect button and status readout.
- Editor: mock `RuleTypeFieldExtension` (status/headers/delay/body-or-file fields) with
  validation.
- browser-core: reuse `RuntimeStateController` and the status model; no core status
  change.
- Tests and documentation across all touched packages.

Explicit non-goals (deferred):
- F14 native-messaging runtime, TLS/PAC, request-body handling, and its separate
  process; response-body rewriting (F15) and request-body rules (F17).
- Multiple files per mock rule, path-based routing (different content per request URL),
  or template/placeholder substitution in mock bodies.
- Editing file *content* or picking files from the browser (the editor stores a
  validated path string; existence is validated by the CLI at runtime start).
- Continuous runtime monitoring or auto-discovery beyond the fixed default port.
- The bounded `[Rogatio]` DevTools console record (deferred to a later feature).

## 3. Actors, entry points, supported environments

- **CLI user:** `rogatio runtime` starts the mock server; `rogatio verify`/`edit`
  validate mock rules; `rogatio test` dry-runs them.
- **Extension user:** opens the extension page, grants declared access, activates
  groups, then clicks **Check and connect** once to connect the mock runtime and install
  mock DNR rules.
- **Browser:** matched requests are redirected by DNR to the mock runtime and receive
  the configured response.
- **Runtime (F6 server):** serves mock responses and the connection endpoint.
- Supported environments: Linux/Windows/macOS Chrome (matches `rogatio-overview.md`);
  the runtime and CLI run on Node 24+.

## 4. Functional requirements

### Schema

- **REQ-001** — `RuleType` gains `"mock"`. A mock rule declares `type: "mock"` and
  carries `mock: MockAction` (required iff `type === "mock"`).
- **REQ-002** — `MockAction` is `{ status: number; headers?: MockHeader[]; delayMs?:
  number; body?: string; file?: string }` with `MockHeader = { name: string; value:
  string }`. `additionalProperties: false` applies at every object level.
- **REQ-003** — `status` is a required integer in `[200, 599]` (`minMockStatus`/
  `maxMockStatus`).
- **REQ-004** — Exactly one of `body` or `file` is present. `body` is a string of at
  most `maxMockInlineBodyLength` (64 KiB) characters (may be empty). `file` is a
  non-empty string of at most `maxMockFilePathLength` (2048) characters with no NUL or
  control characters.
- **REQ-005** — `headers` is optional with at most `maxMockHeadersPerRule` (32) entries;
  each `name` is non-empty and at most `maxMockHeaderNameLength` (256), each `value` at
  most `maxMockHeaderValueLength` (4096). Header names are not restricted to the
  forbidden-header lists (mocks serve responses the user controls), but names must not
  contain NUL/control characters or `:`.
- **REQ-006** — `delayMs` is an optional integer in `[0, maxMockDelayMs]` (30 000).
- **REQ-007** — Semantic validation returns stable diagnostics at stable JSON-pointer
  paths for every violation above. Unknown rule shapes surface `schema.unknown-property`.

### Compiler

- **REQ-008** — `compileProject` emits `MockOperation { kind: "mock"; groupId; ruleId;
  matcher: NormalizedMatcher; mock: MockAction }` for `type === "mock"` rules; the
  `RogatioOperation` union is widened. Matcher normalization is unchanged.

### Runtime

- **REQ-009** — The internal F6 preset gains an optional `mocks` array
  (`{ ruleId, status, headers, delayMs, body?, file? }`, `file` a relative logical
  path). Presets without `mocks` behave exactly as before. Canonical bytes and the
  SHA-256 digest cover the mock config (deterministic ordering preserved); per-rule
  tokens are excluded.
- **REQ-010** — Server startup mints a fresh 32-byte cryptographically random token per
  mock rule, stored only in memory, bound to the ruleId and server instance. Tokens are
  never logged or echoed in error responses.
- **REQ-011** — `GET /mock/<token>` serves the configured response for the matching
  rule: optional delay, configured status and headers (default `Content-Type:
  text/plain; charset=UTF-8` when none configured), and a body from the inline string
  (UTF-8) or a live confined-file read. The route is reachable only over the loopback
  listener.
- **REQ-012** — The mock route emits permissive CORS headers (`Access-Control-Allow-
  Origin: *`, plus `OPTIONS` handling) so web pages can read mock responses via cross-
  origin XHR/fetch. The F6 control protocol never emits CORS.
- **REQ-013** — A file-based mock is served through the confined-file reader under the
  trusted startup root, re-read on every request (live snapshot). The bytes must be
  valid UTF-8 (fatal decode). Invalid UTF-8, missing, or unreadable files return a
  stable redacted error status and never reveal the path.
- **REQ-014** — The mock route accepts `GET`, `HEAD`, and `OPTIONS`; other methods
  return a stable `405`. The route never uses the outbound connector (mocks never
  contact upstream).
- **REQ-015** — The delay is bounded by the schema limit, cancelled on client disconnect
  and server stop, and subject to the server's operation/body timeouts. Mock serving is
  bounded by the server's concurrency limits.
- **REQ-016** — `GET /v1/connection` returns `{ protocol: "f13-v1", port, presetDigest,
  mocks: [{ ruleId, token }] }`, loopback-only. Authorization of this endpoint is the
  gate decision in §10 (OQ-2).
- **REQ-017** — `createRuntimeServer` gains an optional `port` (default `0` ephemeral);
  the mock runtime uses the fixed default `127.0.0.1:8890` unless overridden. A port
  conflict fails with a clear stable error. Stopping the server invalidates all tokens
  and aborts active mock work.

### CLI

- **REQ-018** — `rogatio runtime [path]` reads `.rogatio.json` (default cwd, `-` for
  stdin), validates + compiles via F2/F3, builds the runtime preset (file rules resolved
  against the configured root, default the project directory; paths outside the root are
  rejected), starts the server on the fixed default port, prints connection info and
  instructions, and stops cleanly on SIGINT/SIGTERM. `--root <dir>` and `--port <n>`
  override defaults. Invalid projects exit `1` (same diagnostics style as `verify`);
  port/startup/IO failures exit `2`.
- **REQ-019** — `rogatio test` and the `edit` server provide a mock `previewAction` via
  the existing F12 seam producing e.g. `{ kind: "mock", summary: "Mock 200 (inline body,
  42 bytes)" }` or `"Mock 200 (file snapshot: <basename>)"`. The dry-run engine is
  unchanged.

### Extension

- **REQ-020** — The manifest adds `"declarativeNetRequest"` to `permissions` (required
  for dynamic DNR rules; grants implicit redirect access without host permissions).
- **REQ-021** — Mock operations project as installable rules; once connected, the
  service worker installs a DNR `redirect` rule per mock op targeting
  `http://127.0.0.1:<port>/mock/<token>`, plus one high-priority `allow` rule matching
  the mock URL substring (loop protection: Chrome DNR re-evaluates redirected requests).
- **REQ-022** — A `check-mock-runtime` command fetches
  `http://127.0.0.1:<port>/v1/connection` (port from the message, default `8890`),
  verifies every enabled mock rule has a token, stores the connection info in memory,
  transitions the mock runtime state through `RuntimeStateController`
  (`disconnected → checking → connected/failed` with `lastCheck`), installs the mock DNR
  rules, and recomputes statuses and badge. The state response includes the mock runtime
  state.
- **REQ-023** — Mock rules report `needs proxy` while the runtime is not connected;
  `active` when connected and installed; a stable `error` diagnostic when connected but
  the runtime has no token for the rule (project changed after start — directs
  restarting `rogatio runtime`). The mock runtime state is in-memory and resets to
  `disconnected` on service-worker restart (status = last check).
- **REQ-024** — The extension page gains a **Check and connect** button and a mock
  runtime status readout (phase + last-check result), meeting the same accessibility
  requirements as the rest of the page.

### Editor and dry-run

- **REQ-025** — The editor gains a `mock` `RuleTypeFieldExtension` rendering status,
  optional delay, header name/value rows (add/remove), and a body-source selector
  (inline textarea vs. file path input). Validation enforces the schema bounds and the
  exactly-one-body-source invariant with stable field diagnostics. `createMockRuleType`
  is exported and registered in `builtInRuleTypes`.
- **REQ-026** — The editor browser bundle remains free of Node imports; the mock
  extension uses only the F5 `RuleTypeFieldContext` surface.

### Cross-cutting

- **REQ-027** — No test or runtime path contacts upstream, persists test data, logs
  tokens or file paths, or introduces secrets/generated artifacts. Public diagnostics
  and serialized output are deterministic and free of third-party wording.

## 5. Acceptance criteria

### Schema / compiler

- **AC-001** — A valid mock rule (`type: "mock"`, status 200, inline body) compiles to a
  `MockOperation` with the correct payload and `ok: true`.
- **AC-002** — A mock rule with both `body` and `file` set is rejected; one with neither
  is rejected (stable diagnostic at `/mock`).
- **AC-003** — A mock rule with an out-of-range status (e.g. 199 or 600), a
  non-integer status, a negative/over-limit `delayMs`, an over-limit inline body, an
  over-limit header count/name/value, or a file path with control characters is rejected
  with the corresponding stable diagnostic.
- **AC-004** — A mock rule with an unknown property on `mock` (e.g. `path`) is rejected
  (`schema.unknown-property`); no unvalidated passthrough.

### Runtime

- **AC-005** — Starting a server with a preset containing mock rules mints one token per
  rule; `GET /mock/<token>` returns the configured status, headers, and inline body
  (UTF-8), with the default `Content-Type` when none is configured.
- **AC-006** — `GET /mock/<unknown-token>` returns a stable redacted error (e.g. 404);
  a request without a token returns the same; no token value appears in any response.
- **AC-007** — A file-based mock serves the current file contents (live: changing the
  file between requests changes the response), valid UTF-8 enforced; an invalid-UTF-8,
  missing, or unreadable file returns a stable redacted error status and never reveals
  the path.
- **AC-008** — A mock with `delayMs` delays the response by approximately that amount
  and is cancelled on client disconnect and on server stop; `delayMs: 0` responds
  immediately.
- **AC-009** — The mock route sends permissive CORS on `GET`/`OPTIONS` and rejects
  unsupported methods (`POST` → 405); the F6 control routes emit no CORS headers.
- **AC-010** — The preset digest covers the mock config but not the tokens: changing a
  mock rule's status/body changes the digest; two starts with the same project produce
  different tokens but the same digest.
- **AC-011** — `GET /v1/connection` returns the port, digest, and per-rule tokens; the
  mock route never contacts upstream (verified with a stubbed outbound connector that
  fails if called).

### CLI

- **AC-012** — `rogatio runtime` on a valid project starts the server on the fixed
  default port, prints connection info, serves a mock, and stops cleanly on SIGINT.
- **AC-013** — `rogatio runtime` on an invalid project exits `1` with diagnostics; on a
  port conflict or unreadable file exits `2`; a file mock outside the configured root is
  rejected before serving.
- **AC-014** — `rogatio test` (and the `edit` server dry-run) includes a mock
  `actionPreview` for matching mock rules.

### Extension

- **AC-015** — The manifest declares `declarativeNetRequest`; the build-time manifest
  check passes.
- **AC-016** — `check-mock-runtime` with a reachable runtime transitions the mock state
  to `connected` (with `lastCheck.ok = true`), installs mock DNR redirect rules plus the
  loop-protection `allow` rule, and reports enabled+granted mock rules as `active`.
- **AC-017** — `check-mock-runtime` with an unreachable runtime transitions to `failed`
  (with `lastCheck.ok = false`), installs no mock DNR rules, and reports mock rules as
  `needs proxy`.
- **AC-018** — When connected but a mock rule has no token from the runtime, that rule
  reports a stable `error` diagnostic directing a runtime restart; other rules remain
  `active`.
- **AC-019** — The mock runtime state is included in the extension state response; the
  extension page renders a Check-and-connect button and the mock runtime status, operable
  by keyboard and screen reader.
- **AC-020** — The mock DNR redirect rules exclude the mock server URL from the
  extension's own redirect matching (loop protection), verified in a browser test with a
  broad `regexFilter`.

### Editor

- **AC-021** — The editor mock extension mounts status/delay/header/body-source fields,
  validates bounds and the exactly-one-body-source invariant, and sets `type: "mock"` +
  `mock` on the rule; it is rejected when two extensions match the same rule (existing
  invariant preserved).
- **AC-022** — The editor browser bundle and artifact contain no Node imports or
  downstream package imports (existing boundary checks pass).

### Cross-cutting

- **AC-023** — All existing suites (schema, compiler, editor, extension, browser-core,
  runtime, dry-run, CLI) remain green after fixtures are updated; `pnpm validate` passes.
- **AC-024** — No secrets, local settings, or generated artifacts are introduced; the
  change stays within the declared packages and docs.

## 6. API / file-format / compatibility changes

- `.rogatio.json` schema version remains `1`. Rules gain the optional `type: "mock"`
  variant and optional `mock` payload; existing rule types and actionless matchers are
  unaffected (backward compatible, no migration).
- New exported types: `MockAction`, `MockHeader`, `MockOperation` (compiler);
  `RuntimeMockConfig`, `MockConnectionInfo` (runtime).
- Runtime wire additions: `GET /mock/<token>` and `GET /v1/connection`; the F6 control
  routes are unchanged.
- CLI: `rogatio runtime` changes from a stub to a real command with `--port`/`--root`.
- Extension: new `check-mock-runtime` command; manifest gains `declarativeNetRequest`;
  state response gains mock runtime state.

## 7. Security, privacy, performance, accessibility, operational

- **Authorization:** mock responses are gated by unguessable per-rule tokens (32-byte
  random, memory-only). The connection endpoint's authorization is the gate decision
  (OQ-2); the recommended open-loopback design is bounded because mock content is
  user-configured and the one approved file is user-selected, and the route is
  loopback-only. Tokens are never logged or echoed.
- **No upstream:** the mock route never uses the outbound connector; mocks cannot be
  turned into an SSRF or proxy primitive.
- **File confinement:** file mocks reuse the F6 confined-file reader (descriptor/no-
  follow, anchored root, size limits); the CLI rejects paths outside the configured
  root.
- **Privacy:** no traffic/body logging, no persistence of mock state beyond the
  `.rogatio.json` file, no telemetry.
- **Performance:** bounded body/header/delay limits; bounded concurrency; delay is
  abortable.
- **Accessibility:** the extension-page Check-and-connect control and the editor mock
  fields meet the existing keyboard/screen-reader/forced-colors/200%-zoom contract.
- **Operational:** `rogatio runtime` is scriptable with stable exit codes; port conflicts
  fail clearly.

## 8. Migration, rollout, backward compatibility

- No envelope/version migration (stays v1). Mock rules are additive alongside existing
  rule types. Actionless matchers remain valid and `unsupported`.
- The F6 preset `mocks` field is optional; presets without it behave exactly as before.
- Rollout: the user starts `rogatio runtime`, then clicks Check-and-connect in the
  extension; until connected, mock rules report `needs proxy` and are not installed.

## 9. Open questions / assumptions (resolved at gate)

- **OQ-1 (resolved)** — Fixed default port `8890` for `rogatio runtime`; `--port`
  overrides; port conflict fails clearly.
- **OQ-2 (resolved)** — Connection endpoint authorization: **open loopback** with the
  documented threat model (bounded by user-configured content and loopback-only).
- **OQ-3 (resolved)** — Bounds accepted: inline body ≤ 64 KiB, delay ≤ 30 s, status
  200–599, ≤ 32 headers, header name ≤ 256 / value ≤ 4096.
- **OQ-4 (resolved)** — File paths resolve against the configured root (default project
  directory); the CLI rejects paths outside the root.
- **OQ-5 (resolved)** — Mock action previews are included in `rogatio test`/editor
  dry-run via the F12 seam.
- **Assumption** — Chrome DNR re-evaluates redirected requests, so the loop-protection
  `allow` rule is required; verified against Chrome docs and confirmed in a browser test
  (AC-020).
- **Assumption** — `declarativeNetRequest` permission grants implicit redirect access
  without host permissions (verified against Chrome docs); no `127.0.0.1` host
  permission is required for the mock redirect target.
- **Assumption** — A mock rule returns one configured response regardless of the matched
  URL path (no path-based routing).

These are confirmed/denied at the Stage 4 gate.
