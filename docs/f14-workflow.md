# F14 Workflow Record — Native-Messaging Runtime Control

Status: **approved and implemented**; canonical validation passing.

## Stage trace

| Stage | Result | Notes |
| --- | --- | --- |
| 0 — Worktree | Done | `feature/f14-macos-runtime` at `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/f14-macos-runtime`, base `main` `b8c8ab6`. |
| 1 — Brainstorm | Done (ephemeral) | Two-pass; the adversarial pass surfaced the macOS-only restriction as a false assumption. |
| 2 — Architecture | Done | `docs/architecture.md` F14 section (capability-based activation). |
| 3 — Specification | Done | `docs/specs/f14-macos-runtime.md` (REQ-001..REQ-031, AC-001..AC-016). |
| 4 — Human review gate | **APPROVED** | User approved with "approved, proceed" (m0047) after the capability-based revision. |
| 5 — Plan | Done | `docs/plans/f14-macos-runtime.md`. |
| 6 — Tests first | Done | `packages/runtime/test/f14-{revalidate,envelope,pac,lifecycle}.test.ts`, `packages/cli/test/runtime-command.test.ts`. |
| 7 — Implementation | Done | `packages/runtime/src/f14-{types,envelope,revalidate,pac,lifecycle,interception}.ts`; CLI `runtime` command real. |
| 8 — Verification | Done | `pnpm install`, `format:check`, `lint`, `typecheck`, `build` (14 artifacts), `test` (314 unit), `validate` (314 unit + 14 browser E2E). All green. |
| 9 — Review | Done (fresh-context self-review, single-model) | See Findings below. |
| 10 — Documentation | Done | `README.md` runtime row updated; architecture F14 section kept in sync; this record created. |
| 11 — Release | Blocked | No commit/push/PR without explicit user authorization. |

## Tier / models

Free tier. Single-model session (`opencode/hy3-free`). Role passes (plan, tests,
implementation, verification, review, docs) executed as distinct self-reviews; no
silent tier substitution.

## Verification evidence

- `pnpm build`: built 14 ESM artifacts (incl. new `packages/runtime/dist/node/index.js`).
- `pnpm test`: 42 files, 314 tests passed.
- `pnpm validate`: unit + 14 Playwright browser tests passed; "Validation completed successfully."
- `pnpm lint` / `pnpm typecheck` / `pnpm format:check`: clean.

## Review findings (Stage 9, round 1)

Severity: none actionable.
- Spec/implementation/plan/tests consistent. Body-exclusion is enforced structurally
  (`containsBodyKey` recursive scan + `serializeEnvelope`/`parseEnvelope` guards) and
  covered by `f14-envelope.test.ts`.
- `revalidateAuthority` re-derives from canonical project + compiled operations; no
  grant-boolean parameter exists, so the browser grant cannot be trusted.
- Activation is capability-based: default detector returns `unsupported`
  (`no-capability-provider`); `unsupported` is independent of OS name, per approved spec.
- Idempotent `stop`, explicit Start/Stop, no auto-start verified in `f14-lifecycle.test.ts`.

## Deferred (per approval)

Live TLS interception, device-local CA trust install, and the macOS PAC/extension
collision probe are deferred to F15/F17. Seams exist: `detectCapabilities` injection on
`createNativeRuntimeController` and `registerInterceptionProvider` in `f14-interception.ts`.

## Known limitations

- In this headless Linux CI environment the runtime reports `unsupported` on `start`
  (no device-local CA / PAC capability). That is the designed capability-based behavior,
  not a regression.
- Bodies, credentials, and file contents never cross the `f14-v1` envelope.
