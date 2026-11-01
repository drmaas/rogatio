# F10 — Query Parameter Rules

Status: Draft for review
Tier: Free (SDD)
Depends on: F7 (Chrome MV3 extension shell), F5 (editor)

## 1. Problem statement and goals

`rogatio-overview.md` lists **Query parameters** as a supported rule type: *"Add missing configured parameters and replace all existing values for configured names while preserving unrelated parameters, scheme, authority, path, and fragment."*

When F7 shipped the extension shell, the version-1 schema had no rule **action** field. Every compiled rule was treated as `unsupported` because no action slice had defined its effect (F7 deferral). F10 is the **first rule-action slice** and establishes the shared `action` discriminator that all later browser-only rule types (F9 redirect, F11 header, F13 mock) will extend.

Goal: a user can create a query-parameter rule, the schema/compiler validates it, the extension installs it as a Declarative Net Request (DNR) `redirect` + `transform.query` rule, the editor renders the param fields and a rule-type selector, and the rule status reports `active` (not `unsupported`) when enabled and granted.

## 2. Scope and non-goals

In scope:
- Extend the version-1 schema with a required `action` field whose first variant is `QueryAction`.
- Compiler emits a rule operation carrying `matcher` + `action`.
- Extension DNR translation of a query action into `redirect.transform.query`.
- Extension rule status `active` for installed query rules (was `unsupported` for actionless rules).
- Editor `RuleTypeFieldExtension` for `query` plus a rule-type selector.
- Bounds: max params per rule, param name/value lengths, unique param names.
- Offline testability of the query transform (pure function) — preview belongs to F12, but F10 ships the pure translation and its unit tests.

Non-goals (deferred to their sequence items):
- Redirect (F9), header (F11), mock (F13), response/request body (F15/F17) actions.
- The dry-run preview UI and batched URL testing (F12) — F10 only provides the pure transform used by that future slice.
- The bounded/redacted `[Rogatio]` DevTools Console record (later feature).
- Any change to F7's rule status model enum or the `needs proxy` / `needs runtime` states (those belong to runtime-dependent rules).

## 3. Actors, entry points, supported environments

- Same as F7/F5: Node 24+ CLI, Chrome MV3 browser, Linux/Windows/macOS (query rules are browser-only and supported on all three; activation is in-browser, no native runtime).
- Entry points: editor `Project`/`Group` rule create form; CLI `verify` and `edit`; extension import/export of `.rogatio.json`.

## 4. Functional requirements

- **REQ-001** A `RogatioRule` MUST carry an `action` object with a `type` string discriminant. For F10 the only valid `type` is `"query"`.
- **REQ-002** `QueryAction` = `{ type: "query", params: QueryParam[] }` where `QueryParam = { name: string; value: string }`. `params` MUST be a non-empty array.
- **REQ-003** For each configured param: if the matched request URL already carries that name, **all** existing values for that name are replaced with the configured value; if the name is absent, the configured name/value is added. Unrelated query parameters and the URL scheme, authority, path, and fragment are preserved.
- **REQ-004** Param `name` and `value` MUST be non-empty strings, `name` length ≤ `maxQueryNameLength`, `value` length ≤ `maxQueryValueLength`, and `params.length` ≤ `maxQueryParamsPerRule`.
- **REQ-005** Param `name` MUST be unique within a rule's `params` (duplicate name is a diagnostic error).
- **REQ-006** The `action` value MUST exactly match the `QueryAction` shape for `type:"query"`; unknown `type` values are a schema/validation error (not silently ignored).
- **REQ-007** The compiler MUST emit one rule operation per rule carrying both `matcher` (condition) and `action`.
- **REQ-008** The extension MUST translate a `query` action into a DNR rule: `action: { type: "redirect", redirect: { transform: { query: { addOrReplaceParams: params.map(p => ({ name, value, replaceOnly: false })) } } } }`, with the rule condition derived from the matcher (regexFilter, resourceTypes, requestMethods when `method` is set, initiator/request domains from `origins`).
- **REQ-009** The extension MUST mark a query rule `installable: true` and report status `active` when the rule is enabled and its declared origins are granted; it MUST NOT report query rules as `unsupported`.
- **REQ-010** The editor MUST expose a rule-type selector listing the registered `RuleTypeFieldExtension` labels; selecting `query` initializes `action = { type: "query", params: [] }` and mounts the query field extension (param name/value editor with add/remove).
- **REQ-011** The editor query field extension MUST validate params against REQ-002..REQ-005 and surface field-level errors; it MUST NOT persist arbitrary action data for which no registered extension exists.
- **REQ-012** Browser-side schema validation (`browser-schema.ts`) MUST validate the `action` field identically to the Node schema so the extension rejects malformed query rules before install.

## 5. Acceptance criteria

- **AC-001** A project whose rule has `action: { type: "query", params: [{ name: "utm_source", value: "rogatio" }] }` validates through both `validateProjectDetailed` (Node) and the extension `validateProjectDetailed`.
- **AC-002** A rule with `action.type` other than `"query"` (e.g. `"redirect"`) fails validation in both Node and browser schema with a stable diagnostic.
- **AC-003** A query rule with `params: []`, or with a duplicate param name, or an empty param name/value, fails validation with the corresponding diagnostic.
- **AC-004** `compileProject` emits one operation per rule carrying `matcher` and `action`; the operation `action.type` is `"query"`.
- **AC-005** `projectMatchers` returns `installable: true` for a query rule and produces a DNR rule whose `action.redirect.transform.query.addOrReplaceParams` equals the params with `replaceOnly: false`.
- **AC-006** The pure transform helper `applyQueryTransform(url, action)` (or equivalent) given `https://ex.com/p?b=2#frag` and param `{ name: "a", value: "1" }` returns `https://ex.com/p?b=2&a=1#frag` (a new name is appended at the end, matching DNR `addOrReplaceParams` `replaceOnly:false` semantics); given param `{ name: "b", value: "9" }` returns `https://ex.com/p?b=9#frag` (existing value replaced in place); unrelated params, scheme, authority, path, and fragment are preserved.
- **AC-007** The extension `operationStatuses` reports a query rule as `active` when compiled+enabled+granted, and never `unsupported`.
- **AC-008** The editor renders the rule-type selector with `Query parameters` and, after selection, renders param rows; field-level validation blocks save on invalid params (empty name/value, duplicate name, missing params).
- **AC-009** Editor round-trip: create a query rule, save, reload, the rule's `action` is preserved verbatim in `.rogatio.json`.
- **AC-010** Bounds are enforced: exceeding `maxQueryParamsPerRule`, `maxQueryNameLength`, or `maxQueryValueLength` produces a stable validation diagnostic.
- **AC-011** The DNR condition honors `method` (when set) by including `requestMethods`, and derives `requestDomains`/`initiatorDomains` from `origins`.
- **AC-012** No production code contacts the network during F10 build/test/verify; query transformation is local DNR/browser behavior.

## 6. API, CLI, UI, file-format, compatibility changes

- File format (`.rogatio.json` v1): adds `action` to each rule. Projects saved by F7 without `action` become invalid under F10 and must be updated to carry an `action`; this is a version-1 schema evolution documented in the migration note below.
- Editor UI: adds a `Rule type` selector and query param sub-form.
- Extension: new DNR rule construction path for `query`.
- No new CLI commands.

## 7. Security, privacy, performance, accessibility, operational

- Security/privacy: query transformation is a local browser DNR transform; no upstream contact, no credentials added, no traffic history. Param values are stored only in `.rogatio.json`.
- Performance: DNR transform is browser-native and bounded by `maxQueryParamsPerRule`.
- Accessibility: the new selector and param form MUST follow the editor's existing keyboard/screen-reader/forced-colors/200% zoom support (F5).
- Operational: extension install uses the existing atomic install/rollback; a query rule failing install rolls back like any other.

## 8. Migration, rollout, backward-compatibility

- F7-created projects without `action` are invalid under F10. Because the project is pre-1.0 and schema is at version 1, F10 adds `action` as required. The editor will prompt to choose a rule type when opening an actionless rule. No automatic migration of rule semantics is performed; the user selects the type. (No scheme-version bump; documents v1 evolution.)
- Rollout: F10 is a single vertical slice shipped on its branch; the extension shell already handles actionless rules as `unsupported`, so adding `query` only widens installable rules.

## 9. Open questions / assumptions

- Assumed: `MatcherOperation` is renamed `RuleOperation` (`kind: "rule"`) as the durable carrier of `matcher`+`action`; this is the foundation F9/F11/F13 extend. If reviewers prefer keeping the name `MatcherOperation`, the same fields apply under the existing name.
- Assumed DNR default `replaceOnly: false` gives add-or-replace semantics matching REQ-003.
- Assumed extension validation uses `requestDomains`/`initiatorDomains` derived from origin hostnames (scheme stripped); confirmed against existing F7 origin handling.
- Open: should the rule-type selector allow "delete this rule's action"? Out of scope; user can change type to a registered one.
