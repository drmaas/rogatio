> Status: frozen 2026-09-14

# editor-rule-types — plan

## Implementation strategy

TDD

## Goal

Make the Workspace rule form author the types the product already runs: one built-in **Header** type (direction + set/remove, hide/clear value on remove), **Redirect**, **Query** with per-param set/remove like headers, **Request body** (already replace-or-regex), and **Response body** with a new full-replace mode beside regex rewrite. Register those types in `builtInRuleTypes` so hosts no longer gate visibility. Drop **mock** from the schema authoring surface, editor, and host registration because response-body replace supersedes it. Existing sample header rules (`samples/basic/.rogatio.json`) become editable; adding a new header or body rule writes a valid payload instead of a no-op.

## Non-goals

- Two dropdown types (“request header” / “response header”). Schema stays `type: "header"`.
- Exposing header `append` in the editor. Schema/compiler/DNR may keep `append`; UI does not add it.
- Dropping query from the editor or schema.
- Changing header payload to a nested object. Four sibling fields stay (`headerDirection`, `headerOperation`, `headerName`, `headerValue`).
- Multiple header modifications per rule (F11 non-goal).
- Reimplementing mock as a synthetic upstream-less response (custom status, mock headers, `delayMs`, file snapshot, no-upstream). Response-body replace rewrites a fetched body; it does not become a mock server.
- A lossy auto-migrator from `type: "mock"` to response-body replace.
- Bumping `PROJECT_VERSION`. Stay on version 1; mock files fail validation.
- Redesigning or deleting the native-host mock envelope/handshake (`mock.connect`, mock HTTP delivery) beyond compile/intake paths that would otherwise fail typecheck.
- Teaching the editor Chrome APIs, Ajv, or `@rogatio/schema` Node artifacts in the browser bundle.
- Query `append`, or reversing F10’s choice of `addOrReplaceParams` + `replaceOnly: false` for **set**.
- New AI-assist proposal kinds, new dry-run preview richness, or extra sample rules beyond what tests need.

## Architecture

### Authoring surface (built-in registry)

Dropdown options come only from `normalizeExtensions` → `builtInRuleTypes` plus optional host overrides (`packages/editor/src/editor.ts`, `packages/editor/src/rule-types/index.ts`). Today builtins are `query`, `mock`, `response-body`, `request-body`; redirect is host-only; header is implemented but unregistered. Target builtins: `header`, `redirect`, `query`, `request-body`, `response-body`. Hosts (`packages/extension/src/extension-page-entry.ts`, `packages/cli/src/commands/edit.ts`) stop passing `createMockRuleType` / `createRedirectRuleType` / `createResponseBodyRuleType` once those ids are built-in (passing a duplicate id only replaces the same extension).

### Editor core: initialize payloads, then mount

`setRuleType` currently returns unless `extension.defaultAction` is set, and writes **one** field (`actionField`, default `"action"`) (`packages/editor/src/editor.ts`). Redirect needs `actionField: "redirect"` plus `defaultAction: () => ({ destination: "" })`. Header cannot use that hook: schema stores four siblings (`packages/schema/src/types.ts`).

Add an optional `defaultFields?: () => Readonly<Record<string, unknown>>` on `RuleTypeFieldExtension` (`packages/editor/src/types.ts`). Relax the `setRuleType` gate: proceed when `defaultAction` **or** `defaultFields` is present (today `if (!extension?.defaultAction) return` blocks Header entirely). When `defaultFields` is present, write `type` and each own key from `defaultFields()`; otherwise keep the existing `actionField` / `defaultAction` path. Header uses:

- add: `{ headerDirection: "request", headerOperation: "set", headerName: "", headerValue: "" }`
- after the user switches Operation to `remove`: delete `headerValue` (do not persist `""`)

Do not special-case `"header"` inside `setRuleType`.

Also extend:

- `setValueAtPath` allowlist with `requestBody`, `responseBody`, `headerDirection`, `headerOperation`, `headerName`, `headerValue` (today new request-body / response-body / header keys never persist).
- `ACTION_FIELDS` / `clearActionFields` with `requestBody`, `responseBody`, and the four header siblings so type switches do not leave a stale payload. Query `matches` must use `rule.type === "query"` (not leftover `action.type`) so a leftover `action` cannot remount query after a switch.

Header Operation `<select>` lists **set** and **remove** only (`packages/editor/src/rule-types/header.ts`). If an existing file has `headerOperation: "append"`, show `append` in the control only while that value is current so the field is not blank; the user can leave it for set/remove and cannot pick append again. On `remove`, hide the value input and `deleteField("headerValue")`.

### Query set/remove (wire-format change)

Current shape (`packages/schema/src/types.ts`, `packages/schema/src/schema.ts` `$defs.queryParam`):

```ts
interface RogatioQueryParam { name: string; value: string }
interface RogatioQueryAction { type: "query"; params: RogatioQueryParam[] }
```

Compiler `queryParamsToDNR` maps every param to DNR `addOrReplaceParams` with `replaceOnly: false` (`packages/compiler/src/query.ts`). Extension projection writes only that array (`packages/extension/src/projection.ts`, `packages/extension/src/dnr.ts`). `applyQueryTransform` only add-or-replaces. Semantic validation only rejects duplicate names (`packages/schema/src/validation.ts`). Editor always requires a non-empty `value` (`packages/editor/src/rule-types/query.ts`). Browser-schema allowlists `QUERY_PARAM_KEYS = ["name", "value"]` (`packages/extension/src/browser-schema.ts`).

**Chosen shape** (mirror header per item; keep nested `action` because query already uses it; do not flatten to header-style siblings):

```ts
type QueryParamOperation = "set" | "remove";

interface RogatioQueryParam {
  name: string;
  operation?: QueryParamOperation; // omit => "set" (existing files, including samples/basic rule-query)
  value?: string;                  // required for set; omit for remove
}
```

JSON Schema (`additionalProperties: false`): `name` required; `operation` enum `set` | `remove`; `value` required when `operation` is absent or `"set"`; `value` forbidden when `operation` is `"remove"` (if/then, plus editor/browser-schema/semantic, same split as headers). Duplicate `name` still rejected across mixed set/remove.

Compiler public helper (breaking callers of `queryParamsToDNR`):

```ts
queryActionToDNR(action) => {
  addOrReplaceParams?: { name; value; replaceOnly: false }[]; // set params only
  removeParams?: string[];                                    // remove names only
}
```

Replace `queryParamsToDNR` with this (update all callers) rather than keeping two helpers. `applyQueryTransform` deletes names in `removeParams` and still add-or-replaces set params; remove-only params must not re-add the name, and mixed set+remove in one rule must preserve unrelated query keys. Omit empty arrays in the DNR object.

F10 rejected using `addParams` / `removeParams` / `replaceParams` **instead of** `addOrReplaceParams` for set. This plan still uses `addOrReplaceParams` + `replaceOnly: false` for set. `removeParams` is only for `operation: "remove"`.

Editor: each param row gets Operation set/remove; on remove, hide/clear the value input. Default add payload: `{ type: "query", params: [{ name: "", operation: "set", value: "" }] }`. No query append.

### Response-body replace (wire-format change)

Today `ResponseBodyAction` is only `{ replacements: { pattern, replacement }[] }` (`packages/schema/src/types.ts`, `packages/schema/src/schema.ts`). Runtime `rewriteResponseBody` applies those regexes to a fetched UTF-8 body (`packages/runtime/src/response-body.ts`). Editor label is “Response body rewrite”; default is one empty replacement row.

**Chosen shape** (mirror `RequestBodyAction`, keep existing files valid):

```ts
type ResponseBodyMode = "replace" | "regex";

type ResponseBodyAction =
  | { mode: "replace"; body: string }
  | { mode: "regex"; replacements: ResponseBodyReplacement[] };
```

JSON Schema `oneOf` also accepts untagged `{ replacements }` (no `mode`) so `samples/basic` `rule-response-body` and existing projects stay valid. Compiler/runtime/editor treat missing `mode` + `replacements` as regex; do not advertise untagged as a third product mode. New editor writes explicit `mode`. Bound `body` with a new `LIMITS.maxResponseBodyBytes` equal to `RUNTIME_LIMITS.maxResponseBodyBytes` (4 194 304), not mock’s 64 KiB and not regex replacement’s 4096. Compiler continues to copy `responseBody` onto `ResponseBodyOperation`. Runtime: branch in `fetchAndRewriteAuthorizedResponse` (or equivalent dispatch): `mode === "replace"` encodes the configured UTF-8 body after the existing authorized fetch, preserves upstream status/headers like the regex path, and does not require upstream `content-type` to pass the regex decode gate; authored replace body still must respect `maxResponseBodyBytes`. Editor: mode select like request-body (`packages/editor/src/rule-types/request-body.ts`); default `{ mode: "replace", body: "" }`; label **Response body**.

### Mock removal (wire-format break)

Drop `"mock"` from `RuleType`, `RogatioRule.mock`, JSON Schema `$defs.mock*`, compiler `MockOperation` (including `packages/compiler/src/selector.ts`), editor `createMockRuleType`, host `ruleTypes` entries, browser-schema mock branches, CLI `createMockPreviewAction` / `buildMockConfigs` mock kind, runtime `op.kind === "mock"` config intake, `RuleProposal.kind` `"mock"`, and runtime AI prompt unions that list mock. Existing `type: "mock"` projects fail schema validation (stable enum diagnostic). Sample has no mock rules. Do not convert mock payloads into response-body replace (status/headers/delay/file/no-upstream have no mapping). Leave unused native mock protocol code only if removing it is not required for `pnpm validate`; do not spend this feature redesigning the host.

### Package direction

`schema` → `compiler` → `{ editor, dry-run, browser-core, runtime }` → `{ cli, extension }`. Schema owns query/response-body/mock types. Compiler owns DNR query transform and operation kinds. Runtime owns response-body replace execution. Editor owns forms and `builtInRuleTypes`. Extension mirrors validation in `browser-schema.ts` and projects DNR. CLI hosts the editor and dry-run preview seam. No new packages.

### Durable docs

`docs/architecture.md`, `README.md`, `packages/*/README.md`, `packages/docs-site/`, and `rogatio-overview.md` describe current behavior and update in the phase that changes the contract. Decision records stay append-only.

## Phases

### Phase 1 — Editor plumbing + Header + Redirect builtins (checklist 1.x)

Register `createHeaderRuleType` and `createRedirectRuleType` in `builtInRuleTypes`. Teach `setRuleType` to apply `defaultFields` / redirect `defaultAction`. Expand persist/clear allowlists so header siblings and `requestBody` / `responseBody` survive add and are cleared on type switch. Header form: set/remove only, default payload on add, hide/clear value on remove. Redirect form: `defaultAction` + `actionField: "redirect"` on the factory itself so a host that still passes `createRedirectRuleType()` does not replace the builtin with a payload-less copy. Mock stays until phase 6. Note editor builtin list in `docs/architecture.md`.

### Phase 2 — Query set/remove wire (schema, compiler, extension) (checklist 2.x)

Change `RogatioQueryParam` as above. JSON Schema + semantic validation + schema tests. Compiler `queryActionToDNR` + `applyQueryTransform` remove semantics + caller updates. Extension projection/DNR emit `removeParams` when present. Browser-schema allowlist `operation` and the value/remove rules. Existing `{ name, value }` files keep compiling as set. Update `rogatio-overview.md` / `docs/architecture.md` query wording so set/remove is current behavior.

### Phase 3 — Editor query set/remove UI (checklist 3.x)

Query rows gain Operation set/remove; hide/clear value on remove; validate accordingly; `matches` keys off `rule.type === "query"`; defaultAction writes `operation: "set"`. Unit tests for both operations.

### Phase 4 — Response-body replace wire (schema, compiler, runtime, browser-schema) (checklist 4.x)

Introduce the response-body union with untagged-regex JSON compat. Schema tests. Compiler copies the union (missing `mode` + `replacements` ⇒ regex). Runtime replace path beside regex rewrite; still fetch-then-replace. Browser-schema mirrors the union. Sample `rule-response-body` stays untagged regex and remains valid. Update overview/architecture response-body wording.

### Phase 5 — Editor response-body replace UI (checklist 5.x)

Mode select Replace / Regex rewrite, default replace, explicit `mode` on new rules, untagged files still mount as regex. Tests for both modes, including add on a brand-new rule. Docs-site rule-type copy if it still says “rewrite” only.

### Phase 6 — Remove mock authoring and compile intake (checklist 6.x)

Delete mock from schema enum and payloads, compiler operation, editor builtin/export, hosts, browser-schema, AI `RuleProposal` kind, CLI mock preview/intake, runtime mock config intake, and tests that construct mock rules. Remove redundant host `ruleTypes` overrides for redirect and response-body once builtins carry the final factories (CLI `edit.ts`, extension Workspace). Update product docs that currently list mocks as a rule type. No migrator. Native mock protocol beyond intake: only if typecheck requires it.

## Risks

- **Mock ≠ response-body replace.** Mock serves status/headers/delay/file without upstream. Replace rewrites a fetched body. Treating replace as a mock substitute is a product break for anyone with mock files; those files will fail validation. Do not paper over that with a converter or a second “synthetic response” mode (over-engineering).
- **Query wire-format.** `value` is required today. Making it optional and adding `operation` is a public schema/compiler/DNR change. Callers of `queryParamsToDNR` (`packages/compiler/src/index.ts`, `packages/extension/src/projection.ts`, `packages/extension/src/dnr.ts`, tests) must move to `queryActionToDNR`. Mixed set+remove in one rule must omit empty DNR arrays. F10’s add-or-replace-for-set decision stays.
- **Response-body wire-format.** Adding `mode` / `body` without accepting untagged `{ replacements }` would break `samples/basic` and existing projects. Untagged = regex is mandatory compat, not a second product mode to advertise.
- **Header `setRuleType`.** Registering Header without relaxing the `defaultAction`-only gate, plus `defaultFields`, allowlist, and clear siblings, shows the option but cannot add or switch types correctly (four siblings vs one `actionField`).
- **Response-body replace runtime.** Replace mode must not inherit regex-only upstream `content-type` / `content-encoding` decode failures; authored body bytes still bound by `maxResponseBodyBytes`. Status/headers stay from the fetch unless a later spec says otherwise.
- **Host `ruleTypes` overrides.** Extension/CLI still pass `createRedirectRuleType()` / `createResponseBodyRuleType()` today; those entries replace builtins by id. Factories must carry `defaultAction` / label changes, but redundant host entries can shadow future builtin-only wiring — drop them in phase 6 when mock is removed.
- **Append-only files.** Schema keeps `append`; UI hides it. Opening an append rule needs a display path so the select is not blank; do not add append to the normal option list.
- **Query `matches` on `action.type`.** Leftover `action` after switching away from query can remount the query form unless `matches` uses `rule.type`.
- **`pnpm validate` per phase.** Mock types are referenced across schema, compiler, editor, cli, runtime, extension, AI types. Phase 6 must land as one green slice, not a schema-only commit.
- **Over-engineering to refuse:** nested header object; two header dropdown types; query flatten to header siblings; project version bump; mock→replace migrator; ripping `mock.connect`; new preview kinds; extra sample rules; `defaultFields` plus a header special case in `setRuleType`; a third query DNR helper kept “for compat”.

## Acceptance criteria

Observable in the Workspace / CLI editor against `samples/basic/.rogatio.json` and a new empty rule:

1. Rule type dropdown lists exactly: Header, Redirect, Query parameters, Request body, Response body (labels as implemented; **no** Mock response, **no** separate request/response header types).
2. Opening `rule-header-set` and `rule-header-remove` shows direction, operation, header name, and (for set only) header value. Remove does not show a value input.
3. Add rule → Header writes `type: "header"` with direction `request`, operation `set`, empty name/value. Switching operation to remove hides the value input and omits `headerValue` from the draft (not `""`). Save fails on empty name / forbidden name the same way schema already does; save succeeds once name/value are valid.
4. Add rule → Redirect writes `redirect.destination` and the destination field is editable (not a no-op).
5. Add rule → Request body or Response body writes the nested payload; the form mounts (replace mode by default for both). Switching type away from header/query/body clears the previous action payload so it does not remount.
6. Query param rows offer set and remove. Remove hides/clears value. Existing `rule-query` (`{ name, value }` only) still opens as set and still verifies. A param with `operation: "remove"` compiles to DNR `redirect.transform.query.removeParams` and `applyQueryTransform` drops that name. A rule mixing set and remove params in one `action.params` array compiles with both DNR fields and transforms correctly.
7. Response-body replace: a rule `{ mode: "replace", body }` validates, compiles to `ResponseBodyOperation`, and the runtime replace path returns that body (fetch still happens; upstream status/headers preserved). Untagged `{ replacements: [...] }` still validates as regex rewrite. Sample `rule-response-body` still verifies.
8. A project with `type: "mock"` fails schema validation. The editor cannot add mock. Hosts do not register mock or other redundant overrides once phase 6 lands.
9. Header `append` remains valid in schema/compiler/DNR if present in a file; the editor shows `append` in the Operation select only while it is the current value (select not blank), the user may switch to set/remove, and append is not offered for new picks.
10. Opening sample `rule-redirect` (if present) or an existing redirect rule shows an editable destination field after phase 1.
11. `samples/basic/.rogatio.json` still verifies after the schema changes (header, query-as-set, untagged response-body, request-body, redirect) via `rogatio verify` / packaged integration coverage, not schema unit tests alone.
12. `pnpm validate` is green on the worktree after each phase.
