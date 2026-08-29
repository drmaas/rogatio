# Implementation Plan: Consolidated Native Runtime

Feature branch: `feature/consolidated-native-runtime`
Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/consolidated-native-runtime`
Base commit: `d017cad`
Tier: FREE (models recorded in AGENTS workflow log / workflow notes)
Approved spec: `docs/specs/consolidated-native-runtime.md`

## Goal
Replace F6 HTTP runtime server + F13 mock server + F14 native-messaging host with a single
native host that communicates only over the `f14-v1` stdio native-messaging envelope, with
pairing/auth and mock serving delivered as envelope messages. CLI drops the runtime server and
becomes editor/config/setup only.

## Assumptions locked (from approved spec)
- A: only stdio envelope, no HTTP endpoints.
- B: pair/auth as envelope messages, reusing F6 capability token + preset digest.
- C: mock body via base64 `mockBody`, bounded by `ENVELOPE_MAX_BYTES` (64 KiB).
- D: capability gate removed; native host unconditional (no `unsupported`).
- E: delete CLI runtime server (`cli/src/commands/runtime.ts`, `runtime/src/server.ts`, `runtime/src/proxy.ts`).
- Q1: keep manifest version `v1`, negotiate by message type.
- Q2: extend existing `createNativeRuntimeController` (no new consolidated export name).
- Q3: collapse to single `NativeRuntimePhase` (drop `MockRuntimePhase`).
- Q4: mock response headers in a separate `headers` envelope field.

## Order of work

### Task 1 — Runtime type/model extensions  (covers REQ-003, REQ-005, REQ-012)
Files: `packages/runtime/src/types.ts`
- Extend `EnvelopeMessageType` with: `pair.request`, `pair.response`, `authorize.request`,
  `authorize.response`, `mock.connect`, `mock.request`, `mock.response`.
- Add interfaces: `PairRequest`, `PairResponse`, `AuthorizeRequest`, `AuthorizeResponse`,
  `MockConnectRequest`, `MockConnectResponse`, `MockRequest`, `MockResponse`.
  `MockResponse` includes `mockBody: string` (base64) and `headers?: readonly [string,string][]`.
- Keep `ENVELOPE_MAX_BYTES = 64 * 1024`.
Tests: `packages/runtime/src/test/envelope.test.ts` (unit) verifies new types serialize/parse.
AC: REQ-003, REQ-005, REQ-012.

### Task 2 — Envelope body policy  (covers REQ-002, REQ-011)
Files: `packages/runtime/src/envelope.ts`
- Update `containsBodyKey` so `mockBody` is permitted only on `mock.response`; all other
  transform messages still forbid body keys.
- Keep `ENVELOPE_MAX_BYTES` enforcement and `encodeEnvelope`/`decodeEnvelope`.
Tests: `envelope.test.ts` asserts `mock.response` may carry `mockBody`, `transform.request` may not.
AC: REQ-002, REQ-011.

### Task 3 — Native framing supports new types  (covers REQ-002)
Files: `packages/runtime/src/native-framing.ts`
- No structural change needed (4-byte length + JSON already generic); add typed wrappers if
  helpful. Ensure new message types round-trip.
Tests: `native-framing.test.ts` round-trip of each new type.
AC: REQ-002.

### Task 4 — Native controller: pairing/auth/mock lifecycle, unconditional  (covers REQ-001, REQ-004, REQ-006, REQ-009, REQ-010)
Files: `packages/runtime/src/lifecycle.ts`, `packages/runtime/src/interception.ts`,
       `packages/runtime/src/trust.ts`
- `createNativeRuntimeController`: remove `unsupported` state from capability check; always
  `running`/`stopped`. Add pair/auth/mock handlers reusing F6 `pairCapability`/`authorizeExact`
  logic (migrate from deleted `server.ts`).
- `startInterception` / `revalidateAuthority`: keep; apply to all transforms uniformly.
- `trust.ts`: keep CA install/uninstall/trust/untrust/status; manifest stays `v1`.
Tests: `lifecycle.test.ts` (unit) — start with no adapter reports `running`, not `unsupported`;
  pair→authorize→mock.connect→mock.request→mock.response path; revalidation denies invalid.
AC: REQ-001, REQ-004, REQ-006, REQ-009, REQ-010, AC-001, AC-002, AC-003, AC-004, AC-007.

### Task 5 — Delete F6 runtime server + proxy  (covers REQ-008)
Files: `packages/runtime/src/server.ts` (delete), `packages/runtime/src/proxy.ts` (delete),
       `packages/runtime/src/index.ts` (remove exports), `packages/cli/src/commands/runtime.ts`
       (delete server start/stop/status; keep only setup/install/uninstall if present),
       `packages/cli/src/index.ts` (remove `runtime` server subcommand registration).
- Move any still-needed mock/pair logic into `lifecycle.ts`/new `native-mock.ts`.
Tests: `packages/cli/test/runtime-command.test.ts`, `runtime-command-gating.test.ts`,
        `packages/cli/test/runtime.test.ts`, `packages/runtime/src/test/server.test.ts` deleted
        or rewritten to assert absence.
AC: REQ-008, AC-005.

### Task 6 — Extension: unify native session + drop mock-runtime  (covers REQ-007, REQ-013)
Files: `packages/extension/src/service-worker.ts`, `packages/extension/src/native-session.ts`,
       `packages/extension/src/mock-runtime.ts` (delete/merge), `packages/extension/src/protocol.ts`
- `native-session.ts`: extend `NativeRuntimeConfig` + `startNativeSession` to perform
  pair → authorize → mock.connect, returning token map.
- `service-worker.ts`: remove `MockRuntimePhase` and `check-mock-runtime`; single
  `NativeRuntimePhase`; `operationStatuses` returns `"needs proxy"` only when native not `started`.
- `mock-runtime.ts`: delete `DEFAULT_MOCK_PORT`, `fetchConnection`, `mockUrl`; mock URL resolution
  now provided by native session token map.
Tests: `packages/extension/src/test/service-worker.test.ts` (revised) verifies unified phase and
  mock status derived from native session.
AC: REQ-007, REQ-013, AC-006.

### Task 7 — Docs update  (covers spec documentation)
Files: `docs/specs/consolidated-native-runtime.md` (approved), `docs/architecture.md`,
       `docs/guides/runtime.md`, `docs/reference/security.md`,
       delete/replace `docs/specs/f6-runtime-foundation.md`, `f13-mock-rules.md`,
       `f14-macos-runtime.md` (prompt before delete per AGENTS rule).
- Update guides to describe single native host, no separate mock/body server, body confidentiality
  now includes mock response via `mockBody`.
AC: documentation consistency.

### Task 8 — Canonical validation  (covers all)
Run repository validation (format, lint, typecheck, unit, integration, build) after each task.
Record exact commands + output in workflow log.

## Verification matrix
| AC | Task | Test |
|----|------|------|
| AC-001 | 4 | lifecycle.test.ts (no adapter → running) |
| AC-002 | 4 | lifecycle.test.ts (pair/auth) |
| AC-003 | 4 | lifecycle.test.ts (mock.response base64) |
| AC-004 | 4 | lifecycle.test.ts (mock.connect) |
| AC-005 | 5 | cli/runtime tests absent/rewritten |
| AC-006 | 6 | service-worker.test.ts (unified phase) |
| AC-007 | 4 | lifecycle.test.ts (revalidateAuthority uniform) |

## Risks / rollback
- Removing CLI `runtime` server may break existing e2e that starts server via CLI; update
  e2e (`f18-e2e-tests.md`) to start native host via extension instead.
- If native host cannot start on a platform, unconditional model means interception simply
  no-ops (no `unsupported` reported) — acceptable per D.
- Rollback: revert branch; no data migration needed.

## Next
After approval of this plan: Stage 6 (tests first), Stage 7 (implementation), Stage 8 (verify),
Stage 9 (fresh-context review), Stage 10 (docs), Stage 11 (release, pending your authorization).
