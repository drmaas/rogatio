# editor-rule-types — refactor candidates

Proposal only. No behavior change. Conservative: surface duplicates this feature introduced (header/query selects, body replace checks, persist/clear field lists) without new shared form frameworks or package-boundary merges the plan forbade.

Self-review discarded a shared set/remove-with-hidden-value widget, a shared request/response-body mode form, schema/editor/browser-schema validation unification, mock `LIMITS` deletion, and several one-liners. Those are low benefit, fight documented splits, or risk wire/UI behavior.

---

## 1. Shared rule-type `createSelect` (and optional text input)

### Candidate

`packages/editor/src/rule-types/header.ts` and `packages/editor/src/rule-types/query.ts` each define an identical `createSelect(document, options, value, onChange)`. Request-body and response-body mount the same replace/regex `<select>` by hand, with different option labels (`"Regex replace"` vs `"Regex rewrite"`) and different change handlers.

Extract a file-local helper module used only by rule-type mounts, e.g. `packages/editor/src/rule-types/dom.ts`:

- `createSelect` with options as `string` (header/query) or `{ value, label }` (body mode).
- Optionally `createTextInput` for header name/value (query still builds inputs inline because it sets `dataset.editorField` and remounts rows).

Do **not** extract a shared “operation + hide value” widget or a shared body-mode form. Header hides via `label.hidden` + `deleteField` without remount; query rebuilds param rows and replaces the param object. Response-body regex is a replacement list plus untagged `{ replacements }` preservation; request-body regex is a single pattern/replacement pair. Those handlers must stay in each file.

### Expected benefit

Next `<select>` on a rule form is one import. Header/query stop drifting if option wiring changes (a11y, `dataset.editorField`). Body mode dropdown construction is the only cheap overlap between the two body forms.

### Risk

Low. Same DOM (`<select>` / `<option>` / `change`). Mistake would be option text/value swap on body modes (labels are not the enum values) or dropping `selected` on the current value. Header append-only extra option stays in `operationOptions`, not in the helper.

### Scope

New `packages/editor/src/rule-types/dom.ts` (name flexible). Call sites: `header.ts`, `query.ts`; optionally `request-body.ts` / `response-body.ts` mode `<select>` only. No public editor exports. No schema/compiler/runtime.

### Test plan

Existing happy-dom suites unchanged in assertions: `packages/editor/test/header.test.ts` (operation options, hide value on remove, append display), `query.test.ts` (per-param operation, hide value, remount), `request-body.test.ts` / `response-body.test.ts` (mode select labels, replace vs regex, untagged regex still mounts as regex). No new tests.

**Recommendation:** worth pursuing

---

## 2. One `ACTION_PAYLOAD_FIELDS` list for persist + type-switch clear

### Candidate

`setValueAtPath` in `packages/editor/src/editor.ts` allowlists creatable keys with a long `finalSegment !== …` chain (`action`, `redirect`, `requestBody`, `responseBody`, four header siblings, plus matcher keys `description` / `method` / `type`). `ACTION_FIELDS` repeats the payload subset for `clearActionFields`. Phase 1 had to touch both; they can drift.

Keep matcher keys (`description`, `method`, `type`) out of clear. Share one `ACTION_PAYLOAD_FIELDS` (or equivalent) used by:

- persist: matcher keys ∪ payload fields
- clear: payload fields only, still honoring `keep` / `keepFields`

### Expected benefit

Next nested or sibling payload field is one list, not two. Type-switch leftover remount (the query `matches` / header sibling bug this feature fixed) stays a single source of truth.

### Risk

Low. Wrong membership would re-break add-on-empty-rule (key not creatable) or type-switch remount (key not cleared). `description` / `method` / `type` must not be cleared. `defaultFields` keep-set still wins over the list.

### Scope

`packages/editor/src/editor.ts` only (`setValueAtPath`, `ACTION_FIELDS` / `clearActionFields`). No extension API change.

### Test plan

`packages/editor/test/editor.test.ts`: builtin ids, add-rule payloads for header/redirect/body, type-switch clears stale header siblings / `action` / `requestBody` / `responseBody`. Header/query/body mount tests still persist fields. `pnpm --filter @rogatio/editor test`.

**Recommendation:** worth pursuing

---

## 3. Canonical `hasLoneSurrogate` beside `hasControl`

### Candidate

The same UTF-16 lone-surrogate loop now lives in six places. This feature copied it into `packages/editor/src/rule-types/response-body.ts` and extended schema / browser-schema / editor replace-body checks that already used local copies:

- `packages/schema/src/validation.ts`
- `packages/extension/src/browser-schema.ts` (already relative-imports `hasControl` from schema)
- `packages/editor/src/rule-types/request-body.ts`
- `packages/editor/src/rule-types/response-body.ts`
- `packages/runtime/src/request-body.ts`
- `packages/runtime/src/policy.ts`

Lift to a tiny schema module with no Ajv / `node:` imports (add to `packages/schema/src/control.ts` or a sibling `utf16.ts`), export from `@rogatio/schema`, re-export from `browser-schema.ts` the same way as `hasControl`. Callers import; do not change when the check runs or which diagnostic code/path it emits.

### Expected benefit

Replace-body surrogate policy cannot drift between editor, schema, MV3 mirror, and runtime. Matches the existing `hasControl` ownership pattern.

### Risk

Low–medium. Must stay browser-safe (no Ajv). Browser-schema must keep using the relative schema import, not the aliased `@rogatio/schema` specifier. Do not “improve” the algorithm. Existing tests already cover lone surrogates on request-body and response-body replace.

### Scope

New or extended schema helper; re-export in `packages/schema/src/index.ts` and `packages/extension/src/browser-schema.ts`; delete local copies listed above. No JSON Schema change. No new diagnostics.

### Test plan

Existing schema / editor / runtime / browser-schema replace-body and request-body surrogate cases. No assertion wording changes. `pnpm --filter @rogatio/schema test`, `--filter @rogatio/editor test`, `--filter @rogatio/runtime test`, `--filter @rogatio/extension test`.

**Recommendation:** worth pursuing

---

## 4. Editor header/query bounds from `LIMITS` — *marginal*

### Candidate

Query mount/validate uses local `MAX_QUERY_NAME_LENGTH` / `MAX_QUERY_VALUE_LENGTH` / `MAX_QUERY_PARAMS` that match `LIMITS`. Header validate/inputs use magic `256` / `4096`. Request-body and response-body already import `LIMITS` from `@rogatio/schema`. Point header and query at `LIMITS.maxHeader*` / `maxQuery*` (and `maxLength` on inputs).

### Expected benefit

A future bound change does not leave the editor form/validate one step behind schema.

### Risk

Low. Values are already equal. Editor already depends on `@rogatio/schema` `LIMITS` in body types. Do not import `validation.ts` / Ajv.

### Scope

`packages/editor/src/rule-types/query.ts`, `header.ts` only.

### Test plan

Existing header/query length tests; optional: one assertion that the input `maxLength` equals `LIMITS` (only if a test already inspects it).

**Recommendation:** marginal (cheap if already touching those files for candidate 1; otherwise defer)

---

## 5. Schema-owned response-body replace vs regex discriminators — *marginal*

### Candidate

Runtime `packages/runtime/src/response-body.ts` has private `isReplaceAction` / `responseBodyReplacements` (`mode === "replace"` vs `"replacements" in action`). Schema validation and editor `responseBodyOf` restate the same untagged-compat rule (missing `mode` + `replacements` ⇒ regex).

Export read-only helpers from schema, e.g. `isResponseBodyReplace` and `responseBodyReplacements`, and use them in schema semantic validation + runtime. Editor **keeps** `responseBodyOf` (drafts are incomplete; `body?` and empty regex rows are authoring states, not validated `ResponseBodyAction`).

Do **not** normalize untagged files to `{ mode: "regex", replacements }` on compile or save. That would change stored/compiled shape.

### Expected benefit

The untagged-compat rule lives in one typed helper for validated payloads. Runtime and schema cannot disagree on replace vs regex.

### Risk

Medium for the benefit. Editor still needs a looser parser, so duplication does not fully go away. Wrong narrowing could treat untagged as invalid or treat replace as regex (runtime would then apply the content-type decode gate). Browser-schema still mirrors by hand (Ajv-free MV3 constraint).

### Scope

`packages/schema/src/` (types or a small helper) + `validation.ts` + `packages/runtime/src/response-body.ts`. Not editor forms. Not compiler emit (still copy the union as-is).

### Test plan

Schema untagged-regex + tagged-regex + replace cases; runtime `fetchAndRewriteAuthorizedResponse` replace vs regex vs untagged; sample `rule-response-body` still verifies. No change to compiled JSON.

**Recommendation:** marginal (pursue only if a later response-body change already touches schema+runtime; not a standalone cleanup)

---

## Skipped (self-review)

| Idea | Why skip |
| --- | --- |
| Shared header/query “operation + hide/clear value” widget | Different models (siblings vs `action.params[]`); header does not remount, query does. Behavior/focus risk. |
| Shared request-body / response-body mode form | Regex UI differs (one pair vs replacement rows); response-body must preserve untagged `{ replacements }` on edit. Callback soup worse than two files. Candidate 1 covers the only cheap overlap (the `<select>`). |
| Unify query/response-body validation across schema, editor, browser-schema | Documented split: Ajv + semantic vs editor diagnostics vs MV3 mirror. Merging would pull Ajv into the extension bundle or weaken editor draft messages. |
| `queryParamOperation(param)` exported from schema | One `?? "set"` line; four call sites by design across packages. Abstraction cost > savings. |
| Convert `queryRuleType` singleton to `createQueryRuleType()` | Pre-existing; no second instance; churn for hosts/tests. |
| Compile/save normalize untagged response-body to tagged `mode: "regex"` | Wire-format change, not a refactor. Plan: untagged stays valid. |
| Delete mock keys from `LIMITS` | Native mock protocol still uses them (`packages/runtime/src/preset.ts`). Plan non-goal. |
| Import `isForbiddenHeader` into editor header.ts | Pre-existing F11 copy; this feature did not worsen it. Fine follow-up, not high leverage here. |
| Align body `matches()` to `rule.type` only (like query) | Behavior change for leftover payloads; type-switch already clears via `ACTION_FIELDS`. |
| Shared test `createMountContext` | Three near-identical helpers; tiny. Fold mechanically if candidate 1 already edits those tests; do not stand alone. |
| Header `destroy()` no-op `removeEventListener(() => {})` | Pre-existing; empty lambdas never unregister. Fix is a tiny bug, not this feature’s duplication. |

---

## Summary ranking

1. Shared rule-type `createSelect` — **worth pursuing**
2. Single `ACTION_PAYLOAD_FIELDS` persist/clear list — **worth pursuing**
3. Canonical `hasLoneSurrogate` — **worth pursuing**
4. Header/query bounds from `LIMITS` — **marginal**
5. Schema response-body discriminators for runtime — **marginal**
