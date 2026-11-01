# F11 — Request & Response Header Rules

## 1. Problem statement and goals

Rogatio currently defines rules only as matcher envelopes (URL/origin/resource-type/priority
selection) with no action. Per `rogatio-overview.md`, users need **request and response
header rules**: set, append, or remove a named header, subject to immutable forbidden-header
lists and browser limits. This is the first *action* slice and establishes the rule-type
discriminant, the neutral `HeaderOperation`, and the Chrome DNR `modifyHeaders` translation
that later slices (F9 redirect, F10 query) will follow.

Goals:
- Introduce a stable rule-type discriminant so future action slices compose cleanly.
- Validate header rules against forbidden-header lists and browser limits at the schema +
  compiler boundary.
- Translate header rules into installable Chrome DNR `modifyHeaders` rules.
- Render accessible header-rule fields in the shared editor via the existing extension point.
- Report correct rule status (`active` once installed) instead of the F7 `unsupported`
  placeholder for this action type.

## 2. Scope and non-goals

In scope:
- Schema: `type: "header"` rule variant, `headerDirection`, `headerOperation`, `headerName`,
  optional `headerValue`; forbidden-header and value-required validation.
- Compiler: emit `HeaderOperation`; header-specific diagnostics.
- Extension: DNR `modifyHeaders` projection + real install via `declarativeNetRequest`;
  conditional `unsupported` rewrite; mirror validation in `browser-schema.ts`.
- browser-core: accept the operation union; status/desired logic unchanged (operates on
  `operation.matcher`).
- Editor: a `RuleTypeFieldExtension` for header rules (fields + validation + `type` set).
- Tests across schema, compiler, extension projection, editor, and existing suites updated.

Non-goals (deferred):
- F9 redirect, F10 query, F12 dry-run preview of header rules, F13–F17 runtimes.
- Multiple header modifications per rule (one set/append/remove of one header per rule).
- Editing/import/export of header rules on non-Chrome platforms beyond existing support.
- The bounded `[Rogatio]` console record (deferred to a later feature).

## 3. Actors, entry points, environments

- Same as F7/F8: Chrome MV3 extension (manifest), `cli edit`, `.rogatio.json` file.
- Supported environments: Linux/Windows/macOS Chrome (matches `rogatio-overview.md`).
- Entry points: project import/creation; editor rule creation with the header extension;
  compiler `compileProject`; extension `createExtensionApplication` + DNR installer.

## 4. Functional requirements

- **REQ-001** A rule MUST declare `type: "header"`. The schema `rule` $def becomes a
  discriminated shape; `type` is required with the single const `"header"` for this slice.
- **REQ-002** A header rule carries `headerDirection: "request" | "response"`,
  `headerOperation: "set" | "append" | "remove"`, `headerName: string` (non-empty,
  length ≤ `LIMITS.maxHeaderNameLength`), and `headerValue: string` (length ≤
  `LIMITS.maxHeaderValueLength`).
- **REQ-003** `headerValue` is REQUIRED when `headerOperation` is `set` or `append`, and MUST
  be absent/ignored when `headerOperation` is `remove`.
- **REQ-004** `headerName` MUST NOT be a forbidden header for its direction (per
  `schema/src/headers.ts` `isForbiddenHeader`, case-insensitive, including `proxy-*`/`sec-*`
  request prefixes).
- **REQ-005** The compiler emits a `HeaderOperation { kind:"header"; groupId; ruleId;
  matcher: NormalizedMatcher; header: { direction; operation; name; value? } }`.
- **REQ-006** The compiler MUST NOT add an unvalidated `action`/passthrough; unknown rule
  shapes surface `schema.unknown-property`.
- **REQ-007** Header-specific diagnostics: `compiler.invalid-header-direction`,
  `compiler.invalid-header-operation`, `compiler.forbidden-header`,
  `compiler.header-value-required`, `compiler.header-value-unexpected`.
- **REQ-008** The extension projects `HeaderOperation` to a DNR rule with
  `action.type: "modifyHeaders"`, `requestHeaders` (request) or `responseHeaders` (response),
  `operation: set|append|remove`, `value` for set/append; `condition` from the matcher
  (regexFilter via `compileUrlRegex`, `resourceTypes`, `requestMethods` when `method` set,
  `initiatorDomains` from normalized origins); `priority` from matcher; stable `id`.
- **REQ-009** Header DNR rules are `installable: true`; the service worker MUST stop forcing
  `unsupported` for header operations and instead report the computed status (active when
  enabled + granted + installed).
- **REQ-010** The editor header `RuleTypeFieldExtension` renders direction/operation/name/
  value controls, validates locally, and ensures `type: "header"` is set on the rule.
- **REQ-011** `browser-core` `RuleInstallerAdapter`, `computeDesiredRules`,
  `computeRuleStatuses`, `computeDeclaredOrigins` accept `MatcherOperation | HeaderOperation`;
  status logic continues to operate on `operation.matcher`.
- **REQ-012** `extension/src/browser-schema.ts` MUST mirror the header rule validation
  (RULE_KEYS + `validateProjectDetailed`) so the extension accepts valid F11 projects.

## 5. Acceptance criteria

- **AC-001** A valid header rule (request, set, allowed name, value) compiles to a
  `HeaderOperation` with `kind:"header"` and the correct header payload; `compileProject`
  returns `ok:true`.
- **AC-002** A header rule with `operation:"remove"` and a present `headerValue` is rejected
  by semantic validation (`compiler.header-value-unexpected`) — value must not be supplied.
- **AC-003** A header rule with `operation:"set"` and missing `headerValue` is rejected
  (`compiler.header-value-required`).
- **AC-004** A header rule naming a forbidden request header (e.g. `cookie`, `sec-fetch-*
  `, `proxy-foo`) is rejected (`compiler.forbidden-header`); a forbidden response header
  (e.g. `set-cookie`) rejected for `direction:"response"`.
- **AC-005** A header rule with unknown `headerDirection`/`headerOperation` is rejected with
  the respective invalid diagnostic; an unknown property on the rule is rejected with
  `schema.unknown-property` (no passthrough).
- **AC-006** The extension projects a header operation to a DNR `modifyHeaders` rule with the
  correct `requestHeaders`/`responseHeaders` entry, `operation`, conditional `value`,
  `priority`, `regexFilter`, `resourceTypes`, `requestMethods` (when set), and `initiatorDomains`.
- **AC-007** The extension reports header rules as `installable: true`; the service worker no
  longer rewrites a header rule's `active` status to `unsupported`.
- **AC-008** `browser-core` `computeRuleStatuses`/`computeDesiredRules` accept header
  operations and compute `active`/`disabled`/`needs permission` based on `operation.matcher`
  origins and enablement.
- **AC-009** The editor header extension mounts direction/operation/name/value fields for a
  header rule, validates (forbidden name, value-required), and sets `type:"header"`; it is
  rejected when two extensions match the same rule (existing editor invariant preserved).
- **AC-010** `extension/src/browser-schema.ts` accepts a valid header rule and rejects a
  forbidden-header / missing-value header rule identically to the Node schema.
- **AC-011** All existing suites (compiler, schema, extension projection, browser-core
  install/status, editor) remain green after their fixtures are updated to header rules.
- **AC-012** No secrets, local settings, or generated artifacts are introduced; the change
  stays within `schema`, `compiler`, `extension`, `browser-core`, `editor`, and their tests.

## 6. API / file-format / compatibility changes

- `.rogatio.json` schema version remains `1`. Rules gain a required `type` field. Existing
  matcher-only rules (none in production) would need `type:"header"`; since no action rules
  exist yet, no migration is required. The `project-v1.json` `$id` is unchanged.
- New exported types: `HeaderRule`, `HeaderOperation`, `HeaderDirection`, `HeaderOperationKind`
  (the latter two already exist in `schema/src/headers.ts` as `HeaderDirection`).
- DNR install uses `chrome.declarativeNetRequest.updateDynamicRules`.

## 7. Security, privacy, performance, accessibility, operational

- Forbidden-header enforcement prevents tampering with security-sensitive headers
  (cookie, origin, content-length, host, sec-*, proxy-*). Validation runs at both the Node
  schema and the duplicated browser schema to avoid a validation gap.
- Header names/values are bounded by `LIMITS` to avoid abuse; single modification per rule
  keeps DNR `modifyHeaders` within Chrome's per-rule header limit.
- Editor fields are accessible (labels, keyboard, screen-reader) per F5 requirements.
- No network contact, no telemetry, no persisted traffic (consistent with overview).
- DNR rule ids are deterministic and stable across installs to avoid churn.

## 8. Migration, rollout, backward compatibility

- No envelope/version migration (stays v1). Only the in-file rule shape gains `type`.
- Rollout is additive: header rules are a new rule type alongside (future) redirect/query.
- The F7 actionless→`unsupported` behavior is preserved only for any non-header (matcher)
  operation, keeping a safe fallback for future actionless op kinds.

## 9. Open questions / assumptions

- Assumes Chrome's `modifyHeaders` silent-ignore of still-forbidden headers is acceptable
  because schema validation already blocks them.
- Assumes single header modification per rule for F11.
- Assumes the editor host sets `type:"header"` via the header extension (no editor-core
  change required beyond an optional `type` hint).
- These are confirmed/denied at the Stage 4 gate.
