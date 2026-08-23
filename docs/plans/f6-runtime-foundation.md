# F6 - Runtime Foundation Implementation Plan

**Approved specification:** `docs/specs/f6-runtime-foundation.md`
**Architecture:** F6 section in `docs/architecture.md`
**Scope guardrail:** Implement only the approved runtime policy foundation.
Do not add F13 mock actions or response behavior, F14 native messaging/TLS/PAC
or request-body behavior, a generic proxy or file server, or Stage 11 release
actions.

## Ordered Tasks

### T1 - Add the private package boundary

- **Files:** `packages/runtime/package.json`,
  `packages/runtime/tsconfig.json`, `packages/runtime/vitest.config.ts`,
  `pnpm-lock.yaml`.
- **Behavior/Invariants:** Add private ESM `@rogatio/runtime` with explicit
  source/type and built Node ESM exports. Declare only `@rogatio/schema` and
  `@rogatio/compiler` as workspace product dependencies. Preserve Node 24,
  TypeScript 7, NodeNext, and default lifecycle-script blocking.
- **Acceptance coverage:** REQ-001 through REQ-004, AC-027, AC-028.
- **Verification:** Package metadata inspection, frozen install, dependency
  direction check, and strict package typecheck.

### T2 - Write the F6 contract tests first

- **Files:** `packages/runtime/test/preset.test.ts`,
  `packages/runtime/test/authorization.test.ts`,
  `packages/runtime/test/server.test.ts`,
  `packages/runtime/test/network.test.ts`,
  `packages/runtime/test/file.test.ts`, and a narrowly scoped dependency or
  scope fixture only if root validation requires one.
- **Behavior/Invariants:** Establish executable contracts before runtime source
  exists. Use real canonical serialization, real loopback HTTP, deterministic
  injected resolver/clock/transport seams, temporary filesystem fixtures, and
  adversarial own-data cases. Cover valid and invalid presets, digest changes,
  capability one-use/session expiry/replay, exact grant tuples, malformed
  protocol, all resource limits, address classification and pinning, redirects,
  credentials, methods, timeouts, response sizes, descriptor/no-follow file
  behavior, platform denial, privacy, and absent generic routes.
- **Acceptance coverage:** AC-001 through AC-028 and all REQ-005 through
  REQ-063 groups.
- **Verification:** Run the focused suite before production source. The
  expected red result is missing `../src/index.js` or equivalent collection
  failure when run from `packages/runtime`; record the exact command and result,
  then do not weaken assertions.

### T3 - Implement shared runtime types, limits, and stable errors

- **Files:** `packages/runtime/src/types.ts`,
  `packages/runtime/src/limits.ts`, `packages/runtime/src/errors.ts`.
- **Behavior/Invariants:** Define the approved `RuntimeGrant`, `RuntimePresetV1`,
  `NormalizedRuntimePreset`, `RuntimeBootstrap`, `RuntimeServer`, result/error
  types, operation kinds, and immutable F6-v1 limits. Keep diagnostics closed,
  deterministic, and free of input or dependency wording.
- **Acceptance coverage:** REQ-006, REQ-008, REQ-035 through REQ-037,
  REQ-059 through REQ-063, AC-001, AC-014, AC-026, AC-027, AC-028.
- **Verification:** Focused type and contract tests; assert frozen exported
  limits and stable error serialization.

### T4 - Implement hostile-input snapshots, target normalization, preset
normalization, canonical bytes, and digest

- **Files:** `packages/runtime/src/snapshot.ts`,
  `packages/runtime/src/url.ts`, `packages/runtime/src/path.ts`,
  `packages/runtime/src/preset.ts`, `packages/runtime/src/canonical.ts`.
- **Behavior/Invariants:** Copy only own enumerable data descriptors without
  invoking getters or custom iterators; reject cycles, sparse arrays, symbols,
  unknown fields, unsupported values, and over-limit data. Validate the closed
  preset, bind grants to exactly one F3 matcher, enforce matcher method and
  origin relationships, normalize outbound URLs and logical file paths, sort
  grants deterministically, freeze detached output, and compute the approved
  whitespace-free UTF-8 JSON SHA-256 digest.
- **Acceptance coverage:** REQ-005 through REQ-013, REQ-038 through REQ-039,
  REQ-053 through REQ-054, AC-001 through AC-005, AC-016, AC-022.
- **Verification:** Preset, URL, path, immutability, canonical-byte, and digest
  tests including reordered objects, Unicode/control input, invalid ports,
  fragments, userinfo, backslashes, traversal, and encoded ambiguity.

### T5 - Implement capability lifecycle and exact authorization core

- **Files:** `packages/runtime/src/capability.ts`,
  `packages/runtime/src/authorization.ts`.
- **Behavior/Invariants:** Generate fixed-format 32-byte bootstrap and session
  capabilities, bind them to one server/preset digest, consume bootstrap once,
  enforce monotonic expiry and bounded session concurrency, use fixed-length
  timing-safe comparison, and return an opaque authorized operation only after
  the complete AND decision. No priority, wildcard, fallback, matcher
  execution, or primitive access may bypass a tuple mismatch.
- **Acceptance coverage:** REQ-014 through REQ-026, REQ-040, AC-006 through
  AC-008, AC-016, AC-027.
- **Verification:** Deterministic clock tests for expiry and cleanup, concurrent
  pairing/replay tests, all tuple mutation tests, and side-effect spies proving
  denied requests do not reach DNS, filesystem, sockets, or body handling.

### T6 - Implement the loopback HTTP/1.1 control adapter

- **Files:** `packages/runtime/src/server.ts`,
  `packages/runtime/src/protocol.ts`.
- **Behavior/Invariants:** Force host `127.0.0.1`, port `0`, no port reuse, one
  request per connection, and only `POST /v1/pair` and `POST /v1/authorize`.
  Enforce origin-form HTTP/1.1, fixed header and control-body limits, exact
  canonical JSON, duplicate-header/key rejection, no transfer encoding,
  disconnect cancellation, admission limits, no CORS, and stable redacted
  status/error envelopes. Do not add an execute, proxy, or file route.
- **Acceptance coverage:** REQ-027 through REQ-037, REQ-059 through REQ-063,
  AC-009 through AC-014, AC-026 through AC-028.
- **Verification:** Real loopback requests for pairing, authorization, wrong
  routes/methods, HTTP forms, parser limits, duplicate values, disconnects,
  overload, expiry, shutdown, and response-header privacy.

### T7 - Implement public-address classification and pinned outbound connector

- **Files:** `packages/runtime/src/address-policy.ts`,
  `packages/runtime/src/outbound.ts`.
- **Behavior/Invariants:** Parse only the normalized authorized target; allow
  only HTTP(S) ports 80/443 and GET/HEAD. Resolve all A/AAAA answers, classify
  every IPv4, IPv6, and IPv4-mapped value against the reviewed special-use
  table, reject mixed or unsafe sets, select one deterministic public address,
  connect directly without proxy/racing/retry/re-resolution/pooling, preserve
  Host/SNI, strip credentials, reject unsupported encoding, enforce response
  header/body/timeout limits, and reject every redirect.
- **Acceptance coverage:** REQ-038 through REQ-052, AC-015 through AC-020.
- **Verification:** Pure address-table tests plus injected resolver/connector
  integration tests proving address pinning, no second lookup, no happy-eyeballs
  fallback, no proxy environment use, credential stripping, redirect rejection,
  byte counting, timeout cancellation, and mixed-answer denial.

### T8 - Implement race-resistant confined file reading

- **Files:** `packages/runtime/src/confined-file.ts`,
  `packages/runtime/src/platform-file.ts`.
- **Behavior/Invariants:** Accept only an authorized logical relative path under
  a trusted startup root. Anchor the root, use no-follow and descriptor-relative
  operations for every component where proven, verify regular-file and identity
  policy, read from the same descriptor, count bytes, close on every path, and
  return `runtime.platform-unsupported` instead of a realpath-only fallback.
- **Acceptance coverage:** REQ-053 through REQ-058, REQ-059 through REQ-061,
  AC-021 through AC-026.
- **Verification:** Temporary-root tests for normal reads, traversal, encoded
  traversal, separators, device/UNC/drive forms, symlink components, final
  symlinks, non-regular files, hard-link/identity policy, replacement races,
  growth, size limits, cleanup, and platform capability reporting. Platform
  skips must assert denial rather than silently skip the contract.

### T9 - Export the package and integrate emitted build/validation checks

- **Files:** `packages/runtime/src/index.ts`, `scripts/build.ts`,
  `scripts/validate.ts`, root `package.json` only if a script change is
  necessary, and `test/fixtures/forbidden-direction.ts` only if a new
  dependency-direction assertion is required.
- **Behavior/Invariants:** Export only the approved runtime API; emit a Node
  ESM runtime artifact with existing esbuild conventions and externalized
  workspace dependencies; directly import and exercise the artifact; verify
  package dependency direction, absence of browser/F13/F14 imports, and
  expected artifact completeness without weakening F1-F3 checks.
- **Acceptance coverage:** REQ-001 through REQ-004, REQ-062 through REQ-063,
  AC-027, AC-028.
- **Verification:** `pnpm install --frozen-lockfile`, `pnpm format:check`,
  `pnpm lint`, `pnpm typecheck`, `pnpm build`, focused runtime tests, emitted
  module checks, and `pnpm validate`.

### T10 - Independent review, documentation synchronization, and scope audit

- **Files:** `README.md`, `docs/architecture.md`, `AGENTS.md` only if agent
  orientation materially changes, `docs/specs/f6-runtime-foundation.md`,
  `docs/plans/f6-runtime-foundation.md`, and `docs/f6-workflow.md`.
- **Behavior/Invariants:** Review the final diff against every approved REQ/AC,
  record up to three fresh-context review rounds, fix only in-scope findings,
  rerun canonical validation after each fix, and keep no brainstorm artifacts.
  Mark F6 complete only after verification and review pass. Keep F13/F14 and
  release actions explicitly pending.
- **Acceptance coverage:** Full specification, especially AC-026 through
  AC-028 and all security/privacy requirements.
- **Verification:** GLM 5.3 fresh-context review when available, final
  `pnpm validate`, `git diff --check`, generated-artifact/secret scan, and
  tracked/untracked scope audit.

## Generated And Local-Only Files

Do not commit `node_modules/`, package `dist/`, build manifests, coverage,
Playwright output, browser binaries, caches, environment files, secrets, or
traffic/body captures. The lockfile and F6 source/tests/docs are source
controlled; emitted runtime output is generated and ignored.

## Rollback

Rollback removes the private runtime package and its build/validation references
and restores documentation to the pre-F6 state. No migration or feature flag is
needed because F6 persists no runtime state and does not change `.rogatio.json`.
