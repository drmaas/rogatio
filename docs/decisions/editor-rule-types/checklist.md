# editor-rule-types — checklist

Implementer checks boxes as work lands. Each phase must leave `pnpm validate` green.

## Phase 1: Editor plumbing + Header + Redirect builtins

Acceptance: built-in dropdown includes Header and Redirect. Add-rule for those types writes a payload and mounts fields. Sample header rules show name/value (value hidden on remove). Request-body / response-body add also persists nested payload. Mock still present.

Proof: new `packages/editor/test/header.test.ts`; extend `packages/editor/test/redirect.test.ts` and `packages/editor/test/editor.test.ts` (builtin ids, add-rule payload, type-switch clears stale fields); existing `packages/editor/test/request-body.test.ts` add-on-new-rule if not already covered.

- [x] Phase 1: Editor plumbing + Header + Redirect builtins
  - [x] 1.1 Add optional `defaultFields` on `RuleTypeFieldExtension` (`packages/editor/src/types.ts`). Relax `setRuleType` gate to require `defaultAction` **or** `defaultFields`. When `defaultFields` is set, write `type` plus each own key; otherwise keep `defaultAction` / `actionField` for nested payloads.
  - [x] 1.2 Allowlist `requestBody`, `responseBody`, `headerDirection`, `headerOperation`, `headerName`, `headerValue` in `setValueAtPath`. Extend `ACTION_FIELDS` / `clearActionFields` with those keys plus existing `redirect` / `action` / `mock`.
  - [x] 1.3 Put `createHeaderRuleType()` and `createRedirectRuleType()` in `builtInRuleTypes`. `defaultAction` / `actionField: "redirect"` live on the factory so a host that still passes it does not wipe payload init. Mock stays.
  - [x] 1.4 Header: `defaultFields` request/set/empty name/value; Operation select set/remove only; on remove hide value input and delete `headerValue`; append shown only while current value is `append`.
  - [x] 1.5 Note builtin Header/Redirect in `docs/architecture.md` editor section.
  - [x] 1.6 Tests in `packages/editor/test/` as listed under Proof. `pnpm validate`.

## Phase 2: Query set/remove wire

Acceptance: `{ name, value }` still validates as set. `{ name, operation: "remove" }` validates without `value` and is rejected with `value`. Compiler emits `addOrReplaceParams` and/or `removeParams`. Extension DNR rule includes `removeParams` when needed. Browser-schema matches.

Proof: `packages/schema/test/` query cases; `packages/compiler/test/query.test.ts`; `packages/extension/test/projection.test.ts` / `dnr.test.ts`; browser-schema coverage in existing extension schema tests.

- [ ] Phase 2: Query set/remove wire
  - [ ] 2.1 `RogatioQueryParam`: optional `operation` `"set" | "remove"`, optional `value`. Omit `operation` ⇒ set.
  - [ ] 2.2 JSON Schema `queryParam` if/then (value required on set/absent; forbidden on remove). Semantic unique names unchanged; value/remove rules in `validation.ts` if schema if/then is not enough for the remove side.
  - [ ] 2.3 Replace `queryParamsToDNR` with `queryActionToDNR` returning `{ addOrReplaceParams?, removeParams? }`. Update `applyQueryTransform` for deletes (remove-only, set-only, mixed set+remove; preserve unrelated query keys). Update compiler exports and all callers.
  - [ ] 2.4 Extension `projection.ts` / `dnr.ts` write both DNR fields; omit empty arrays.
  - [ ] 2.5 `packages/extension/src/browser-schema.ts`: `operation` on params; same value/remove rules.
  - [ ] 2.6 `rogatio-overview.md` and `docs/architecture.md` query text: set and remove, `removeParams` only for remove (F10 add-or-replace for set unchanged).
  - [ ] 2.7 Schema + compiler + extension tests (include mixed set+remove and `{ name, value }` backward compat). `test/integration/packaged-cli.test.ts` still verifies `samples/basic/.rogatio.json`. `pnpm validate`.

## Phase 3: Editor query set/remove UI

Acceptance: query rows have set/remove. Remove hides/clears value. Sample `rule-query` still edits as set. `matches` uses `rule.type === "query"`.

Proof: `packages/editor/test/editor.test.ts` query cases and/or `packages/editor/test/query.test.ts` if split out.

- [ ] Phase 3: Editor query set/remove UI
  - [ ] 3.1 Per-param Operation select; defaultAction includes `operation: "set"`.
  - [ ] 3.2 Remove: hide value input, omit `value` from the param object.
  - [ ] 3.3 `matches(rule)` ⇒ `rule.type === "query"` (stop matching leftover `action`).
  - [ ] 3.4 Validate: value required for set, forbidden for remove; keep unique-name / bounds checks.
  - [ ] 3.5 Tests. `pnpm validate`.

## Phase 4: Response-body replace wire

Acceptance: `{ mode: "replace", body }` validates and compiles. Untagged `{ replacements }` still validates as regex. Runtime replace returns the configured body after the existing fetch path. Browser-schema accepts both.

Proof: `packages/schema/test/` response-body cases; compiler response-body tests; `packages/runtime/test/response-body.test.ts`; extension browser-schema tests.

- [ ] Phase 4: Response-body replace wire
  - [ ] 4.1 Types (`replace` | `regex`) + `LIMITS.maxResponseBodyBytes` (4 194 304). JSON Schema `oneOf` replace / tagged regex / untagged `{ replacements }` (untagged = regex).
  - [ ] 4.2 Semantic validation: replace needs `body`; regex/untagged still need ≥1 compilable replacement.
  - [ ] 4.3 Compiler copies union onto `ResponseBodyOperation` (missing `mode` + `replacements` ⇒ regex; no new operation kind).
  - [ ] 4.4 Runtime: branch `fetchAndRewriteAuthorizedResponse` (or equivalent) for `mode === "replace"` — encode configured UTF-8 body after fetch, preserve status/headers, bound authored body by `maxResponseBodyBytes`; regex/untagged still use `rewriteResponseBody`.
  - [ ] 4.5 Browser-schema union + bounds.
  - [ ] 4.6 Overview/architecture: response-body is replace or regex rewrite, still native-runtime, not a mock.
  - [ ] 4.7 Tests (replace + untagged regex compat; replace body over limit rejected). Packaged CLI verify on `samples/basic/.rogatio.json`. `pnpm validate`.

## Phase 5: Editor response-body replace UI

Acceptance: Response body form offers replace vs regex. New rules default to `{ mode: "replace", body: "" }` and mount on add. Opening untagged sample rule shows regex rows.

Proof: `packages/editor/test/response-body.test.ts` (and editor add-rule if needed).

- [ ] Phase 5: Editor response-body replace UI
  - [ ] 5.1 Mode select like request-body; label “Response body”; `defaultAction` replace.
  - [ ] 5.2 Replace: body textarea. Regex: existing replacement rows. Untagged payload treated as regex.
  - [ ] 5.3 Validate both modes (bounds, regex compile).
  - [ ] 5.4 Docs-site rule-type pages if they still describe response-body as rewrite-only.
  - [ ] 5.5 Tests including add on a rule with no prior `responseBody`. `pnpm validate`.

## Phase 6: Remove mock

Acceptance: `type: "mock"` fails schema. Dropdown has no Mock response. Hosts do not register mock. Compile/intake no longer emit or consume `MockOperation`. Product docs no longer list mocks as a current rule type.

Proof: schema enum tests (mock rejected); editor builtin id list; deleted or failing-on-purpose old `packages/editor/test/mock.test.ts` / `packages/schema/test/mock.test.ts` / `packages/compiler/test/mock.test.ts`; CLI/runtime tests that built mock configs updated or removed; docs-site platforms table.

- [ ] Phase 6: Remove mock
  - [ ] 6.1 Schema: drop `"mock"` from `RuleType`, `mock` on `RogatioRule`, `$defs.mock*`, semantic allowed-values, schema tests.
  - [ ] 6.2 Compiler: drop `MockOperation`, compile branch, `selector.ts` mock kind, compiler mock tests.
  - [ ] 6.3 Editor: drop `createMockRuleType`, builtin entry, exports, mock tests.
  - [ ] 6.4 Hosts: CLI `edit.ts` and extension page stop passing mock/redirect/response-body overrides (`createMockRuleType`, redundant `createRedirectRuleType`, `createResponseBodyRuleType`); builtins alone supply the dropdown.
  - [ ] 6.5 CLI: delete or gut `createMockPreviewAction` / `buildMockConfigs` mock kind; dry-run `previewAction` wiring compiles without `MockOperation`.
  - [ ] 6.6 Runtime: stop `kind === "mock"` config intake in `lifecycle.ts`. Do not redesign `mock.connect` unless typecheck forces a delete.
  - [ ] 6.7 Browser-schema + `RuleProposal.kind` + runtime `ai-prompt.ts` / `ai-assist.ts` unions drop `"mock"`.
  - [ ] 6.8 Durable docs that describe current behavior: `rogatio-overview.md`, `README.md`, `docs/architecture.md` (note mock authoring removed; do not rewrite frozen F13 records), `packages/*/README.md` as needed, `packages/docs-site/` (platforms + rule-type index). Frozen `docs/specs/` / `docs/plans/` stay; no migrator.
  - [ ] 6.9 `pnpm validate`.
