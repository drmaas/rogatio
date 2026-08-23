# F10 — Implementation Plan

Vertical slice through `@rogatio/schema` → `@rogatio/compiler` → `@rogatio/extension` → `@rogatio/editor`. Establishes the `action` discriminator for all later browser-only rule types.

## Task 1 — Schema: `action` union + `queryAction` (Node)

Files: `packages/schema/src/types.ts`, `packages/schema/src/schema.ts`, `packages/schema/src/limits.ts`, `packages/schema/src/validation.ts`, `packages/schema/src/index.ts`.

- `types.ts`: add `RogatioQueryParam { name: string; value: string }`, `RogatioQueryAction { type: "query"; params: RogatioQueryParam[] }`, `RogatioRuleAction = RogatioQueryAction`, and add `action: RogatioRuleAction` to `RogatioRule`.
- `limits.ts`: add `maxQueryParamsPerRule`, `maxQueryNameLength`, `maxQueryValueLength`.
- `schema.ts`: add `queryParam` and `queryAction` `$defs`; add `action` property (additionalProperties stays false) to the `rule` `$defs` referencing `queryAction`; apply `maxItems`/`maxLength` via the limits. Remove the now-obsolete "action is rejected as unknown-property" expectation (it is a known field now).
- `validation.ts`: add semantic checks — non-empty `params`, `name`/`value` non-empty + length bounds, unique `param.name` per rule. Emit stable diagnostics with JSON-pointer paths.
- `index.ts`: export new types.

Covers: AC-001, AC-002, AC-003, AC-004, AC-010.

## Task 2 — Schema: `browser-schema.ts` mirror (MV3)

File: `packages/extension/src/browser-schema.ts`.

- Add identical `action`/`queryAction` validation, `RULE_KEYS` gains `action`, and mirror the length/unique checks using the shared `LIMITS`. Import `LIMITS` bounds (already shared) so values cannot drift.
- Add `RogatioQueryAction` type if needed (extension may reuse schema types; only browser-unsafe runtime entry is excluded).

Covers: AC-001, AC-012.

## Task 3 — Compiler: `RuleOperation` + query transform helper

Files: `packages/compiler/src/types.ts`, `packages/compiler/src/compile.ts`, `packages/compiler/src/query.ts`, `packages/compiler/src/index.ts`.

- Rename `MatcherOperation` → `RuleOperation` (`kind: "rule"`), keep all matcher fields, add `action: RogatioRuleAction`.
- `compile.ts`: carry `action` from source rule into each `RuleOperation`.
- `query.ts`: export pure `queryParamsToDNR(action: RogatioQueryAction): { name: string; value: string; replaceOnly: false }[]` and `applyQueryTransform(url: string, action): string` (builds the resulting URL using WHATWG URL, preserving scheme/authority/path/fragment and unrelated params).
- `index.ts`: re-export.

Covers: AC-004, AC-005, AC-006.

## Task 4 — Extension projection: DNR query rule

Files: `packages/extension/src/projection.ts`, `packages/extension/src/chrome.ts` (DNR type if needed).

- `projectMatchers(operations)`: for `operation.action.type === "query"`, build a DNR rule `action.redirect.transform.query.addOrReplaceParams` with `replaceOnly:false`; condition from matcher (regexFilter, resourceTypes, optional requestMethods from `method`, requestDomains/initiatorDomains from origin hostnames); return `installable: true`. Keep `kind` check (`isMatcherOperation`) working with the renamed `RuleOperation`.
- Other/unknown action types still `installable: false`.

Covers: AC-005, AC-011.

## Task 5 — Extension service-worker status

File: `packages/extension/src/service-worker.ts`.

- `operationStatuses`: when `operation.action?.type === "query"` and rule is compiled + enabled + granted, status `active` (not `unsupported`). Keep other deferral behavior for actionless/unknown.

Covers: AC-007.

## Task 6 — Editor: rule-type extension + selector

Files: `packages/editor/src/rule-types/query.ts`, `packages/editor/src/editor.ts` (or controller/view), `packages/editor/src/types.ts`.

- `packages/editor/src/rule-types/query.ts`: `RuleTypeFieldExtension` with `id:"query"`, `label:"Query parameters"`, `matches(rule) => rule.action?.type === "query"`, `mount` rendering param name/value rows with add/remove, `validate(rule, path)` enforcing REQ-002..REQ-005.
- Editor common rule form: add a `Rule type` selector listing registered extension labels; selecting `query` sets `action = { type:"query", params:[] }` and mounts the extension; switching away clears unknown action data when no owning extension (preserves F5 rejection of arbitrary passthrough).
- Register the `query` extension as the default built-in when `ruleTypes` is empty.

Covers: AC-008, AC-009.

## Task 7 — Tests first (written before implementation)

- `packages/schema/test/schema.test.ts`, `validation.test.ts`: query action valid; bad type rejected; empty/dup param rejected; bounds.
- `packages/compiler/test/query.test.ts`: `queryParamsToDNR`, `applyQueryTransform` add+replace+fragment preserved.
- `packages/compiler/test/compile.test.ts`: operation carries action (update existing fixtures; remove action-rejection assertion).
- `packages/extension/test/projection.test.ts`: query → installable DNR rule; update existing `installable:false` fixtures.
- `packages/extension/test/service-worker.test.ts`: query active.
- `packages/editor/test/*`: rule-type selector + query validation + round-trip.

Covers all AC.

## Ordering & dependencies

Task 1 → Task 2 (mirror) and Task 3 (compiler) in parallel; Task 4/5 depend on Task 3; Task 6 depends on Task 1 types. Tests (Task 7) written before each implementation task where the repo permits; run red, then implement, then green.

## Rollback / cleanup

- Renaming `MatcherOperation` ripples to `compiler.test`, `projection.test`, `service-worker.test`, `browser-core` `install.ts` `sameOperations`, `declaredPermissionOrigins`. Update all consumers and fixtures.
- No generated artifacts; no new dependencies.
