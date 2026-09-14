# editor-rule-types — research

## Problem restatement

Rules need fixing in the Rogatio editor (Workspace rule form). In the sample project, rules like "set request header" and "remove response header" exist, but the editor Rule type dropdown has no header rule types and no way to specify header key / header value (when adding).

Observed dropdown options include: No action, Query parameters, Mock response, Response body rewrite, Request body, Redirect — missing request/response header.

Desired rule types:

- request body (replace or rewrite via regex)
- response body (replace or rewrite via regex)
- redirect
- request header (set or remove)
- response header (set or remove)

No need for query parameters (satisfied by redirect rule).

## Codebase findings

### Schema already defines all six action types, including headers and query

`RuleType` is `"redirect" | "query" | "header" | "mock" | "response-body" | "request-body"` (`packages/schema/src/types.ts:37-43`). The JSON Schema `type` enum matches that list (`packages/schema/src/schema.ts:100-109`). Semantic validation rejects any other string with the same six allowed values (`packages/schema/src/validation.ts:214-238`).

Header is a first-class rule variant, not an editor-only UI. A `type === "header"` rule requires `headerDirection`, `headerOperation`, and `headerName` (`packages/schema/src/schema.ts:156-164`). Direction is `"request" | "response"`; operation is `"set" | "append" | "remove"` (`packages/schema/src/types.ts:45-46`, `packages/schema/src/schema.ts:120-121`). `headerValue` is required for `set` and `append` (`packages/schema/src/schema.ts:186-204`). JSON Schema and `packages/schema/src/validation.ts` do not forbid `headerValue` when operation is `remove`; the editor header extension (`packages/editor/src/rule-types/header.ts:262-268`) and browser-schema (`packages/extension/src/browser-schema.ts:716-718`) do. Chrome DNR rejects a remove action that still carries `value` (`packages/extension/test/permission-grant.test.ts:313-317`).

Query is also first-class in schema, not an editor-only extra: `type === "query"` requires `action` (`packages/schema/src/schema.ts:146-154`), and `action` is a `{ type: "query"; params: [...] }` object (`packages/schema/src/types.ts:58-61`, `packages/schema/src/schema.ts:245-257`). Duplicate query param names are rejected semantically (`packages/schema/src/validation.ts:293-311`).

Request-body already has the replace-or-regex split the user wants: `RequestBodyMode = "replace" | "regex"` (`packages/schema/src/types.ts:98-113`), with `oneOf` replace (`mode` + `body`) and regex (`mode` + `pattern` + `replacement`) (`packages/schema/src/schema.ts:336-371`). `type === "request-body"` also requires `method` and `resourceTypes` (`packages/schema/src/schema.ts:216-224`).

Response-body does **not** have a full-body replace mode. `ResponseBodyAction` is only `{ replacements: { pattern, replacement }[] }` (`packages/schema/src/types.ts:89-96`). Each `pattern` is format `rogatio-url-regex` (`packages/schema/src/schema.ts:306-335`). Semantic validation requires at least one replacement and a compilable regex (`packages/schema/src/validation.ts:327-355`). There is no `mode: "replace"` analogue for response body.

Header names/values are bounded (`LIMITS.maxHeaderNameLength: 256`, `maxHeaderValueLength: 4096` at `packages/schema/src/limits.ts:18-19`). Forbidden names are frozen lists plus `proxy-`/`sec-` request prefixes, matched case-insensitively (`packages/schema/src/headers.ts:3-64`); semantic validation calls `isForbiddenHeader` for `type === "header"` (`packages/schema/src/validation.ts:312-325`).

### Compiler already emits header (and query, body, redirect, mock) operations

`compileOperations` dispatches on `rule.type` (`packages/compiler/src/compile.ts:216-291`):

- `redirect` → `RedirectOperation` (`:216-224`)
- `query` with `action.type === "query"` → `QueryOperation` (`:225-239`)
- `header` → `HeaderOperation` with `{ direction, operation, name, value? }` (`:240-255`)
- `mock` → `MockOperation` (`:256-264`)
- `response-body` → `ResponseBodyOperation` (`:265-273`)
- `request-body` → `RequestBodyOperation` (`:274-282`)
- anything else → actionless `MatcherOperation` (`:283-291`)

`HeaderOperation.header` carries `direction: HeaderDirection`, `operation: HeaderOperationKind` (`set | append | remove`), `name`, optional `value` (`packages/compiler/src/types.ts:46-57`). Compiler tests compile request set, response direction, append, and remove (`packages/compiler/test/compiler.test.ts:578-642`).

Header shape is enforced at schema/editor/browser-schema validation; the compiler emits operations from already-validated rules and does not run a separate header pass.

### Extension DNR already installs header set/append/remove

`projectHeaders` maps `HeaderOperation` to `HeaderProjection` with `direction`, `operation`, `headerName`, `headerValue` (`packages/extension/src/projection.ts:49-61`, `:256-288`). `isHeaderOperation` accepts `set | append | remove` and requires `value` for set/append, forbids `value` on remove (`packages/extension/src/projection.ts:113-136`).

`toDnrRule` emits Chrome `modifyHeaders`: request direction writes only `requestHeaders`; response direction writes only `responseHeaders` (`packages/extension/src/installer.ts:94-129`). `DnrHeaderAction.operation` is `"set" | "append" | "remove"` (`packages/extension/src/installer.ts:25-29`). Installer unit tests cover omitting the opposite-direction array and omitting `value` on remove (`packages/extension/test/installer.test.ts:41-77`). Permission-grant tests assert installed sample-shaped header rules submit `set` on `requestHeaders` and `remove` on `responseHeaders` with no opposite-direction key and no `value` on remove (`packages/extension/test/permission-grant.test.ts:305-317`).

The extension browser-schema mirror validates header direction/operation/name/value, forbidden names, and "no value on remove" (`packages/extension/src/browser-schema.ts:679-718`).

Redirect, query, and header rules run entirely in the browser; response-body and request-body need the native runtime (`rogatio-overview.md:35`).

### Sample project already contains header rules the editor cannot author

`samples/basic/.rogatio.json` includes:

- `rule-header-set`: `type: "header"`, `headerDirection: "request"`, `headerOperation: "set"`, `headerName: "X-Rogatio-Sample"`, `headerValue: "enabled"` (`samples/basic/.rogatio.json:36-48`)
- `rule-header-remove`: `type: "header"`, `headerDirection: "response"`, `headerOperation: "remove"`, `headerName: "X-Test-Header"` (no `headerValue`) (`samples/basic/.rogatio.json:50-61`)

The same file also has redirect, query, response-body (regex replacements), and request-body (`mode: "replace"`) (`samples/basic/.rogatio.json:11-90`). Description: "Exercises redirect, query, header, response-body, and request-body rule types." (`samples/basic/.rogatio.json:4`).

### Editor dropdown is the registered extension list, not the schema enum

The Rule type `<select>` is built only from `this.extensions` (`packages/editor/src/editor.ts:2366-2396`):

- empty option text: `"No action (choose a rule type)"` (`:2382-2385`)
- one `<option>` per extension, `value = extension.id`, `text = extension.label` (`:2386-2390`)

`this.extensions` is `normalizeExtensions(options.ruleTypes)` (`packages/editor/src/editor.ts:3014-3015`). That function always starts from `builtInRuleTypes`, then appends or replaces by `id` from the host list (`packages/editor/src/editor.ts:463-508`).

`builtInRuleTypes` today (`packages/editor/src/rule-types/index.ts:12-17`):

| id | label | file |
| --- | --- | --- |
| `query` | `"Query parameters"` | `packages/editor/src/rule-types/query.ts:42-44` |
| `mock` | `"Mock response"` | `packages/editor/src/rule-types/mock.ts:51-54` |
| `response-body` | `"Response body rewrite"` | `packages/editor/src/rule-types/response-body.ts:31-34` |
| `request-body` | `"Request body"` | `packages/editor/src/rule-types/request-body.ts:51-54` |

Header and redirect are **not** in that array. `createHeaderRuleType` and `createRedirectRuleType` are implemented and exported (`packages/editor/src/index.ts:2-10`, `packages/editor/src/rule-types/header.ts:111-114`, `packages/editor/src/rule-types/redirect.ts:9-12`).

### Workspace (and CLI) hosts register redirect/mock/response-body, never header

Extension Workspace `createEditor` passes (`packages/extension/src/extension-page-entry.ts:1065-1071`):

```ts
ruleTypes: [
  createRedirectRuleType(),
  createMockRuleType(),
  createResponseBodyRuleType(),
]
```

CLI `edit` page template passes the same three (`packages/cli/src/commands/edit.ts:314`, `:363-364`). Neither host imports or passes `createHeaderRuleType`. `createRequestBodyRuleType` is omitted from the host list because it is already built-in.

Merged dropdown ids/labels therefore are:

1. Query parameters (`query`, built-in)
2. Mock response (`mock`, built-in, replaced by host copy)
3. Response body rewrite (`response-body`, built-in, replaced by host copy)
4. Request body (`request-body`, built-in)
5. Redirect (`redirect`, host-only)

That matches the observed Workspace options. There is no `header` option. A prior plan recorded this as known follow-up: hosts supply redirect/mock/response-body only; the header field extension exists but is not built in (`docs/plans/header-rule-status-errors.md:107`, `packages/editor/src/rule-types/index.ts:12-17`).

When an existing sample header rule is opened, `findExtension` has nothing whose `matches` returns true because `createHeaderRuleType` is not registered (`packages/editor/src/editor.ts:1015-1056`, `:2399-2401`). The select's `currentType` falls back to `safeText(rule.type)` which is `"header"` (`packages/editor/src/editor.ts:2367-2370`, `:2392`). There is no option with that value, so the header payload is not mounted (`mountExtension` only runs when `match.extension` is set). The card shows matcher fields only: no header name, no header value.

### Header UI already exists as one type with direction + operation, not two types

`createHeaderRuleType()` (`packages/editor/src/rule-types/header.ts:111-273`):

- `id: "header"`, `label: "Header"` (`:113-114`)
- `matches`: `rule.type === "header"` (`:115-117`)
- mount: Direction `<select>` (`request`/`response`), Operation `<select>` (`set`/`append`/`remove`), Header name input (max 256), Header value input (max 4096) (`:118-185`, operations list `:73-77`)
- validate: direction/operation enums, name length, `isForbiddenHeader`, value required for set/append, value forbidden for remove (`:198-270`)
- **no** `defaultAction`
- **no** `actionField`

Schema stores header payload as four sibling fields on the rule (`headerDirection`, `headerOperation`, `headerName`, `headerValue` at `packages/schema/src/types.ts:136-140`), not a nested `header` object. Other types write one nested field (`redirect`, `action`, `mock`, `responseBody`, `requestBody`).

The header value input is always rendered, including for `remove` (`packages/editor/src/rule-types/header.ts:172-185`). Validate errors if `headerValue !== undefined` on remove (`:262-268`). An empty string from the input is not `undefined`.

There is no `packages/editor/test` file for the header extension. Redirect, mock, query, request-body, and response-body each have tests (`packages/editor/test/*.ts`). `builtInRuleTypes` tests assert `query` and `mock` ids only (`packages/editor/test/editor.test.ts:66-68`, `packages/editor/test/mock.test.ts:24`).

### Selecting a type is gated on `defaultAction`; several types cannot be *added*

`setRuleType` (`packages/editor/src/editor.ts:1130-1156`):

1. Empty id → delete `type` and `clearActionFields`.
2. Look up extension by `id`.
3. **`if (!extension?.defaultAction) return;`** — no draft change (`packages/editor/src/editor.ts:1143`).
4. Write `type` and `rule[actionField]` where `actionField` defaults to `"action"` (`packages/editor/src/types.ts:154-160`).
5. `clearActionFields(rule, actionField)`.

`setRuleType` initializes **one** payload field via `actionField`/`defaultAction`. Header rules store four sibling fields (`headerDirection`, `headerOperation`, `headerName`, `headerValue`), so the existing hook cannot seed a new header rule without editor changes beyond registration. Redirect stores a nested `redirect` object and also lacks both `defaultAction` and `actionField: "redirect"`.

`query`, `mock`, `response-body`, and `request-body` supply `defaultAction` (`packages/editor/src/rule-types/query.ts:207-209`, `mock.ts:376-378`, `response-body.ts:159-161`, `request-body.ts:248-250`). `createRedirectRuleType` and `createHeaderRuleType` do not. Selecting Redirect or Header (if registered) on a new rule is a no-op.

New rules from Add rule have no `type` and no action payload (`packages/editor/src/editor.ts:1201-1213`).

`setValueAtPath` will create only these missing keys: `description`, `method`, `type`, `action`, `redirect`, `mock` (`packages/editor/src/editor.ts:299-307`). It will **not** create `requestBody`, `responseBody`, `headerDirection`, `headerName`, `headerOperation`, or `headerValue`. Selecting request-body or response-body on a brand-new rule therefore sets `type` but fails to write the default payload. Request-body and response-body mounts then bail if the payload is missing (`packages/editor/src/rule-types/request-body.ts:184-186`, `packages/editor/src/rule-types/response-body.ts:94-96`). Editing the sample's existing body rules still works because those objects are already on the rule.

Extension `setField` *can* create new keys via `Object.defineProperty` (`packages/editor/src/editor.ts:2585-2591`). `headerDirection` is not in `COMMON_RULE_FIELDS` (`packages/editor/src/editor.ts:49-58`), so the header form can persist those siblings **after** it is mounted. The blocker for adding is registration + `defaultAction` + `setRuleType`/`setValueAtPath`, not `setField`.

`clearActionFields` only deletes `redirect`, `action`, and `mock` (`packages/editor/src/editor.ts:401-414`). Switching types does not clear `requestBody`, `responseBody`, or the four header siblings.

### Request body vs response body in the editor today

Request-body form (`packages/editor/src/rule-types/request-body.ts:181-247`): mode select `"Replace body"` / `"Regex replace"`; replace shows a textarea `body`; regex shows `pattern` and `replacement`. Default action is `{ mode: "replace", body: "" }` (`:248-250`). Unit tests cover both modes (`packages/editor/test/request-body.test.ts:4-39`). This already matches "request body (replace or rewrite via regex)".

Response-body form (`packages/editor/src/rule-types/response-body.ts:91-161`): ordered pattern/replacement rows, add/remove. Default action is `{ replacements: [{ pattern: "", replacement: "" }] }` (`:159-161`). Label is `"Response body rewrite"` (`:34`). There is no full-body replace control. This matches schema (regex replacements only), not the user's "replace or rewrite via regex" for response body.

### Query is first-class; dropping it is an editor-policy choice, not a schema gap

Query lives in schema, compiler (`packages/compiler/src/compile.ts:225-239`), DNR `redirect.transform.query` (`packages/extension/src/projection.ts:229-237`, `packages/compiler/src/query.ts:9-13`), the sample (`samples/basic/.rogatio.json:23-35`), and `builtInRuleTypes`. Overview lists query as a product feature (`rogatio-overview.md:12`). Removing it from the dropdown does not remove the schema type. If the query extension is unregistered, the sample's `rule-query` would render like header rules do now: type present, no param form.

Query `matches` looks at `action.type === "query"`, not `rule.type` (`packages/editor/src/rule-types/query.ts:46-50`). A leftover `action` after a type switch could still match query.

F11 specified a header `RuleTypeFieldExtension` with direction/operation/name/value (`docs/specs/f11-header-rules.md:75-76`); the implementation exists; registration into the live Workspace dropdown was left as follow-up (`docs/plans/header-rule-status-errors.md:107`).

## External findings

Not greenfield. Skipped.

## Constraints and invariants

- Version-1 schema `additionalProperties: false`; header payload is four top-level rule fields, not a nested object (`packages/schema/src/schema.ts`, `packages/schema/src/types.ts:136-140`). Changing that is a schema break. Existing sample rules use the flat shape (`samples/basic/.rogatio.json:44-60`).
- One header modification per rule (F11 non-goal: multiple headers per rule) (`docs/specs/f11-header-rules.md:34-36`). Sample rules are one set and one remove.
- Forbidden-header policy is schema-owned and must stay case-insensitive (`packages/schema/src/headers.ts`, `rogatio-overview.md:13`). Editor header extension duplicates the lists locally (`packages/editor/src/rule-types/header.ts:10-51`) instead of importing `@rogatio/schema` (browser-bundle constraint: editor must not import Node/Ajv schema artifacts — `docs/architecture.md:175`, `AGENTS.md` editor boundary).
- `set`/`append` require `headerValue`; `remove` must omit it (`packages/schema/src/schema.ts:186-204`; editor/browser-schema enforce the remove side).
- Header, redirect, and query execute in Chrome DNR; response-body and request-body require the native runtime (`rogatio-overview.md:35`).
- Package direction: schema → compiler → editor; editor hosts (cli, extension) register extra `RuleTypeFieldExtension`s (`docs/architecture.md:169-173`). Do not teach the editor Chrome APIs.
- `setRuleType` currently requires `defaultAction` and writes a single `actionField` (`packages/editor/src/editor.ts:1143-1150`). Wiring header/redirect into the dropdown without new initialization logic will show the option but not create a valid rule (header: four sibling fields; redirect: nested `redirect`, needs `actionField: "redirect"`).
- `setValueAtPath` allowlist and `ACTION_FIELDS` must be extended if new rules are to persist `requestBody` / `responseBody` / header siblings (`packages/editor/src/editor.ts:299-307`, `:401`).
- Query remains a valid schema type even if the editor hides it. Sample `rule-query` would become uneditable in the form if the query extension is removed.
- User-stated non-need: query-parameter rules in the editor. User-stated desired operations for headers: set or remove (schema also has `append`).
- Durable docs that describe current behavior and must stay in sync if the editor surface changes: `docs/architecture.md`, `README.md`, `packages/*/README.md`, `packages/docs-site/` (`AGENTS.md` durable documentation). Decision records stay append-only.

## Open questions

1. One dropdown type `"Header"` with Direction + Operation (existing `createHeaderRuleType`, matching schema `type: "header"`), or two types "request header" / "response header" as listed in the problem? Two types would still serialize to the same schema fields unless schema is changed.
2. Keep schema `append` in the Operation select, or restrict the editor to set/remove as the problem states?
3. Hide query from the dropdown only, or also keep the query extension so `samples/basic` `rule-query` remains editable? Schema/compiler/DNR query support is not implied to be deleted.
4. For response body, is regex `replacements[]` enough ("rewrite via regex"), or is a new schema `mode: "replace"` full-body field required to match request-body? The latter is a schema/compiler/runtime change, not just editor.
5. Register `createHeaderRuleType` (and `createRedirectRuleType`) in `builtInRuleTypes`, or keep passing them from extension/CLI hosts? Built-in is how query/mock/body landed; host list is how redirect is visible today. Hosts currently omit header in both places.
6. When adding a header rule, what default payload? Direction `request`, operation `set`, empty name, empty value would fail schema until filled; remove defaults must not write `headerValue`. Likely needs a `setRuleType` change (or equivalent) that writes all four sibling fields and extends `setValueAtPath` allowlist.
7. Should mock stay in the dropdown? The problem's desired list does not mention it; it is already present and first-class. No instruction to remove it.
8. Should selecting `remove` hide or clear the header value input (today it stays visible and empty string is not `undefined`, so save can fail validation)?

## Resolved decisions (research-review gate, 2026-09-14)

Human approved research with these answers to open questions:

1. **One** dropdown type `"Header"` with Direction + Operation (existing schema `type: "header"`).
2. Editor Operation select: **set / remove only** (schema may retain `append`; UI does not expose it).
3. **Keep** query rules in the editor. Change query UX so params can **set or remove** like headers (not drop query).
4. **Add** response-body full **replace** mode (alongside regex rewrite). This **supersedes mock**.
5. Register header (and related types) as **built-in** (`builtInRuleTypes`), not host-only.
6. Default header payload on add: yes (direction `request`, operation `set`, empty name/value as appropriate; remove must omit `headerValue`).
7. **Remove** mock concept altogether; superseded by response-body replace. Drop mock from dropdown, schema surface for new authoring, and related editor/host paths as planned (migration/compat for existing mock rules to be decided in plan).
8. On Operation `remove`: **hide and clear** the header value input (do not leave empty string that fails validation).

