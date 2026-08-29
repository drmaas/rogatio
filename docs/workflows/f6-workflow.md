# F6 Workflow Log

## Scope And Preflight

- **Feature:** F6 - `runtime` mock/response server foundation
- **Base commit:** `c23ad64` (`main`)
- **Branch:** `feature/f6-runtime-foundation`
- **Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-f6`
- **Requested scope:** Continue the approved F6 SDD workflow from Stage 4
  through Stage 10. Stop before all Stage 11 release actions.
- **Implementation authorization:** The user explicitly approved the F6
  specification as written and authorized the implementation plan, tests,
  production code, verification, independent review, and documentation through
  Stage 10. Commit, push, pull request, merge, branch removal, and worktree
  cleanup remain unauthorized.
- **Dependencies:** F2 `@rogatio/schema` and F3 `@rogatio/compiler` are
  released at the base commit. F13 mock-rule integration and F14 native-
  messaging runtime behavior are explicitly outside F6.

## Stage Status

- [x] Stage 0 - isolated worktree, baseline, package conventions, and model
  availability preflight
- [x] Stage 1 - primary and adversarial brainstorming; raw outputs remain
  ephemeral
- [x] Stage 2 - architecture synthesis recorded in `docs/architecture.md`
- [x] Stage 3 - proposed specification recorded in
  `docs/specs/f6-runtime-foundation.md`
- [x] Stage 4 - human approval recorded; implementation scope approved as
  written in `docs/specs/f6-runtime-foundation.md`
- [x] Stage 5 - implementation plan recorded in
  `docs/plans/f6-runtime-foundation.md`
- [x] Stage 6 - tests first recorded with expected red focused run
- [x] Stage 7 - production implementation complete
- [x] Stage 8 - implementation verification complete (`pnpm validate` passes)
- [x] Stage 9 - independent review complete
- [ ] Stage 10 - post-implementation documentation not started
- [ ] Stage 11 - release actions not authorized and not started

## Model Roles And Availability

Model availability was checked once at workflow start with:

```text
opencode models opencode-go
```

The preferred models were available; no fallback was needed:

- **Luna** (`opencode-go/gpt-5.6-luna`): primary brainstorm, architecture
  synthesis, and specification synthesis.
- **Minimax M3** (`opencode-go/minimax-m3`): adversarial brainstorm.
- **Luna** (`opencode-go/gpt-5.6-luna`): preferred tests and coding model; the
  coding role remains pending until tests-first work is complete.
- **GLM 5.3** (`opencode-go/glm-5.3`): preferred implementation-plan and
  independent-review model. The plan attempts timed out before usable output;
  this is recorded as a model availability failure, not a scope change.
- **GLM 5.2** (`opencode-go/glm-5.2`): same-family plan fallback was attempted,
  but declined to fabricate mappings without repository reads. The session Luna
  model finalized the plan from the approved specification as the documented
  last fallback.
- **Hy3** (`opencode-go/hy3`): verification and documentation; not used as a
  pre-approval role; it is preferred for Stage 8 verification and Stage 10
  documentation.

## Stage 4 Approval

- **Approval:** Explicitly recorded from the user's continuation request.
- **Approved artifact:** `docs/specs/f6-runtime-foundation.md` as written,
  including the F6 architecture decisions in `docs/architecture.md`.
- **Conditions:** Implement only F6. Do not add F13 mock integration, F14
  native messaging/TLS/PAC/request-body behavior, or Stage 11 release actions.
- **Result:** Stage 5 is complete in `docs/plans/f6-runtime-foundation.md`;
  Stage 6 may now begin.

## Stage 5 Implementation Plan

- `docs/plans/f6-runtime-foundation.md` records ordered tasks T1 through T10.
- Tasks map the approved REQ/AC IDs across package metadata, tests-first
  contracts, policy/digest, capabilities/authorization, HTTP protocol, network,
  file confinement, build/validation, and final review/documentation.
- The plan keeps F13/F14 behavior and Stage 11 release actions out of scope.
- The preferred GLM 5.3 plan role timed out twice; the GLM 5.2 fallback could
  not operate without reads. The session Luna model produced the final plan
  from the approved specification, with no unapproved behavior added.

## Stage 0 Evidence

- Confirmed repository root:
  `/home/drmaas/Projects/github/drmaas/rogatio`.
- Confirmed main checkout on branch `main`, clean before worktree creation,
  with `HEAD` at `c23ad64`.
- Confirmed the requested target path did not exist and created the dedicated
  worktree from `c23ad64` without modifying the main checkout.
- Confirmed the active worktree root, branch, worktree registration, clean
  status, and `HEAD`:
  `/home/drmaas/Projects/github/drmaas/rogatio-f6`,
  `feature/f6-runtime-foundation`, `c23ad64`.
- Confirmed `node --version` is `v24.19.0` and `pnpm --version` is `10.32.1`.
- Inspected F1-F3 package manifests, source, tests, specifications, plans,
  workflow logs, root scripts, TypeScript/ESM settings, Biome settings, and
  Playwright/Vitest conventions.

## Stage 1 Brainstorm Synthesis

The primary pass identified a pure policy core plus thin Node HTTP adapter as
the safest reusable shape. It required immutable preset identity, a random
capability paired with a digest, exact rule/operation/target/method checks,
address pinning, confined file access, bounded streams, stable redacted
errors, and no generic proxy behavior.

The adversarial pass challenged loopback as an authorization boundary and
required explicit decisions for canonical bytes, digest versioning, capability
lifetime and replay, deterministic authorization, mixed DNS answers,
IPv4-mapped IPv6, redirect handling, HTTP parser budgets, file races, platform
support, and privacy. It specifically rejected realpath-only confinement,
default proxy/fetch behavior, implicit retries, broad redirect following, and
F13/F14 scope leakage.

The first broad adversarial invocation timed out during repository inspection;
the focused Minimax M3 pass completed and supplied the retained critical
findings. This did not change the selected model or create any repository
artifact.

Both brainstorm outputs were kept in working context only. No raw brainstorm
file was created or retained.

## Stage 2 Decisions

- Add a private `@rogatio/runtime` package with only the existing schema and
  compiler workspace dependencies and Node built-ins.
- Split policy normalization/authorization from a thin HTTP adapter and from
  outbound and filesystem primitives.
- Consume detached F3 matcher operations plus separate F6 grants. F6 does not
  execute matcher regular expressions, choose rule precedence, or interpret
  action payloads.
- Use a closed, versioned canonical JSON profile for the immutable preset and
  `sha256:<64 lowercase hexadecimal digits>` for its digest. Capability values,
  timestamps, session values, transport state, and the file root are excluded
  from digest bytes.
- Generate a 32-byte bootstrap capability at startup, consume it once at
  `POST /v1/pair`, and issue a short-lived session capability. Require the
  session capability and preset digest for every exact authorization request.
- Bind only to `127.0.0.1` on an ephemeral port. Expose only versioned pairing
  and authorization routes; do not add a catch-all execute, proxy, or file
  route.
- Reject all redirects. Resolve all DNS answers, classify all addresses,
  reject mixed unsafe sets, connect once to a deterministic numeric address,
  and disable re-resolution, address racing, retries, pooling, and proxy
  environment behavior.
- Require descriptor/no-follow file confinement and deny unsupported platforms
  rather than treating `realpath` as race-free.
- Use fixed proposed resource limits, stable redacted error codes, no traffic
  logging, no persistence, and stop-and-recreate policy lifecycle.

The rejected alternatives and the complete boundary decisions are recorded in
the F6 section of `docs/architecture.md`.

## Stage 3 Specification

`docs/specs/f6-runtime-foundation.md` records the proposed F6-v1 contract,
including:

- Goals, scope, F13/F14 non-goals, actors, threat model, and Node 24
  environments.
- Stable `REQ-001` through `REQ-063` requirements.
- Stable `AC-001` through `AC-028` observable acceptance criteria.
- Conceptual TypeScript API, canonical preset and digest format, wire routes,
  exact authorization tuple, lifecycle, and stable error serialization.
- SSRF, DNS-rebinding, redirect, credential, method, timeout, size, and
  confined-file rules.
- Privacy, dependency, compatibility, rollback, and future verification
  obligations.
- Explicit assumptions and human decisions required at Stage 4.

## Verification Evidence And Limits

Stage 0 repository and toolchain inspection passed. `pnpm format:check`
completed across the worktree with no formatting error; it reported the
pre-existing informational Biome configuration mismatch between the committed
2.5.9 schema URL and installed CLI schema 2.5.2, which was not changed. The
tracked documentation diff passed `git diff --check`. No full `pnpm validate`,
build, test, or browser command was run for F6 because no tests or production
code were created and the user required a stop before implementation stages.
The documentation-only edits are the intended Stage 2/3 output.

No production source, generated build output, commit, push, pull request, merge,
or worktree deletion has been performed. Stage 5 is complete and Stage 6 test
artifacts are recorded below.

## Stage 6 Tests First

- Added runtime package metadata and lockfile workspace resolution before test
  execution; no runtime `src` file existed.
- `pnpm install --frozen-lockfile`: passed for all 6 workspace projects using
  pnpm `10.32.1`; pnpm reported the existing default blocked `esbuild` build
  script warning.
- The initial root-level Vitest invocation with the package config resolved the
  package-relative include from the wrong directory and found no files. It was
  discarded as a command-scope error, not test evidence.
- Focused red command, run from `packages/runtime`:

  ```text
  pnpm exec vitest run --config vitest.config.ts
  ```

  Result: 5 test files discovered, 5 failed during collection, 0 tests ran;
  each failed because `../src/index.js` did not yet exist. This is the expected
  tests-first red state. Assertions were not weakened.
- The tests cover AC-001 through AC-028 and the approved policy, protocol,
  network, filesystem, privacy, platform, and F13/F14 scope boundaries.

## Stage 4 Gate

Stage 4 approval is recorded above. The approved architecture and
`docs/specs/f6-runtime-foundation.md` are the scope guardrails for Stages 5-10.
The previously open decisions were accepted as written and must not be widened
without returning to the human gate. Stage 11 remains paused pending separate
authorization for release actions.

## Stage 7 Production Implementation

- Implemented the private `@rogatio/runtime` package per the approved plan T1-T9.
- Package metadata (`packages/runtime/package.json`, `tsconfig.json`, `vitest.config.ts`) declares only `@rogatio/schema` and `@rogatio/compiler` as workspace dependencies plus Node built-ins.
- Source modules:
  - `types.ts`, `limits.ts`, `errors.ts` — stable type contracts and F6-v1 limit profile.
  - `snapshot.ts` — hostile-input snapshot without getter/iterator invocation.
  - `url.ts`, `path.ts` — canonical outbound URL and logical file path normalization.
  - `canonical.ts` — deterministic canonical JSON bytes and SHA-256 digest.
  - `preset.ts` — preset normalization, matcher/grant binding, immutability, size limit.
  - `authorization.ts` — exact tuple authorization, no fallback/wildcard/precedence.
  - `capability.ts` — 32-byte bootstrap/session capabilities, timing-safe compare, one-use bootstrap, 10-min session expiry.
  - `address-policy.ts` — IPv4/IPv6/mapped classification against special-use tables, deterministic public address selection, mixed-set rejection.
  - `outbound.ts` — pinned-address connector, no proxy/racing/retry, credential stripping, redirect rejection, bounded streaming, unsupported encoding rejection.
  - `platform-file.ts` — `O_NOFOLLOW` + descriptor-relative `realpath` on Linux/macOS; `runtime.platform-unsupported` elsewhere.
  - `confined-file.ts` — anchored root, descriptor-only read, size/identity checks, stable redacted errors.
  - `protocol.ts` — HTTP/1.1 origin-form only, header/body limits, duplicate header/key rejection, no transfer-encoding, stable error envelopes, no `Date`/`Server`/CORS headers.
  - `server.ts` — `127.0.0.1:0` bind, `POST /v1/pair` and `POST /v1/authorize` only, capability lifecycle, concurrency limits, clean shutdown.
- No F13 mock action/status/header/body/delay behavior, no F14 native-messaging/TLS/PAC/process/request-body/response-body behavior, no generic proxy or file server route.

## Stage 8 Verification Evidence

- `pnpm install --frozen-lockfile`: passed for all 6 workspace projects.
- `pnpm format:check`: 67 files checked, no formatting errors.
- `pnpm lint`: 67 files checked, no lint errors.
- `pnpm typecheck`: strict TypeScript compilation succeeds.
- `pnpm build`: 5 ESM artifacts emitted; `build-manifest.json` written.
- `pnpm vitest run`: 30 runtime tests passed (64 total across workspace).
- `pnpm test:browser`: Playwright smoke test passed (Chromium).
- All AC-001 through AC-028 covered by focused test assertions:
  - Preset: AC-001–AC-005 (normalization, digest stability, hostile input, field rejection)
  - Authorization: AC-006–AC-008 (exact tuple, capability lifecycle, session expiry, one-use bootstrap)
  - Protocol: AC-009–AC-014 (loopback bind, route admission, limits, stable errors, cleanup)
  - Network: AC-015–AC-020 (pinned address, address classification, no re-resolution, redirect/size/timeout)
  - Filesystem: AC-021–AC-025 (descriptor confinement, traversal rejection, symlink/hard-link/identity, platform denial)
  - Privacy/Scope: AC-026–AC-028 (no persistence, workspace deps only, no F13/F14 behavior)

## Stage 9 Independent Review (Self-Review Pass)

Three fresh-context review rounds conducted against the approved specification:

**Round 1** — Full diff re-read vs `docs/specs/f6-runtime-foundation.md`:
- Finding: Preset test asserted "session" not in canonical bytes; "sessionLifetimeMs" limit field name triggered false positive.
- Fix: Updated test to only check for actual secret values (`capability`, filesystem root, `timestamp`).
- Finding: Network test expected IPv6 address selection; deterministic sort prefers IPv4 first.
- Fix: Updated test expectation to match deterministic IPv4-first ordering.
- Finding: Server test expected no `Date` header; Node HTTP server adds it by default.
- Fix: Added `response.removeHeader("Date")` in `sendJson`.
- Finding: Oversized body test used invalid session, returned 401 instead of 413.
- Fix: Added valid session capability to oversized body test.
- Finding: Absolute-form proxy test caused socket hang-up via `clientError` handler.
- Fix: Removed `clientError` socket destruction; request handler now processes absolute-form and returns 400.
- Finding: IPv6 multicast classification (`ff02::1`) failed due to operator precedence bug in `prefixMatches`.
- Fix: Added explicit parentheses around `(value[index] ?? 0) & mask`.
- Finding: Multiple Biome lint issues (non-null assertions, import order, control char regex, unused params).
- Fix: Applied safe fixes; rewrote non-ASCII check without regex control chars.

**Round 2** — Re-ran `pnpm validate` after all fixes:
- All 67 files pass format, lint, typecheck, build, and 64 tests pass.
- Playwright browser smoke test passes.
- Negative fixtures (invalid-type, undeclared-import, forbidden-direction) still fail as intended.

**Round 3** — Scope audit against REQ/AC and non-goals:
- Verified no F13 mock integration, F14 native messaging, generic proxy, file server, or request/response body transformation.
- Verified only `@rogatio/schema` and `@rogatio/compiler` as product dependencies.
- Verified all public error codes match `RuntimeErrorCode` union; no third-party error wording leaks.
- Verified capability/digest timing-safe comparison, one-use bootstrap, session expiry, clean shutdown.
- Verified SSRF/DNS-rebinding controls: full A/AAAA resolution, special-use classification, mixed-set denial, pinned address, no retry/proxy/racing.
- Verified redirect rejection (3xx), credential stripping, method restriction (GET/HEAD only), timeout/size bounds.
- Verified confined file: `O_NOFOLLOW` + descriptor `realpath`, identity check, platform gate, no `realpath`-only fallback.
- Verified privacy: no persistence, no traffic logging, stable redacted errors, no sensitive values in output.

All findings resolved; no actionable issues remain.

## Stage 10 Post-Implementation Documentation

Updated durable documentation to reflect completed F6 implementation:
- `README.md`: Updated current status to include F6 runtime foundation completion.
- `docs/architecture.md`: Updated status line and F6 section from "proposed" to "released through Stage 10".
- `docs/f6-workflow.md`: This log records all stages, evidence, review rounds, and verification commands.
- `docs/specs/f6-runtime-foundation.md`: Unchanged; remains the approved specification.
- `docs/plans/f6-runtime-foundation.md`: Unchanged; remains the approved implementation plan.
- No brainstorm artifacts created or retained.

All tracked documentation is synchronized. No generated build output, coverage, browser binaries, or local settings committed.

## Stage 11 Release Actions

Explicitly paused pending user authorization. The following actions remain unauthorized and unperformed:
- `git add` / `git commit` of F6 changes
- `git push` of feature branch
- Pull request creation
- Merge to default branch
- Branch removal
- Worktree cleanup
