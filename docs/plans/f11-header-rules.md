# F11 — Implementation Plan (Request & Response Header Rules)

Derived from approved spec `docs/specs/f11-header-rules.md`. Each task maps to AC IDs.

## Phase A — Schema (core rule type + validation)

| Task | File | Behavior | AC |
|------|------|----------|----|
| A1 | `packages/schema/src/types.ts` | Add `HeaderDirection`, `HeaderOperationKind`, `HeaderRule` interface (matcher fields + header payload). Update `RogatioRule` to discriminated union `HeaderRule` (only variant for now). | 001, 002 |
| A2 | `packages/schema/src/schema.ts` | Extend `rule` $def: add `type` (const "header"), `headerDirection` enum, `headerOperation` enum, `headerName` string (minLength 1), `headerValue` string (optional, maxLength). Keep `additionalProperties:false`. | 001, 002, 006 |
| A3 | `packages/schema/src/validation.ts` | In `semanticIssues`: validate `headerValue` required for set/append, rejected for remove; call `isForbiddenHeader(headerName, headerDirection)` (case-insensitive); emit new semantic error objects with codes. | 002, 003, 004 |
| A4 | `packages/schema/src/limits.ts` | Add `maxHeaderNameLength` (256) and `maxHeaderValueLength` (4096) to `LIMITS` (or appropriate existing limits file). | 002 |
| A5 | `packages/schema/src/index.ts` | Export new types: `HeaderRule`, `HeaderDirection`, `HeaderOperationKind`. | 001 |
| A6 | `packages/schema/test/schema.test.ts` | Add header semantic tests: valid header rule compiles; forbidden request/response headers rejected; value required for set/append; value rejected for remove; unknown property rejected. | 001–005, 010 |

## Phase B — Compiler (HeaderOperation emission)

| Task | File | Behavior | AC |
|------|------|----------|----|
| B1 | `packages/compiler/src/types.ts` | Add `HeaderOperation` interface (kind "header", groupId, ruleId, matcher: NormalizedMatcher, header: {direction, operation, name, value?}). Widen `CompileResult.operations` to `readonly (MatcherOperation \| HeaderOperation)[]`. Add `CompilerDiagnosticCode` entries. | 005, 007 |
| B2 | `packages/compiler/src/diagnostics.ts` | Add `ISSUE_CODES` mapping for new codes; add `MESSAGES` entries; extend `SAFE_PARAM_KEYS` with `headerName`, `headerOperation`, `headerDirection`. | 007 |
| B3 | `packages/compiler/src/compile.ts` | In `compileOperations`: detect `rule.type === "header"` → build `HeaderOperation` (reuse `compileMatcher` for matcher fields). Keep matcher-only path for non-header (future actionless). | 005 |
| B4 | `packages/compiler/src/index.ts` | Export `HeaderOperation`, new diagnostic codes. | 005, 007 |
| B5 | `packages/compiler/test/compiler.test.ts` | Update existing assertions (op-shape at ~513) to expect `HeaderOperation` kind; add header cases (valid, forbidden, value rules); keep adversarial sparse/cyclic tests passing. | 001, 002, 003, 004, 005, 011 |

## Phase C — Extension (DNR modifyHeaders + install)

| Task | File | Behavior | AC |
|------|------|----------|----|
| C1 | `packages/extension/src/browser-schema.ts` | Extend `RULE_KEYS` with header fields; update `validateProjectDetailed` to mirror Node schema validation (forbidden-header, value rules, unknown property). | 010 |
| C2 | `packages/extension/src/types.ts` (new) | Define `HeaderProjection` + `ProjectedOperation = HeaderProjection | MatcherProjection` union; add `isHeaderOperation` guard. | 006, 007 |
| C3 | `packages/extension/src/projection.ts` | Replace `projectMatchers` with `projectOperations(operations: (MatcherOperation\|HeaderOperation)[])`: for header → build DNR `modifyHeaders` rule (requestHeaders/responseHeaders, operation, value?, condition from matcher via `compileUrlRegex`, `resourceTypes`, `requestMethods`, `initiatorDomains`, priority, stable id); for matcher → `MatcherProjection` (installable:false). | 006 |
| C4 | `packages/extension/src/diagnostics.ts` | Add `ExtensionDiagnosticCode` for `extension.invalid-header`, `extension.forbidden-header`. | 006, 007 |
| C5 | `packages/extension/src/installer.ts` (new) | Implement `RuleInstallerAdapter` using `chrome.declarativeNetRequest.updateDynamicRules`: `current()` reads dynamic rules; `install(desired)` removes old rule ids, adds projected header rules. Return `InstallResult`. | 007, 008 |
| C6 | `packages/extension/src/service-worker.ts` | Import new installer; wire into `createExtensionApplication`; update `operationStatuses` to **not** rewrite `active→unsupported` for header ops (only for non-installable matcher ops). | 007, 008 |
| C7 | `packages/extension/test/projection.test.ts` | Add header projection tests: correct DNR structure, installable:true, priority/condition mapping. Update fixture for header ops. | 006, 007, 011 |
| C8 | `packages/extension/test/fixtures.ts` | Add header operation fixture; keep matcher fixture for backward path. | 006, 011 |

## Phase D — browser-core (union acceptance)

| Task | File | Behavior | AC |
|------|------|----------|----|
| D1 | `packages/browser-core/src/types.ts` | Widen `RuleInstallerAdapter.current/install`, `RuleStatusInput.operations`, `InstallOutcome.installed` to `readonly (MatcherOperation \| HeaderOperation)[]`. | 008 |
| D2 | `packages/browser-core/src/install.ts` | No logic change (uses JSON.stringify on operations); type widening only. | 008 |
| D3 | `packages/browser-core/src/status.ts` | No logic change (accesses `operation.matcher`); type widening only. | 008 |
| D4 | `packages/browser-core/test/install.test.ts` | Add header operation to fixtures; verify install/rollback works. | 008, 011 |
| D5 | `packages/browser-core/test/status.test.ts` | Add header operation to fixtures; verify statuses (active/disabled/needs permission). | 008, 011 |

## Phase E — Editor (header extension)

| Task | File | Behavior | AC |
|------|------|----------|----|
| E1 | `packages/editor/src/header-extension.ts` (new) | Implement `RuleTypeFieldExtension` id `"header-rule"`, label "Header rule": `matches(rule) → rule.type === "header"`; `mount` renders direction/operation/name/value controls, calls `setField("type","header")` if absent; `validate` returns forbidden-name / value-required diagnostics. | 009 |
| E2 | `packages/cli/src/edit.ts` (or extension host) | Import header extension; pass in `EditorOptions.ruleTypes`. (If cli host is separate, update both cli and extension entry points.) | 009 |
| E3 | `packages/editor/test/editor.test.ts` | Test header extension: mounts fields, validates, sets type. | 009, 011 |
| E4 | `test/browser/editor.spec.ts` | Add e2e: create header rule, fill fields, save, verify draft has type+header payload. | 009, 011 |

## Phase F — Cross-cutting verification

| Task | Command | Target | AC |
|------|---------|--------|----|
| F1 | `pnpm build` | All packages build without type errors | 011 |
| F2 | `pnpm test` | All unit/integration tests pass | 011 |
| F3 | `pnpm lint` / `pnpm format --check` | Biome clean | 011 |
| F4 | `pnpm typecheck` | Strict TS passes | 011 |

## Rollback notes
- Each package's changes are independent; revert by package if needed.
- Schema change is the foundation — revert A1–A6 first if blocked.
- Extension installer is new file; safe to remove.
- No database migration (schema v1 unchanged).

## Documentation updates (Stage 10)
- `docs/architecture.md` (already updated in Stage 2)
- `README.md` if user-visible changes (CLI/extension usage) — evaluate after impl
- `AGENTS.md` orientation line if agent needs change — evaluate after impl