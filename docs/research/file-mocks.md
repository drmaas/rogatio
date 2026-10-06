> Status: frozen 2026-10-05

# File mocks — research

Audience: hybrid. Source was checked at the cited worktree locations.

## Scope and current state

The PRD requires a dedicated `mock` rule. It is not response-body replace:
response-body handling fetches the authorized upstream before writing its
status, headers, and rewritten body
(`packages/runtime/src/intercept-proxy.ts:637-677`). Mocks must return without
that fetch and exist only during the unified native-host session.

Do not revive the fully superseded F13 design: no standalone server, fixed
port, `/v1/connection`, or Check-and-connect flow
(`docs/architecture.md:786-789`).

Some dormant runtime primitives remain, but they are not an end-to-end mock
implementation:

- `RuntimeMockConfig` already carries `ruleId`, status, headers, delay, and
  optional body/file fields
  (`packages/runtime/src/types.ts:18-28`). Preset normalization validates those
  fields, enforces exactly one body source, and ties each mock to a matcher
  (`packages/runtime/src/preset.ts:69-149`,
  `packages/runtime/src/preset.ts:440-459`); canonical preset bytes include
  sorted mock config (`packages/runtime/src/canonical.ts:68-117`).
- Runtime startup mints per-rule tokens and `mock.connect` exposes them
  (`packages/runtime/src/lifecycle.ts:299-302`,
  `packages/runtime/src/lifecycle.ts:669-690`). The optional loopback faucet
  serves only `GET /mock/<token>` (`packages/runtime/src/host.ts:79-116`).
- Neither preset construction path supplies mocks: deferred
  `runtime.project.set` builds matchers plus empty grants
  (`packages/runtime/src/lifecycle.ts:418-443`), and explicit CLI mode does the
  same (`packages/cli/src/commands/runtime.ts:380-390`).
- Chrome launches the wrapper with bare `runtime host`
  (`packages/cli/src/commands/runtime.ts:50-67`). Although host parsing accepts
  `--root` and `--mock-port`
  (`packages/cli/src/commands/runtime.ts:286-335`), both are absent in the
  extension flow.

## PRD coverage and plan seams

### R1–R2: representation and validation

Schema currently closes the rule type to five values and has no mock payload
(`packages/schema/src/types.ts:46-51`,
`packages/schema/src/types.ts:133-163`,
`packages/schema/src/schema.ts:70-124`). Semantic validation and the
browser-safe mirror repeat that closed list
(`packages/schema/src/validation.ts:254-276`,
`packages/extension/src/browser-schema.ts:741-749`). Existing negative tests
assert that `type: "mock"` and a `mock` property fail
(`packages/schema/test/mock.test.ts:33-70`); replace them with positive,
boundary, exact-one-of, unknown-property, and adversarial-input coverage.

Plan needs one public schema shape, expected to mirror the dormant runtime
shape: `MockAction { status; headers?; delayMs?; body?; file? }` and
`RogatioRule.mock?`. Existing mock limits are already centralized
(`packages/schema/src/limits.ts:19-26`). Validation must define stable paths
for status, each header name/value, delay, body, and file. “Unsafe” must include
header control characters and response-framing headers; current dormant preset
validation rejects controls in header names but not values
(`packages/runtime/src/preset.ts:55-66`).

### R3: shared editor

Register a built-in extension beside the five current types
(`packages/editor/src/rule-types/index.ts:14-20`). The extension contract is
`id`, label, matcher, mount, validation, and optional payload initialization
(`packages/editor/src/types.ts:172-193`). A nested `mock` payload fits
`defaultAction` plus `actionField: "mock"`; type switching already initializes
and clears action fields (`packages/editor/src/editor.ts:1573-1614`).
Add/copy/remove are generic rule commands
(`packages/editor/src/editor.ts:1289-1327`), so mock-specific work is form,
field registration, validation, and tests. File authoring is a logical relative
path, not a browser file upload.

### R4: compile and offline preview

Add `MockOperation { kind: "mock"; ...; matcher; mock }` to
`RogatioOperation`; the union currently has six kinds
(`packages/compiler/src/types.ts:29-75`). Add explicit compilation before the
fallback matcher branch (`packages/compiler/src/compile.ts:161-251`).

`previewRuleAction` is the shared pure preview seam
(`packages/dry-run/src/preview.ts:22-77`), returning only
`{ kind, summary }` (`packages/dry-run/src/types.ts:12-15`). CLI edit, CLI
test, and extension dry-run already use it
(`packages/cli/src/commands/test.ts:109-113`,
`packages/cli/src/server/routes.ts:526-533`,
`packages/extension/src/dry-run-command.ts:75-89`). Preview declared status,
delay, headers, and inline/file source metadata only; never read the file or
contact runtime/upstream.

### R5–R7: browser-to-runtime serving

The extension start path already sends the project through
`runtime.project.set`, then starts the session
(`packages/extension/src/native-session.ts:306-340`,
`packages/extension/src/native-session.ts:354-385`). Its generic `send`
method can carry existing `mock.connect` envelopes
(`packages/extension/src/native-session.ts:130-146`,
`packages/runtime/src/envelope.ts:15-37`). The native policy filter must also
retain mock operations; it currently retains body and browser DNR kinds only
(`packages/extension/src/native-session.ts:188-204`).

Use session DNR rules installed only after successful runtime start and removed
on stop/disconnect. Response-body provides the lifecycle pattern and reserves
IDs from `4_000_001` (`packages/extension/src/response-body-redirect.ts:6-15`,
`packages/extension/src/native-session.ts:390-415`,
`packages/extension/src/response-body-redirect.ts:121-147`). Mock rules need a
separate ID band.

Loop protection is not inherited automatically. A user regex such as `.*`
also matches a loopback mock URL. Plan must specify an explicit DNR exclusion
or higher-priority session `allow` rule and test broad regexes. This guard is
session-scoped and must disappear with mock redirects.

Dormant serving code has gaps the plan must fix:

- Faucet calls `serveMock`, which renders bytes but does not apply `delayMs`
  (`packages/runtime/src/lifecycle.ts:353-362`,
  `packages/runtime/src/mock.ts:23-63`). Delay exists only in the native
  `mock.request` response path
  (`packages/runtime/src/lifecycle.ts:881-918`).
- Faucet accepts only GET and maps all lookup/render failures to an empty 404
  (`packages/runtime/src/host.ts:83-109`). Method/HEAD behavior, abortable
  delay, stable HTTP failure bodies, and client disconnect handling need tests.
- Native envelopes cap serialized data at 64 KiB
  (`packages/runtime/src/types.ts:241-243`), while file reads allow 4 MiB
  (`packages/runtime/src/limits.ts:10-12`). Binary response bytes therefore
  need a loopback byte path; do not route file bodies through `mock.response`.
- Token lookup alone currently authorizes faucet access
  (`packages/runtime/src/host.ts:87-99`,
  `packages/runtime/src/lifecycle.ts:353-362`). Keep capability authorization
  or add digest/rule revalidation explicitly; never expose a general file
  route.

### R6: confined live binary files

`readMockFile` re-reads on each render and checks root containment and size, but
performs a fatal UTF-8 decode and uses path-based `stat` then `readFile`
(`packages/runtime/src/mock-file.ts:19-45`). It does not satisfy binary or
race-safe confinement.

Use the existing descriptor-based confined reader behavior: platform support
check, no-follow open, bounded chunk reads, hard-link rejection, post-read
`fstat`, abort handling, and raw `Uint8Array`
(`packages/runtime/src/confined-file.ts:18-75`,
`packages/runtime/src/platform-file.ts:9-61`). Adapt its input/API for mock
files without weakening existing grant authorization. Preserve distinct stable
errors (`runtime.file-denied`, `runtime.file-race-rejected`,
`runtime.platform-unsupported`, `runtime.timeout`, `runtime.size-limit`);
`renderMockResponse` currently collapses every file failure to
`runtime.file-denied` (`packages/runtime/src/mock.ts:33-42`).

Configured headers need deterministic handling for `Content-Type`,
`Content-Length`, and `Cache-Control`; dormant rendering always appends length
and no-store and defaults content type
(`packages/runtime/src/mock.ts:43-54`). Binary files must not receive a
text/UTF-8 default.

### R8: statuses and visible runtime errors

Core statuses derive only disabled/error/active from installed IDs
(`packages/browser-core/src/status.ts:13-48`), though the public status union
also includes `needs runtime` and `unsupported`
(`packages/browser-core/src/types.ts:64-69`). Extension body-rule overrides
show the required session-state pattern
(`packages/extension/src/service-worker.ts:254-290`); add a mock branch:
disabled, unsupported platform/capability, needs runtime before start, active
only after redirect installation, and error for projection/install failures.

R6 also requires a visible rule error after a request-time file failure. No
current mock path reports such a failure to extension state: faucet emits only
HTTP status (`packages/runtime/src/host.ts:93-109`), while rule statuses are
computed from install and native phase
(`packages/extension/src/service-worker.ts:191-299`). Plan must add a bounded,
redacted rule-error signal and define when it clears. Never include logical or
absolute paths in diagnostics.

## Invariants and test focus

- Keep schema → compiler → editor/dry-run/browser-core → extension/CLI and
  runtime → schema/compiler dependency direction.
- Keep browser validation mirrored in `browser-schema.ts`; no Ajv, Node import,
  file read, or dry-run runtime dependency in browser bundles.
- Keep canonical digest over mock config, excluding minted tokens
  (`packages/runtime/src/canonical.ts:109-117`).
- Logical paths remain relative and reject backslashes, percent escapes,
  controls, dot segments, colons, and globs
  (`packages/runtime/src/path.ts:3-26`).
- Test inherited/accessor/proxy/cyclic/sparse input at schema/compiler
  boundaries; symlink, hard-link, replacement races, missing files, oversize,
  binary bytes, duplicate/reserved headers, broad-regex recursion, stop and
  disconnect cleanup, and zero/up-to-limit delays.

## Decisions

These three items were open questions during research. They are now locked and
must not be reopened during planning or implementation.

1. **Confined root contract.** One root per project, chosen by the user and
   saved with the project. If the project was opened from a file and no root is
   set, default to that file's directory. Never use the process working
   directory. Never read outside that root.
2. **Mock method contract.** Follow the rule's method filter. No filter means
   all methods, the same as every other rule type. `HEAD` returns the same
   status and headers with an empty body.
3. **File-read error clearing.** A later successful read clears the error.
   Saving the project or restarting the host clears it immediately. The next
   request checks the file again. Diagnostics never include the path.

## Open questions

none
