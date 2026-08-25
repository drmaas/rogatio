# F13 — Mock Rules Implementation Plan

**Approved specification:** `docs/specs/f13-mock-rules.md` (Stage 4 gate passed
2026-08-23; OQ-1..OQ-5 resolved).
**Architecture:** F13 section in `docs/architecture.md`.
**Scope guardrail:** Implement only the approved mock-rule slice. Do not add F14 native
messaging/TLS/PAC/request-body behavior, F15 response-body or F17 request-body rules,
path-based mock routing, or Stage 11 release actions.

## Ordered Tasks

### T1 — Schema: mock rule type, payload, bounds, validation

- **Files:** `packages/schema/src/types.ts`, `packages/schema/src/limits.ts`,
  `packages/schema/src/schema.ts`, `packages/schema/src/validation.ts`.
- **Behavior/Invariants:** `RuleType` gains `"mock"`; add `MockHeader` and `MockAction`
  (`status`, optional `headers`, optional `delayMs`, optional `body`, optional `file`);
  `RogatioRule.mock?: MockAction`. Add the F13 limits to `LIMITS`. Extend the rule `$def`
  with `mock` and an `if/then` requiring it when `type === "mock"`. Semantic validation
  enforces status range, exactly-one-of body/file, header name/value bounds + no
  NUL/control/`:` in names, delay range, body length, file path length + no controls,
  with stable diagnostics at stable paths.
- **Acceptance coverage:** AC-001 through AC-004.
- **Verification:** `packages/schema/test/mock.test.ts` (new) plus existing schema
  suite.

### T2 — Compiler: MockOperation

- **Files:** `packages/compiler/src/types.ts`, `packages/compiler/src/compile.ts`.
- **Behavior/Invariants:** Add `MockOperation { kind: "mock"; groupId; ruleId; matcher;
  mock: MockAction }`; widen `RogatioOperation`; emit it when `rule.type === "mock"`.
  Matcher normalization unchanged.
- **Acceptance coverage:** AC-001.
- **Verification:** `packages/compiler/test/mock.test.ts` (new).

### T3 — Runtime: preset extension, mock serving, connection endpoint, port

- **Files:** `packages/runtime/src/types.ts`, `packages/runtime/src/limits.ts`,
  `packages/runtime/src/canonical.ts`, `packages/runtime/src/preset.ts`,
  `packages/runtime/src/mock.ts` (NEW), `packages/runtime/src/server.ts`,
  `packages/runtime/src/index.ts`.
- **Behavior/Invariants:**
  - Preset gains an optional `mocks` array (`RuntimeMockConfig`); normalization accepts
    it, canonical bytes cover it deterministically, digest covers config but not tokens.
  - `RuntimeServerOptions` gains `port?: number` (default `0`).
  - Server startup mints one 32-byte random per-rule mock token (memory-only, bound to
    ruleId + instance). Mock tokens are never logged or echoed.
  - New routes: `GET /mock/<token>` (serve configured status/headers/delay/body; inline
    body UTF-8; file body via `readConfinedFile` under the configured root with fatal
    UTF-8 validation; bounded abortable delay; CORS headers; GET/HEAD/OPTIONS only, 405
    otherwise; never uses the outbound connector) and `GET /v1/connection` (returns
    `{ protocol: "f13-v1", port, presetDigest, mocks: [{ ruleId, token }] }`, CORS
    headers). The F6 control routes keep no-CORS and authorization-only behavior.
  - Stopping the server invalidates tokens and aborts active mock work.
- **Acceptance coverage:** AC-005 through AC-011.
- **Verification:** `packages/runtime/test/mock.test.ts` (new) using real loopback HTTP
  and temp file fixtures.

### T4 — CLI: `rogatio runtime` + mock dry-run previews

- **Files:** `packages/cli/src/commands/runtime.ts`, `packages/cli/src/index.ts`
  (help text), `packages/cli/src/commands/test.ts`, `packages/cli/src/server/routes.ts`.
- **Behavior/Invariants:** `rogatio runtime [path]` (default cwd `.rogatio.json`, `-`
  for stdin) validates + compiles, builds the runtime preset (file rules resolved
  against `--root`, default project dir; outside-root rejected), starts the server on
  `127.0.0.1:8890` (or `--port`), prints connection info + instructions, stops cleanly
  on SIGINT/SIGTERM. Exit `1` on invalid project (verify-style diagnostics), `2` on
  port/startup/IO failure. `rogatio test` and the `edit` server `/api/dry-run` pass a
  mock `previewAction` (via the F12 seam) that maps matcher ops back to `MockOperation`
  and emits `{ kind: "mock", summary }` (`"Mock <status> (inline body, N bytes)"` /
  `"Mock <status> (file snapshot: <basename>)"`).
- **Acceptance coverage:** AC-012 through AC-014.
- **Verification:** `packages/cli/test/runtime.test.ts` (new) + updated
  `packages/cli/test/test.test.ts` / `routes.test.ts`.

### T5 — Extension: manifest, projection, mock DNR install, Check-and-connect

- **Files:** `packages/extension/public/manifest.json`,
  `packages/extension/src/projection.ts`, `packages/extension/src/dnr.ts`,
  `packages/extension/src/service-worker.ts`, `packages/extension/src/protocol.ts`,
  `packages/extension/src/chrome.ts` (fetch adapter for the connection endpoint),
  `packages/extension/src/extension-page-entry.ts`.
- **Behavior/Invariants:**
  - Manifest adds `"declarativeNetRequest"` to `permissions`.
  - `projectMatchers` handles `MockOperation` (installable, matcher preserved).
  - `createDnrInstaller` accepts an optional mock-URL resolver; mock ops translate to
    DNR `redirect` rules targeting `http://127.0.0.1:<port>/mock/<token>` plus one
    high-priority `allow` rule matching the mock URL substring (loop protection).
  - New `check-mock-runtime` command (protocol): fetch `/v1/connection` (port from
    message, default 8890), verify every enabled mock rule has a token, store connection
    info in memory, transition mock runtime state via `RuntimeStateController`
    (disconnected→checking→connected/failed with `lastCheck`), install mock DNR rules,
    recompute statuses + badge. State response includes the mock runtime state.
  - `operationStatuses`: mock ops → `needs proxy` when not connected; `active` when
    connected + installed; stable `error` when connected but the runtime lacks a token
    for the rule.
  - Extension page gains a Check-and-connect button + mock runtime status readout.
- **Acceptance coverage:** AC-015 through AC-020.
- **Verification:** `packages/extension/test/mock-status.test.ts` (new) + updated
  `projection.test.ts`, `dnr.test.ts`, `service-worker.test.ts`, `protocol.test.ts`,
  `extension-page.test.ts`.

### T6 — Editor: mock rule type + editor fixes for selectable payload types

- **Files:** `packages/editor/src/rule-types/mock.ts` (NEW),
  `packages/editor/src/rule-types/index.ts`, `packages/editor/src/index.ts`,
  `packages/editor/src/types.ts`, `packages/editor/src/editor.ts`.
- **Behavior/Invariants:** Add `createMockRuleType` (status/delay/header rows/body-vs-
  file selector; `matches` on `type === "mock"` OR a `mock` payload; `defaultAction` =
  `{ status: 200, body: "" }`; `actionField: "mock"`; validation enforcing bounds +
  exactly-one-body-source). Register in `builtInRuleTypes`, export. Editor fixes
  required by the spec: `RuleTypeFieldExtension` gains optional `actionField` (default
  `"action"`); `setRuleType` writes both `type` and the extension's `actionField`;
  `setValueAtPath` allows creating `mock` (and `redirect`) fields; `clearActionFields`
  also clears `mock`/`action` when switching types.
- **Acceptance coverage:** AC-021, AC-022.
- **Verification:** `packages/editor/test/mock.test.ts` (new) + updated
  `packages/editor/test/editor.test.ts`.

### T7 — Host wiring: CLI editor + extension page register the mock rule type

- **Files:** `packages/cli/src/commands/edit.ts` (generated editor HTML),
  `packages/extension/src/extension-page-entry.ts`.
- **Behavior/Invariants:** The `edit` server's editor page and the extension page pass
  `createMockRuleType()` (alongside `createRedirectRuleType`) so mock rules are
  selectable in both hosts.
- **Acceptance coverage:** AC-021.
- **Verification:** existing editor/edit host tests + a manual/Playwright check.

### T8 — Verification, review, documentation

- **Files:** `README.md` (status + usage), `docs/architecture.md` (status line),
  `docs/specs/f13-mock-rules.md`, `docs/plans/f13-mock-rules.md` (this file),
  `docs/f13-workflow.md`.
- **Behavior/Invariants:** Run the canonical `pnpm validate`; run up to three
  fresh-context review rounds; keep docs synchronized; no brainstorm artifacts.
- **Acceptance coverage:** AC-023, AC-024.
- **Verification:** `pnpm validate` green; `git diff --check`; tracked/untracked scope
  audit; release prep per Stage 11.

## Generated And Local-Only Files

Do not commit `node_modules/`, package `dist/`, build manifests, coverage, Playwright
output, browser binaries, caches, environment files, secrets, or traffic/body captures.
The lockfile and F13 source/tests/docs are source controlled; emitted runtime output is
generated and ignored.

## Rollback

Rollback reverts the schema/compiler/editor/extension/CLI/runtime changes and restores
documentation to the pre-F13 state. No migration or feature flag is needed: mock rules
are additive, the schema stays v1, and the runtime preset `mocks` field is optional.
