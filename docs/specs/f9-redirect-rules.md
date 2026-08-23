# F9 — Redirect Rules

## Scope

F9 adds the first **action-bearing** rule type to Rogatio: **redirect**. A redirect rule rewrites a matching request URL to an absolute destination, with controlled capture-group substitution pulled from the rule's `urlRegex`.

F9 is a vertical slice spanning all layers:

```
schema (type + redirect payload)
  -> compiler (RedirectOperation)
    -> editor UI (rule-type selector + redirect extension)
      -> extension (DNR redirect install + status)
```

This slice unblocks the later F10/F11 action types (modify-headers, block) by establishing the
`RogatioOperation` union and the extension DNR installer path that they will reuse.

## Dependencies

- **F7 (extension shell)** — required. F9 implements the real `RuleInstallerAdapter` that F7
  deferred (the stub returns `[]` / `{ok:true}`). F9 is the first vertical slice to actually
  install rules into the browser via `declarativeNetRequest`.
- **F5 (editor)** — required. F9 adds the rule-type selector and the redirect `RuleTypeFieldExtension`.

## Out of scope

- Header-modify (F11) and block (F10) action types. The `RogatioRule.type` field is an enum
  extended later; F9 defines only `"redirect"`.
- Proxy/needs-proxy status path (future).
- `data:`-scheme redirects (Chrome DNR allows them; F9 restricts to `http`/`https` for a
  controlled contract).

## Data model

### `RogatioRule` extension (packages/schema/src/types.ts)

```ts
export type RuleType = "redirect";

export interface RedirectAction {
  /** Absolute http(s) URL. May contain \1..\9 backreferences to urlRegex capture groups. */
  destination: string;
}

export interface RogatioRule {
  id: string;
  name: string;
  urlRegex: string;
  origins: readonly string[];
  resourceTypes: readonly ResourceTypeName[];
  priority: number;
  method?: HttpMethod;

  /** Action selector. Absent => actionless (still valid, surfaced as "unsupported" in F7/F9). */
  type?: RuleType;

  /** Required iff type === "redirect". */
  redirect?: RedirectAction;
}
```

Backward compatibility: existing rules without `type` remain valid schema-wise. They compile to
`MatcherOperation` (actionless) and are surfaced as `"unsupported"` in the extension UI
(this is the F7 contract).

## Redirect destination contract

`redirect.destination` MUST satisfy **all** of:

1. **Absolute URL** — `new URL(destination)` succeeds, scheme is `http` or `https`, no
   `username`/`password`, and the host is a valid non-empty origin host (reuse `isSiteOrigin`
   semantics for the host portion).
2. **Capture backreferences** — any `\1`..`\9` (single backslash, digit 1–9) in the destination
   references a capture group of the rule's `urlRegex`. Each referenced index MUST be `<=`
   the number of capturing groups in `urlRegex` (computed by a helper that excludes
   non-capturing `(?:...)`, `(?<name>...)`, and lookahead/lookbehind groups).
3. **Length** — `destination.length <= LIMITS.maxRedirectDestinationLength`.
4. **Scheme stability** — the destination's literal scheme is `http`/`https`. (Per-request
   substituted URLs inherit the same scheme authority; we do not permit `javascript:`/etc.)

Backreference syntax is **`\N`** (1–9) to match Chrome DNR's native `regexFilter` substitution
semantics. The editor validates and documents this; the compiler does not rewrite it.

## Limits (packages/schema/src/limits.ts)

Add:

```ts
maxRedirectDestinationLength: 2048,
maxCaptureGroups: 9,
```

## Schema validation (packages/schema/src/schema.ts + validation.ts)

- Extend `rule` `$defs` with `type` (`enum: ["redirect"]`) and `redirect` (object requiring
  `destination`), both `additionalProperties:false`.
- Add AJV `if/then` so `redirect` is **required** when `type === "redirect"`.
- Destination string shape (contract points 1/3/4) is cross-field (needs `urlRegex` group count),
  so it is validated in `semanticIssues(project)` (packages/schema/src/validation.ts), emitting
  issues at path `${rulePath}/redirect/destination`. Mirrored in
  `packages/extension/src/browser-schema.ts` (which has its own `validateProjectDetailed` + must
  extend `RULE_KEYS` to allow `type` and `redirect`).

## Compiler (packages/compiler/src)

`types.ts`:

```ts
export interface RedirectOperation {
  kind: "redirect";
  groupId: string;
  ruleId: string;
  matcher: NormalizedMatcher;
  redirect: { destination: string };
}

export type RogatioOperation = MatcherOperation | RedirectOperation;
```

- `CompileResult.operations: readonly RogatioOperation[]`.
- `compileOperations` emits `RedirectOperation` when `rule.type === "redirect"`, else
  `MatcherOperation`.
- `browser-core` (`status.ts`, `install.ts`, `types.ts`) switches `MatcherOperation[]` usages to
  `RogatioOperation[]` where only `groupId`/`ruleId`/`matcher` are consumed (safe for the union).
  `RuleInstallerAdapter.current()` return type widens to `RogatioOperation`.

## Extension DNR (packages/extension/src/dnr.ts — NEW)

- `translateRedirectToDnr(operation: RedirectOperation, id: number): DnrRule` producing:

  ```ts
  {
    id,
    priority: operation.matcher.priority,
    action: { type: "redirect", redirect: { url: operation.redirect.destination } },
    condition: {
      regexFilter: operation.matcher.urlRegex.source,
      resourceTypes: operation.matcher.resourceTypes,
      initiatorDomains: hostnamesFromOrigins(operation.matcher.origins),
    },
  }
  ```

  Chrome DNR constraint: `regexFilter` is a full-match RE2 filter against the request URL;
  `\1`..`\9` in `url` substitute capture groups from `regexFilter`. Hostnames derived from
  `origins` become `initiatorDomains`.

- `createDnrInstaller(api: ChromeApi): RuleInstallerAdapter` — `current()` reads currently
  installed DNR rule ids (mapped back to rule ids), `install(operations)` calls
  `api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules })` translating each
  `RedirectOperation` via `translateRedirectToDnr`. Add `declarativeNetRequest` to `ChromeApi`
  (packages/extension/src/chrome.ts) with `getDynamicRules` / `updateDynamicRules`.

- Wire in `packages/extension/src/background.ts`, replacing the F7 stub installer.

## Status (packages/extension/src/service-worker.ts)

- `operationStatuses(operations, enabledGroupIds, grantedOrigins)`:
  - `RedirectOperation` that is enabled + granted + **installed** → `"active"`.
  - `MatcherOperation` (actionless) that would be `"active"` → `"unsupported"` (F7 contract).
  - Installed ids MUST come from `installer.current()` (real installed rule ids), not
    `operations.map(op => op.ruleId)`. `projectState` will fetch installed ids via the installer.

## Editor (packages/editor/src)

- `editor.ts`: when `ruleTypes` is provided, render a **rule-type `<select>`** bound to `type`.
  Changing selection sets `type` and clears incompatible action fields (e.g. switching away from
  `redirect` deletes `redirect`). `type` becomes an editable common field (handled like `method`).
- NEW `packages/editor/src/rule-types/redirect.ts` exporting `createRedirectRuleType()`:
  - `id: "redirect"`, `label: "Redirect"`.
  - `matches(rule)`: `rule.type === "redirect"`.
  - `mount(context)`: builds a labeled absolute-URL input bound to `redirect.destination`
    (`getField`/`setField`/`registerControl`); validates on input.
  - `validate(rule, rulePath)`: reuses the same destination contract (absolute http(s) + backref
    count vs `urlRegex` group count) → `EditorDiagnostic[]`.
  - Export from editor `index.ts`.
- Register `createRedirectRuleType()` in the CLI editor host AND the extension page.

## Tests (tests-first, per package)

1. `schema` — valid redirect rule; missing `redirect` when `type==="redirect"`; invalid
   (non-URL, `ftp:` scheme, creds, backref `\3` when only 2 groups, over-length).
2. `compiler` — `RedirectOperation` emitted for redirect rule; `MatcherOperation` for untyped.
3. `extension` — `translateRedirectToDnr` maps destination/regexFilter/resourceTypes/initiatorDomains;
   `createDnrInstaller` builds correct `updateDynamicRules` payload (mock `declarativeNetRequest`).
4. `editor` — `createRedirectRuleType().validate` rejects bad destinations; `matches` correct.
5. `service-worker` — redirect op enabled+installed → `"active"`; actionless matcher → `"unsupported"`.
6. (Optional) Playwright: user adds a redirect rule in the editor and saves a valid project.

## Docs

- `docs/specs/f9-redirect-rules.md` (this file).
- `docs/plans/fitness-redirect-rules.md`? → `docs/plans/f9-redirect-rules.md`.
- `docs/f9-workflow.md` workflow log.
- Update `docs/architecture.md`: `RogatioOperation` union, DNR installer path, status mapping.
- `README.md` / `AGENTS.md` only if usage surface changes.

## Acceptance criteria

- A project containing a `type:"redirect"` rule with a valid absolute destination and valid
  backreferences compiles, passes validation, is installable via DNR in the extension, and shows
  `"active"` status.
- Actionless (untyped) rules remain valid and show `"unsupported"`.
- All canonical validation passes: `pnpm test`, `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, `pnpm test:browser`.
