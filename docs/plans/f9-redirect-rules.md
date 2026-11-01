# F9 Implementation Plan — Redirect Rules

Vertical slice across schema → compiler → editor → extension. Worktree:
`feature/f9-redirect-rules`.

## Step 1 — schema package
- `types.ts`: add `RuleType = "redirect"`, `RedirectAction { destination: string }`; extend
  `RogatioRule` with optional `type?`, `redirect?`.
- `limits.ts`: add `maxRedirectDestinationLength: 2048`, `maxCaptureGroups: 9`.
- `schema.ts`: `$defs.rule` gains `type` (enum) + `redirect` (object requiring `destination`,
  `additionalProperties:false`); `if/then` requires `redirect` when `type === "redirect"`.
- `validation.ts`: `semanticIssues` adds redirect destination checks (absolute http(s) URL, no
  creds, `\1`..`\9` backrefs ≤ capture-group count of `urlRegex`, length ≤ limit). Add a reusable
  `validateRedirectDestination(destination, urlRegex)` helper (also reused by editor + extension).
- `index.ts`: export helper if needed.

## Step 2 — compiler package
- `types.ts`: add `RedirectOperation`, `RogatioOperation = MatcherOperation | RedirectOperation`;
  `CompileResult.operations: readonly RogatioOperation[]`.
- `compile.ts`: `compileOperations` emits `RedirectOperation` when `rule.type === "redirect"`.
- `index.ts`: export new types.

## Step 3 — browser-core package
- `types.ts`: `RuleInstallerAdapter.current(): Promise<readonly RogatioOperation[]>`; related types
  widen `MatcherOperation[]` → `RogatioOperation[]` where only groupId/ruleId/matcher are used.
- `status.ts`, `install.ts`: accept `RogatioOperation[]` (mechanical type widen; logic unchanged).

## Step 4 — editor package
- `editor.ts`: when `ruleTypes` provided, render rule-type `<select>` bound to `type`; on change set
  `type` and clear incompatible action fields (e.g. delete `redirect` when leaving redirect). Add
  `type` to editable common-field handling.
- NEW `rule-types/redirect.ts`: `createRedirectRuleType()` — `matches(rule)=>rule.type==="redirect"`;
  `mount` renders absolute-URL input bound to `redirect.destination` via `getField`/`setField`/
  `registerControl`; `validate` reuses the schema `validateRedirectDestination` helper.
- `index.ts`: export `createRedirectRuleType`.

## Step 5 — extension package
- NEW `dnr.ts`: `translateRedirectToDnr(op, id)` → DNR `Rule` (action `redirect`, `regexFilter`,
  `resourceTypes`, `initiatorDomains` from origin hostnames); `createDnrInstaller(api)` implements
  `RuleInstallerAdapter` using `api.declarativeNetRequest.updateDynamicRules` / `getDynamicRules`.
- `chrome.ts`: add `declarativeNetRequest` to `ChromeApi` (getDynamicRules, updateDynamicRules).
- `background.ts`: replace stub `installer` with `createDnrInstaller(api)`.
- `service-worker.ts`: `operationStatuses` keeps redirect ops `"active"` when installed; actionless
  matcher `"active"`→`"unsupported"`; installed ids from `installer.current()`.
- `browser-schema.ts`: extend `RULE_KEYS` to allow `type`+`redirect`; mirror redirect destination
  validation (`validateRedirectDestination`).
- `extension-page.ts` + CLI editor host: register `createRedirectRuleType()`.

## Step 6 — tests (tests-first ordering)
- `schema/test/schema.test.ts`: redirect valid/invalid cases.
- `compiler/test/compiler.test.ts`: RedirectOperation emission.
- `extension/test/dnr.test.ts` (NEW): translateRedirectToDnr + installer payload (mock DNR).
- `editor/test/editor.test.ts` or new: `createRedirectRuleType().validate` + matches.
- `extension/test/service-worker.test.ts`: status mapping.

## Step 7 — validation
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm format:check`, `pnpm test:browser`.

## Step 8 — docs
- `docs/architecture.md` update (RogatioOperation union, DNR installer, status mapping).
