# Test console — plan

> Audience: hybrid
> Status: draft for review with the implementation (issue #278)
> Issue: [#278](https://github.com/drmaas/rogatio/issues/278)
> Spec: `docs/decisions/test-console/spec.md`

## Approach

Keep the dry-run engine and the `EditorDryRunHandler` port. Fix the two hosts that were dropping the preview, and change the editor's rendering so a person can read the result.

Rejected alternatives:

- Importing `@rogatio/dry-run` into `@rogatio/editor`. The editor bundle must stay free of that package and of Ajv. Hosts already supply the handler.
- Running the dry-run inside the management page. That page validates with `browser-schema` and must not gain Ajv. The service worker already compiles projects.
- Changing `rogatio test --json` so the editor can share a rendered sentence. The console can format the existing `actionPreview` locally.

## Shared preview

Move the CLI `previewAction` function to `previewRuleAction` in `@rogatio/dry-run`. `rogatio test` and `POST /api/dry-run` both pass it. The extension service worker passes it too. Human CLI lines and `--json` stay as they are.

`browser-schema` re-exports the capture helpers the preview needs. Those helpers do not import Ajv.

## Extension

- Add `dry-run` to the protocol command set.
- `runExtensionDryRun` in the extension validates with `browser-schema`, compiles, and calls `dryRunProject`.
- `createExtensionApplication` handles the command and returns a `DryRunResult` or field diagnostics.
- The management page passes `dryRun` into `createEditor`.
- `@rogatio/extension` depends on `@rogatio/dry-run`. The background esbuild target aliases that package to its source. The page and popup bundles do not.
- `scripts/validate.ts` expects the fifth workspace dependency.

## CLI

- `POST /api/dry-run` stops calling `toMatcherOperations` and passes `previewRuleAction`.
- The editor page script checks `res.ok` and returns `{ ok: false, diagnostics }` on failure.

## Editor

- `EditorDryRunHandler` may return a `DryRunResult` or `{ ok: false, diagnostics }`.
- Defaults are GET and `main_frame`. Plain resource-type names. "Any method" and "Any resource type" stay available.
- One Run test button. Remove the command-bar and ledger copies, and the max-cases field.
- Results are sentences, a closed disclosure for misses, rule-name buttons, the disabled-group sentence when `groupEnablement` says the group is off, and line-numbered URL errors.
- A failure assigns diagnostics and navigates to the first path. It does not assign `testResult`.

## Tests

- CLI route: operations and `previewAction` show up as an action preview; a non-2xx validation body is not a `DryRunResult`.
- Extension: the `dry-run` command returns a preview for a draft and diagnostics for an invalid draft.
- Editor: the default case sent to the handler is GET / `main_frame`; a thrown or diagnostic failure still renders; misses are inside a closed disclosure; one Run test control; the off-group sentence.
- Browser: one Run test control, collapsed non-matching rules, rule-name navigation, and the disabled-group label.

## Docs

Update the quick start, the dry-run guide, and the architecture editor section to the new copy. Update the architecture dry-run section where it still says the route reduces operations to matchers and the panel renders dimension badges.

## Verification

`pnpm validate` is the completion check. It is the same sequence CI runs.

## Judgment calls

- Preview sentences for query, header, and body name the summary string in a short clause. Redirect uses the issue's "The browser would go to …".
- "Try a URL from this rule" is on the test console, once per exact URL source, not on the rule card.
- The checking sentence is the issue's default copy, and it changes when the selects change.
- A miss reason is the first of URL pattern, method, then resource type.
- The off-group sentence uses the existing `groupEnablement` port, so the CLI does not show it.
- The 256 cap is an editor constant matching the dry-run default. Over-long lists are refused with "Only 256 URLs can be checked at once."
