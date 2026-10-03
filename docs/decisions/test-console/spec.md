# Test console — specification

> Audience: hybrid
> Status: draft for review with the implementation (issue #278)
> Issue: [#278](https://github.com/drmaas/rogatio/issues/278)

## 1. Problem and goals

The Test console is on the editor route rail in both `rogatio edit` and the extension management page. In the extension, Run test cannot run. In the CLI editor, it runs a weaker check than `rogatio test`, and a failed run can break the page. The result list is written for the matcher engine, so a person cannot tell what the browser would do.

**Goals**

- Extension Run test returns a result for the current draft.
- The editor shows the same action preview `rogatio test` prints for redirect, query, header, and replace-mode body rules.
- A default case is a page load (GET, `main_frame`), so a POST-only rule does not report a match.
- An invalid draft lists field diagnostics and focuses the first one. The editor keeps rendering.
- A result names the group and the rule, opens that rule, and keeps misses collapsed.
- One Run test control. A disabled extension group is labeled as off.

## 2. Scope and non-goals

### In scope

- A `dry-run` command on the extension protocol, handled beside the service worker compile path. The management page passes `dryRun` into `createEditor`.
- `POST /api/dry-run` passes compiled operations and the same `previewAction` `rogatio test` uses. The editor page treats a non-2xx body as a failure.
- Test console copy, defaults, and result rendering in `@rogatio/editor`.
- Docs: quick start, dry-run guide, and the architecture editor section (plus the architecture dry-run section where it describes this path).

### Non-goals

- Live traffic and match history (#204).
- Saving test cases.
- Changing the `rogatio test --json` shape. The human CLI report stays as it is. Sharing the preview helper is allowed so the editor and `rogatio test` cannot disagree; the JSON keys are not changed.
- Per-line method or resource type in the textarea.
- Importing `@rogatio/dry-run` or Ajv into `@rogatio/editor` or the management page bundle. `browser-schema` stays the page-side validator.

## 3. Package boundary

```
schema → compiler → dry-run → { cli, extension service worker }
schema → compiler → editor
```

`@rogatio/editor` stays free of `@rogatio/dry-run` and Ajv. Hosts keep supplying `EditorDryRunHandler`.

The extension package may depend on `@rogatio/dry-run`. Only the service worker bundle imports it, and that bundle aliases the package to its source so the schema alias remains `browser-schema` (no Ajv). The management page and the popup do not import it.

`browser-schema` re-exports `matchUrlCaptures` and `substituteUrlCaptures` from the schema capture module (no Ajv) so the service worker preview can expand `$1`–`$9` the same way the CLI does.

## 4. Extension command

`{ version: 1, command: "dry-run", project, cases, options? }`

The service worker validates the draft with `browser-schema`, compiles it, and calls `dryRunProject` with the compiled operations and `previewRuleAction`. It does not read storage, install rules, or contact the network.

- Success: `{ ok: true, value: DryRunResult }`.
- Schema or compiler failure: `{ ok: false, diagnostics }` where each diagnostic is `{ code, severity: "error", path, message }`, the same field shape Validate already returns on the page. A single extension diagnostic stays on the envelope so older readers still see a failure.
- A payload that is not a project plus a cases array: `extension.invalid-message`.

The management page `dryRun` adapter sends the current draft and the cases and returns either the `DryRunResult` or `{ ok: false, diagnostics }`.

## 5. CLI editor

`POST /api/dry-run` still requires the CSRF token and the body `{ project, cases, options? }`.

- Invalid project: `400` with `{ code, message, diagnostics }`. This body is not a `DryRunResult`.
- Success: `200` with a `DryRunResult`. `dryRunProject` receives `compileResult.operations` (not matcher-only copies) and `previewRuleAction`, the same function `rogatio test` passes. A client `options.previewAction` is ignored because JSON cannot carry a function. `options.maxCases` is honored when it is a positive integer.
- The editor page checks the status. A non-2xx body becomes `{ ok: false, diagnostics }` mapped like Validate. It is not returned as the test result.

`previewRuleAction` lives in `@rogatio/dry-run` and is what both `rogatio test` and this route pass as `previewAction`. The human CLI lines (`actionPreview: kind - summary`) are unchanged. `--json` is unchanged.

## 6. Editor behavior and copy

The handler may return a `DryRunResult` or `{ ok: false, diagnostics }`. A body that has `diagnostics` and no `summary` is a failure. The editor does not store a failure as `testResult`. It lists the diagnostics, focuses the first field (same jump Validate uses), and sets a validation status. The status is not a TypeError. A later render still works.

### Form

- Opening copy: "Check whether these URLs match your rules. Nothing is contacted, and nothing is saved."
- One URL per line. No per-line method or resource type, and no "without explicit values" legend.
- Default case: GET and a page load (`main_frame`). The form says "Checking these as page loads (GET)." If the person changes the selects, the sentence updates so it stays true.
- Resource types use plain names. Schema values stay on the option value.

| Value | Label |
| --- | --- |
| `main_frame` | Page |
| `sub_frame` | Frame |
| `stylesheet` | Stylesheet |
| `script` | Script |
| `image` | Image |
| `font` | Font |
| `object` | Plugin |
| `media` | Media |
| `xmlhttprequest` | Fetch |
| `ping` | Ping |
| `csp_report` | CSP report |
| `websocket` | WebSocket |
| `webtransport` | WebTransport |
| `webbundle` | Web Bundle |
| `other` | Other |

- "Any method" and "Any resource type" are explicit options. They are not the default. A match under that choice adds "The method was not tested." and/or "The resource type was not tested."
- One Run test control, on the panel. The command bar and the bottom ledger do not repeat it. Project actions still repeat under the results.
- The 256-case cap stays. The "Max test cases" field is removed. The cap is mentioned only when the list is too long: "Only 256 URLs can be checked at once."
- When a rule source is an exact URL pattern (`urlToExactRegex` round-trip), the console offers "Try a URL from this rule". The visible label is that sentence. When several rules qualify, the accessible name includes the rule name. Choosing one fills the box with that URL.

### Results

One sentence per matching rule, including the URL:

> https://example.com/old matches Redirect in Ads / Old path. The browser would go to https://example.com/new.

The rule name is a button that opens that rule. The type name comes from the draft (`Redirect`, `Query parameters`, `Header`, `Response body`, `Request body`). A rule with no type reads "the rule".

The second sentence is the preview summary `rogatio test` prints:

| Preview kind | Sentence |
| --- | --- |
| `redirect` | The browser would go to {summary}. |
| `query` | The query would be {summary}. |
| `header` | The header would be {summary}. |
| `request-body` | The request body would be {summary}. |
| `response-body` | The response body would be {summary}. |

Matching rules only are in that list. The rest sit in a closed disclosure: "3 rules did not match" (or "1 rule did not match"). Each row is the rule name plus one reason, the first unmatched dimension in this order: "URL pattern", "method", "resource type". The rule name opens that rule.

When the host supplies `groupEnablement` and the group's saved id is not enabled, a match still shows, with "This group is off in Chrome, so the browser will not apply this rule." The CLI editor does not supply the port, so it does not show that sentence.

A bad line is named by its text and its 1-based textarea line: "Line 3 is not an http(s) URL: ftp://files".

No rules: "This project has no rules to test."

## 7. Acceptance criteria

- **AC-001** Extension Run test returns results for the current draft.
- **AC-002** A redirect, query, header, or replace-mode body rule shows the resulting value, the same preview `rogatio test` prints.
- **AC-003** A POST-only rule does not report a match for the default page-load case.
- **AC-004** An invalid draft shows field diagnostics. The editor keeps rendering.
- **AC-005** A result names the group and the rule, and opens that rule.
- **AC-006** Non-matching rules stay collapsed.
- **AC-007** The page has one Run test control.
- **AC-008** A disabled extension group is labeled as off.
- **AC-009** The quick start, the dry-run guide, and the architecture editor section match the new copy and behavior.

## 8. Security and privacy

The console does not contact the tested URL, write the cases, change installed rules, or start the runtime. The extension command evaluates the draft in memory. The CLI route stays CSRF-protected and loopback-only. Failure bodies are field diagnostics, not thrown engine objects.
