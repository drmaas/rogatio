# Requestly import — specification

> Audience: hybrid
> Status: draft for review with the implementation (issue #262)
> Issue: [#262](https://github.com/drmaas/rogatio/issues/262)

## 1. Problem and goals

Rogatio's rule model already follows Requestly (source condition, redirect, query, headers, request body, response body). There is no migration path: an author with an existing Requestly export has to recreate every rule by hand.

**Goals**

- Add `rogatio import requestly <export.json>` that writes a version-2 `.rogatio.json`.
- Map every Requestly rule kind Rogatio can represent, and list every rule that is skipped or changed.
- Validate the mapped project with the schema and the compiler (the same checks as `rogatio verify`) before writing.
- Keep the mapping pure and reusable, outside CLI file I/O, so a later editor import can call it.
- Never overwrite an existing project file unless `--merge` is set.

## 2. Scope and non-goals

### In scope

- A new private package `@rogatio/requestly-import` that depends only on `@rogatio/schema`.
- CLI command `rogatio import requestly`, help text, and docs (README, architecture, overview, docs site).
- Fixture tests for each supported Requestly rule type, a mixed export, skip reasons, merge, and refusal to overwrite.

### Non-goals

- An editor or extension "Import project" button. The package is the reuse seam; the UI is a follow-up.
- Importing Requestly session recordings, mocks-as-files, shared-list metadata, or API-client collections.
- New Rogatio rule types (cancel, delay, script injection, response status mocking).
- Operators other than `regex` on the Rogatio source condition. Requestly operators are lowered to regex.
- Evaluating Requestly dynamic functions (`rq_rand`, `rq_request_initiator_origin`, and the rest) at import time.

## 3. Actors and entry points

| Actor | Entry |
| --- | --- |
| Project author | `rogatio import requestly <export.json> [--out <path>] [--merge] [--json]` |
| Later editor host | `importRequestlyExport(value)` and `mergeProjects(existing, imported)` |

The default `--out` path is `.rogatio.json` in the current working directory, the same default as `edit` and `verify`.

## 4. Requestly export format

The mapping accepts the download shape produced by Requestly's rule export (`prepareContentToExport` in the open-source interceptor app): a JSON array of storage records. Rules and groups are siblings. Groups are records with `objectType: "group"`. On download, group `children` is an empty array and each rule points at its group with `groupId`.

Also accepted, because they show up in shared-list payloads and hand-built files:

- A single rule object (`objectType: "rule"` or a string `ruleType`).
- An object `{ rules: [...], groups?: [...], updatedGroups?: [...] }`.
- Group `children` arrays of rule objects, used when `children` is non-empty. A rule id that already appeared at the top level is not imported twice.

The field names below are taken from `requestly/interceptor` `shared/src/types/entities/rules/rule.ts`, `common/constants.js`, and `common/rule-processor`.

### Format assumptions

These are the assumptions the importer relies on. They are stated so a future Requestly change is visible in review.

1. **Matches** values use `/pattern/flags`, where flags are empty, `i`, `g`, `ig`, or `gi` (`regexFormat` in `common/utils.js`). Any other spelling does not match in Requestly and is skipped here.
2. **Wildcard** `*` is a full-string match. `?` is a literal character. `*` becomes a non-greedy `(.*?)` capture. That follows Requestly's left-to-right `indexOf` split, and it can differ when a later literal occurs more than once and the wildcard would need backtracking.
3. **Host** comparison uses `URL.host` (hostname plus a non-default port), not `URL.hostname`.
4. **Path** comparison uses `URL.pathname` only.
5. Resource-type filters use Chrome's names (`xmlhttprequest`, `script`, `main_frame`, and the rest of the Rogatio set).
6. Header pairs with a `modifications.Request` / `modifications.Response` object are the current shape. A pair that itself has `header` and `type` is the legacy shape (`rule.version` not greater than 1).
7. Response and request bodies are `static` or `code`. Response may also be `local_file`. There is no search-and-replace body field in this schema.
8. `extensionRules` is a generated declarativeNetRequest cache and is ignored.
9. The export has no author-controlled rule priority.
10. Redirect `destinationType` omitted means `url`.

Records that are not JSON data (cycles, accessors, symbols, sparse arrays, non-plain prototypes) are rejected before mapping. The importer does not walk inherited properties.

## 5. Mapping table

Rogatio source conditions use `operator: "regex"` only. Lowering:

| Requestly source | Rogatio source | Loss |
| --- | --- | --- |
| `key: "Url"`, `Equals` | `key: "url"`, `^` + escaped value + `$` | None |
| `key: "Url"`, `Contains` | `key: "url"`, escaped value, unanchored | None. An empty value matches every URL. |
| `key: "Url"`, `Wildcard_Matches` | `key: "url"`, `^` + wildcard regex + `$` | See assumption 2. `$1`…`$9` in a redirect destination become `\1`…`\9`. |
| `key: "Url"`, `Matches` | `key: "url"`, the pattern inside `/pattern/flags` | `i` is dropped (Rogatio regexes are case-sensitive) and reported. `g` is dropped with no behavior change. |
| `key: "host"`, `Equals`, literal hostname, no port | `key: "host"`, `^hostname$` | Requestly does not match a non-default port. Rogatio host conditions ignore the port. Reported. |
| `key: "host"`, `Equals`, `hostname:port` | `key: "url"`, `^https?://hostname:port(?:[/?#].*)?$` | Reported as a URL regex so the port stays in the match. |
| `key: "host"`, other operators | `key: "url"` regex over the authority | Reported. IPv6 host values are skipped. |
| `key: "path"` | `key: "url"` regex over the pathname, query optional | Reported. Rogatio has no path key. |

Filters on `source.filters` (object or array; every entry must match):

| Filter | Result |
| --- | --- |
| `resourceType` | Intersection of recognized types, in Rogatio's canonical order. No filter means every Rogatio resource type. An explicit empty list skips the pair. Unknown names are dropped and reported. |
| `requestMethod` | One method is stored on the rule. Several methods become one rule per method and are reported. An explicit empty list skips the pair. |
| `pageUrl`, `pageDomains`, `requestPayload` | The pair is skipped. Importing it would match more traffic than Requestly. |

Other rule fields:

| Requestly | Rogatio |
| --- | --- |
| `name` | Rule or group name, whitespace collapsed, made unique in the project. Empty becomes `Imported rule` or `Imported group`. |
| `id` | Kept when it matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`, fits the id length limit, and is unique. Otherwise derived from the name. |
| `description` | Not stored on rules. A non-empty rule description is reported. Group descriptions are not stored. |
| `status: "Inactive"` | The rule is still imported. Rogatio does not store a disabled flag in the file. Reported. An inactive group reports the same on each of its rules. |
| `groupId` / group record | One Rogatio group per Requestly group, export order. Rules with a missing or unknown `groupId` go in a group named `Ungrouped`. Empty groups are kept. |
| priority | Assigned from 1000 downward in export order, floored at 1, so an earlier rule wins. Reported once on the import, not as a per-rule change. |

### Rule types

| Requestly `ruleType` | Rogatio | Report |
| --- | --- | --- |
| `Redirect`, `destinationType` `url` or omitted, absolute http(s) destination | `type: "redirect"`. `$1`…`$9` in the destination become `\1`…`\9`. A literal `$` becomes `$$`. | **Imported** when the source lowering is exact. **Changed** when pairs are split, captures are rewritten, `preserveCookie` is set, or the source lowering is lossy. |
| `Redirect`, `map_local` or `mock_or_file_picker` | Not imported. | **Skipped**. A local file is not an absolute URL. |
| `Redirect` destination that is not an absolute http(s) URL even after capture rewrite (for example `$1://host/$2`) | Not imported. | **Skipped**. Rogatio requires the destination text itself to be an absolute http(s) URL. |
| `Replace`, literal `from` | `type: "redirect"`. See lossy-case rules. | **Changed** when a redirect is produced. |
| `Replace`, `from` written as `/pattern/flags`, or a source operator of `Matches` | Not imported. | **Skipped**. A second regular expression cannot be applied to the URL. |
| `QueryParam` `Add` with `actionWhenParamExists: "Overwrite"` | `type: "query"`, `operation: "set"`. | **Imported** when the source lowering is exact. |
| `QueryParam` `Add` without Overwrite, or with `Ignore` | `operation: "set"`. | **Changed**. Set overwrites. Requestly Add without Overwrite appends another value. Ignore leaves an existing value unchanged. |
| `QueryParam` `Remove` | `operation: "remove"`. The Requestly value is omitted. | **Imported** when that is the only loss-free change. |
| `QueryParam` `Remove All` | Not imported. | **Skipped** for that pair. Rogatio cannot clear every query parameter. |
| `Headers` `Add` | `type: "header"`, `headerOperation: "append"`. | **Imported** per modification when nothing else is lossy. Several modifications become several rules and the Requestly rule is **changed**. |
| `Headers` `Modify` | `headerOperation: "set"`. | **Changed**. Modify updates an existing header only. Set also adds it when it is absent. |
| `Headers` `Replace` (legacy type) | `headerOperation: "set"`. | **Changed**. Replace removes the header and sets it. |
| `Headers` `Remove` | `headerOperation: "remove"`. | **Imported** when nothing else is lossy. |
| Forbidden header name for that direction | That modification is not imported. | **Skipped** when every modification is forbidden. **Changed** when some modifications remain. |
| `UserAgent` | Request header `set` of `User-Agent` to `userAgent`. | **Imported** when the string is copied as-is. **Changed** when `envType` is `browser` or `device` (the stored string is used, the preset is not re-resolved) or the source lowering is lossy. |
| `Request` `static` | `type: "request-body"`, `mode: "replace"`. | **Imported** when the filter is already a single `POST`, `PUT`, or `PATCH` and `xmlhttprequest`. Otherwise **changed** or **skipped** (see lossy cases). |
| `Request` `code` | Not imported. | **Skipped**. JavaScript request functions are not supported. |
| `Response` `static` | `type: "response-body"`, `mode: "replace"`. | **Changed**. Requestly replaces the response and may skip the upstream request, and may set a status code. Rogatio fetches the upstream response and replaces the body, keeping the upstream status and headers. |
| `Response` `code` or `local_file` | Not imported. | **Skipped**. |
| `Cancel`, `Delay`, `Script` | Not imported. | **Skipped**. |
| Any other `ruleType` | Not imported. | **Skipped**. |

Pairs on one Requestly rule become separate Rogatio rules when Rogatio cannot store them together (redirect pairs, header modifications, one method per request-body rule, http and https replace rules). They stay one rule when it can (query parameters).

Dynamic functions in a copied string are kept as literal text and reported.

A `$` in a query value, header value, or body is written as `$$` so it stays a literal dollar. That is reported when a `$` was present.

### Replace lowering

Replace runs only when the source matches and `from` is a literal substring. `to` must not contain a backslash (that would be read as a capture reference). The first occurrence is replaced, matching `String.replace` with a string search.

| Source | Redirect |
| --- | --- |
| URL `Equals` an absolute http(s) URL that contains `from` | Exact URL regex. Destination is that URL with the first `from` replaced by `to`. |
| URL `Wildcard_Matches` starting with `http://` or `https://`, and `from` lying inside one literal segment | Source regex is the wildcard. Destination is the wildcard template with `from` replaced in that segment and `*` written as `\1`…`\9`. |
| URL `Contains` | Two rules, `http` and `https`: `^https://(.*?)` + escaped `from` + `(.*)$` (plus a lookahead for the contains text when it is not the same as `from`). Destination `https://\1` + `to` + `\2`, and the http twin. |
| Host `Equals` a literal hostname or `hostname:port` | Two rules, `http` and `https`, matching that authority and capturing the path, query, and fragment. `from` must sit in the fixed `scheme://authority` text. |

Any other replace shape is skipped, including a destination that does not parse as an absolute http(s) URL.

### Request-body constraints

A Rogatio request-body rule allows only `POST`, `PUT`, or `PATCH`, and only the resource type `xmlhttprequest`.

- No method filter: import one rule per `POST`, `PUT`, and `PATCH`, and report the split.
- A filter that includes other methods: import the allowed methods and report the dropped ones. If none remain, skip.
- No resource-type filter, or a filter that includes `xmlhttprequest` plus other types: import `xmlhttprequest` only and report the narrowing.
- A resource-type filter that does not include `xmlhttprequest`: skip.

## 6. Report

`importRequestlyExport` returns a project and a report. Nothing is dropped without a row.

Each Requestly rule is one row:

| Status | Meaning |
| --- | --- |
| `imported` | At least one Rogatio rule was produced and no lossy change was recorded. |
| `changed` | At least one Rogatio rule was produced, and `changes` says what differs. |
| `skipped` | No Rogatio rule was produced. `reason` says why. The Requestly name and type are kept. |

The human CLI report prints the three counts, each changed rule with its reasons, each skipped rule with its name, type, and reason, the priority note, and the path written.

`--json` prints the same report as JSON plus `outputPath`.

Exit codes:

| Code | When |
| --- | --- |
| 0 | The project verified and was written. Skipped rules do not fail the command. |
| 1 | The mapped or merged project failed schema or compiler validation. Nothing is written. |
| 2 | Usage, unreadable file, export that is not Requestly data, or refusal to overwrite. |

## 7. Writing the file

- `--out` defaults to `./.rogatio.json`.
- If that path does not exist, it is created.
- If it exists and `--merge` is absent, the command exits 2 and leaves the file untouched. There is no interactive prompt.
- `--merge` appends imported groups onto a valid version-2 project. Existing name, description, and `requestBodyPolicy` stay. Imported names and ids that collide are regenerated and listed. Group, per-group rule, and project rule limits that would be exceeded abort the merge with exit 2 and do not write.
- The mapped project is passed through schema validation and `compileProject` before any write. A failure prints diagnostics and writes nothing.
- The write is the existing atomic project write (temp file and rename).

The new project name is `Imported from Requestly`. The description is `Imported from a Requestly export.` The path is not copied into the file.

## 8. Package boundary

```
schema → requestly-import → cli
```

`@rogatio/requestly-import` performs no file, network, or compiler I/O. It does not import Ajv itself. It calls schema helpers that are also exported from the browser schema entry (`compileUrlRegex`, `validateRedirectDestination`, `isForbiddenHeader`, id and name helpers, limits, resource types). The CLI is what reads the export, runs verify, and writes the file.

The editor does not call the importer in this issue.

## 9. Acceptance criteria

- **AC-001** `rogatio import requestly <file>` writes a version-2 project that `rogatio verify` accepts.
- **AC-002** Fixtures cover Redirect, Replace, QueryParam, Headers, UserAgent, Request, and Response, plus one mixed export that also contains Cancel, Delay, and Script.
- **AC-003** The mixed export's report lists every skipped rule by Requestly name. Those rules are absent from the project.
- **AC-004** An existing `--out` file is unchanged unless `--merge` is passed. `--merge` keeps existing groups and appends imported ones.
- **AC-005** The docs site has a page titled "Migrating from Requestly". README and `rogatio --help` mention the command.
- **AC-006** `pnpm validate` passes.

## 10. Security and privacy

The importer reads a local file the user named and writes a local project file. It does not fetch URLs from the export, does not evaluate Requestly JavaScript (`code` bodies and script rules are skipped), and does not copy local-file paths into the project. Page-domain and payload filters are skipped rather than widened. Forbidden headers are not imported.

## 11. Addendum — host sources confined to the URL authority (issue #307)

Append-only correction. Do not rewrite the rows above; this section is authoritative for host non-Equals operators after #307.

Requestly compares host sources against `URL.host` only (assumption 3). Lowering those operators to a URL regex must not let the pattern cross into the path, query, fragment, or userinfo.

| Requestly source | Rogatio result | Notes |
| --- | --- | --- |
| `key: "host"`, `Wildcard_Matches` | `key: "url"` regex `^https?://` + host-only wildcard body + optional `:\d+` + `(?:[/?#].*)?$` | Each `*` becomes `([^/?#@]*?)` (same capture count as URL/path wildcards). URL and path `Wildcard_Matches` keep `(.*?)`. |
| `key: "host"`, `Contains` | `key: "url"` regex over the authority using `[^/?#@]*` | Tightened from `[^/?#]*` so `@` cannot pull userinfo into the host match. |
| `key: "host"`, `Matches` | Pair skipped | Reason: `Host regular expressions cannot be confined to the host in a URL regex.` RE2 has no lookarounds. |

Projects imported before this change from host wildcards or host regular expressions should be re-imported or reviewed.
