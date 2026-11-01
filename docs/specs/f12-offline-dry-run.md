# F12 — Offline Dry-Run / Test

**Status:** Specification (Stage 3). Awaiting human review gate approval.
**Tier:** Free (single-model session fallback — all phase passes performed by `opencode/hy3-free` with distinct role framing; Nemotron 3 Ultra Free / Hy3 Free pairing was the intended free assignment but only one model is available in this session).
**Base commit:** `acf4c2c`
**Worktree:** `feature/f12-offline-dry-run`

## 1. Problem statement and goals

Rogatio users define redirect, query, header, mock, and body rules, but today they
cannot confirm *which* rules would apply to a concrete request before saving or
installing. F12 adds an offline, read-only **dry run**: given a project and a bounded
batch of test URLs (optionally with a method and resource type), it reports, per URL and
per rule, the matcher match dimensions — URL regular expression, effective origin,
method, and resource type — and previews the resulting action where the rule carries one.

The dry run **never** contacts the tested URL, requests permission, changes installed
rules, connects a runtime, or saves test data. It is a pure local calculation over the
compiled matcher operations.

## 2. Scope

In scope:

- A pure `@rogatio/dry-run` Node ESM engine that evaluates matcher operations against a
  bounded batch of test cases and returns structured results.
- `rogatio test` CLI subcommand (offline, no browser) reading a project from a file or
  stdin and printing a human or JSON report.
- `POST /api/dry-run` endpoint in the existing `edit` server so the editor can offer
  the same capability through a host adapter.
- An editor "Test rules" route/panel in `@rogatio/editor` driven by a host-supplied
  `dryRun` adapter (mirroring the existing `validate` adapter), keeping the editor
  browser bundle free of Node F2/F3 artifacts.

Explicitly out of scope (non-goals):

- Any network access to tested URLs or to any runtime.
- Mutation of `.rogatio.json`, installed rules, permissions, or runtime state.
- Persisting or logging test inputs/outputs.
- Actual redirect destination computation or query-URL transformation **for rule action
  types that are not yet implemented in the repository** (see §6).

## 3. Actors, entry points, supported environments

- **CLI user:** `rogatio test [path] [url...]` (Node 24+, Linux/Windows/macOS).
- **Editor user:** opens the "Test rules" route in the shared visual editor; host is the
  `edit` server (`127.0.0.1`).
- **Engine consumer:** `@rogatio/cli` (both `test` and `edit` server) imports
  `@rogatio/dry-run`. The editor browser bundle does **not** import it.

## 4. Functional requirements

- **REQ-001** — The engine accepts a compiled matcher operation list
  (`readonly MatcherOperation[]` from `@rogatio/compiler`), a bounded list of test
  cases, and options, and returns a deterministic `DryRunResult`.
- **REQ-002** — Each test case is `{ url: string; method?: HttpMethod; resourceType?: ResourceType }`.
  The `url` MUST be a non-empty string. Method/resourceType are optional and, when
  omitted, the corresponding dimension is reported as not-applicable rather than
  unmatched.
- **REQ-003** — For each test case the engine computes, per rule, four match dimensions:
  - `urlRegex`: `new RegExp(matcher.urlRegex.source)` tested against the **full URL string**.
  - `effectiveOrigin`: the WHATWG `URL(url).origin` is a member of `matcher.origins`.
  - `method`: if the test case supplies a method, matched when `matcher.method` is
    `undefined` (matches any) or equal to the supplied method; if omitted, not-applicable.
  - `resourceType`: if the test case supplies a resource type, matched when
    `matcher.resourceTypes` is empty (matches any) or contains the supplied type; if
    omitted, not-applicable.
- **REQ-004** — A rule's overall `matched` is `true` only when `urlRegex` and
  `effectiveOrigin` both match AND no supplied dimension is unmatched. Not-applicable
  dimensions do not block the overall match.
- **REQ-005** — The batch size is bounded by `options.maxCases` (default **256**). When
  the supplied case count exceeds the bound, the run is rejected with a single clear
  `DryRunError` and `operations`/`results` are empty.
- **REQ-006** — Invalid input is handled defensively and never throws out of the engine:
  - A non-string, empty, or non-absolute-URL `url` yields a per-case `DryRunError`
    (`dryrun.invalid-url`) and is excluded from matching.
  - Hostile/non-JSON, proxy, accessor, or cyclic case values are rejected without
    invoking hostile getters.
- **REQ-007** — The engine performs **no** network, filesystem, permission, runtime, or
  persistence side effects. Only `URL` parsing and `RegExp` execution occur.
- **REQ-008** — The engine supports an optional `previewAction` hook
  `(operation, url, testCase) => ActionPreview | null`. When omitted (F12 default), no
  action preview is produced. This is the seam for later rule-type slices (F9/F10/F11)
  to attach real previews without changing the engine contract.
- **REQ-009** — `rogatio test` reads the project from a path argument (default
  `./.rogatio.json`), from `-` (stdin JSON), or from `--urls-file <path>`. URLs may be
  positional args or read from stdin when no positional URLs are given. Options:
  `--json`, `--method <M>` (applied to every case), `--resource-type <RT>`,
  `--max-cases <n>`.
- **REQ-010** — `rogatio test` first validates+compiles the project via
  `@rogatio/schema` + `@rogatio/compiler`; on invalid input it prints the same
  diagnostics style as `verify` and exits `1`. On IO/parse failure it exits `2`. On a
  successful dry run it exits `0` regardless of how many rules matched.
- **REQ-011** — The `edit` server exposes `POST /api/dry-run` (CSRF-protected) accepting
  `{ project, cases, options }`, compiling the project server-side and returning the
  `DryRunResult` JSON.
- **REQ-012** — The editor exposes a "Test rules" route reachable from the command bar;
  the host supplies a `dryRun` adapter (analogous to `validate`) that POSTs to
  `/api/dry-run`. The panel lets the user enter URLs (one per line) and optional
  method/resource type, run the dry run, and view per-URL / per-rule dimension results
  with overall match badges. The panel must meet the same accessibility, keyboard,
  forced-colors, and 200% zoom requirements as the rest of the editor.

## 5. Acceptance criteria

- **AC-001** — `dryRunProject` with a project containing one rule whose `urlRegex`
  matches a supplied URL, whose origin is in `matcher.origins`, and with no
  method/resourceType on the rule, returns that rule with `urlRegex.matched=true`,
  `effectiveOrigin.matched=true`, `method.matched=null`, `resourceType.matched=null`, and
  overall `matched=true`.
- **AC-002** — A URL whose origin is **not** in `matcher.origins` yields
  `effectiveOrigin.matched=false` and overall `matched=false`, even when the regex
  matches.
- **AC-003** — A URL that does not match the regex yields `urlRegex.matched=false` and
  overall `matched=false`, even when the origin matches.
- **AC-004** — When a test case supplies `method: "POST"` and the rule declares
  `method: "GET"`, `method.matched=false` and overall `matched=false`. When the rule
  declares no method, the supplied method does not block the match.
- **AC-005** — When a test case supplies `resourceType: "image"` and the rule declares
  `resourceTypes: ["script"]`, `resourceType.matched=false`. When the rule declares an
  empty `resourceTypes`, any supplied resource type matches.
- **AC-006** — Supplying more than `maxCases` test cases returns a single
  `dryrun.batch-limit` error and empty results; supplying exactly `maxCases` succeeds.
- **AC-007** — A non-string URL, an empty string, or a non-absolute URL (e.g.
  `example.com` with no scheme) produces a per-case `dryrun.invalid-url` error and is
  excluded from rule matching; other valid cases still evaluate.
- **AC-008** — A cyclic or proxy/accessor case value is rejected (no throw escapes the
  engine; no hostile getter is invoked).
- **AC-009** — `rogatio test` on an invalid project exits `1` with diagnostics; on a
  missing/unreadable file exits `2`; on a valid run exits `0` (including when zero rules
  match). `--json` emits the structured `DryRunResult`.
- **AC-010** — `rogatio test --method POST --resource-type image <url>` applies the
  method/resourceType to every case.
- **AC-011** — `POST /api/dry-run` with valid input returns a `DryRunResult`; with an
  invalid CSRF token returns `403`; with invalid JSON returns `400`.
- **AC-012** — The editor "Test rules" route renders results for a multi-URL batch and
  is fully operable by keyboard, screen reader, and at 200% zoom in forced-colors mode.
- **AC-013** — No test execution path performs any network request, file write,
  permission change, or runtime connection (verified by an integration test that stubs
  and asserts absence of such calls, plus a lint/review check).

## 6. Action-preview scope decision (resolved at gate: Option A)

The product overview promises the dry run "previews redirect destinations and resulting
query URLs." Redirect (F9) and query-parameter (F10) **action schemas and compiler
operations do not exist in this repository yet**; F12's declared dependencies are only
F2, F3, F5, F8. The current `@rogatio/compiler` emits matcher-only operations with no
action payload, so there is nothing for F12 to preview today.

**Gate decision (2026-08-23): Option A approved.** F12 ships the full matcher-level dry
run plus the `previewAction` extension seam (REQ-008). Redirect/query *previews* are
implemented by F9/F10 when they define their action operations and pass a preview
function into the engine. This keeps F12 strictly within its declared dependencies.
F12 does not implement or assume any action payload on `MatcherOperation`.

## 7. API / data contracts

```ts
// @rogatio/dry-run
import type { HttpMethod, ResourceType } from "@rogatio/schema";
import type { MatcherOperation } from "@rogatio/compiler";

export interface DryRunTestCase {
  url: string;
  method?: HttpMethod;
  resourceType?: ResourceType;
}

export type MatchState = "matched" | "unmatched" | "not-applicable";

export interface MatchDimension {
  state: MatchState;
  detail: string;
}

export interface ActionPreview {
  kind: string;
  summary: string;
}

export interface RuleMatchResult {
  groupId: string;
  ruleId: string;
  matched: boolean;
  urlRegex: MatchDimension;
  effectiveOrigin: MatchDimension;
  method: MatchDimension;
  resourceType: MatchDimension;
  actionPreview: ActionPreview | null;
}

export interface UrlDryRunResult {
  url: string;
  rules: RuleMatchResult[];
  matchedRuleCount: number;
}

export interface DryRunError {
  code: "dryrun.invalid-url" | "dryrun.batch-limit" | "dryrun.invalid-case";
  message: string;
  index?: number;
}

export interface DryRunResult {
  results: UrlDryRunResult[];
  errors: DryRunError[];
  summary: {
    caseCount: number;
    urlCount: number;
    matchedUrlCount: number;
    matchedRuleTotal: number;
  };
}

export interface DryRunOptions {
  maxCases?: number; // default 256
  previewAction?: (
    operation: MatcherOperation,
    url: string,
    testCase: DryRunTestCase,
  ) => ActionPreview | null;
}

export function dryRunProject(
  operations: readonly MatcherOperation[],
  cases: readonly DryRunTestCase[],
  options?: DryRunOptions,
): DryRunResult;
```

## 8. Security, privacy, performance, accessibility, operational

- **Security/privacy:** No network, filesystem, permission, or runtime side effects.
  All input is treated as untrusted; URL parsing and regex compilation failures are
  contained per-case. No URLs, credentials, headers, or bodies are logged or persisted.
- **Performance:** Pure in-memory computation over compiled operations; regex compiled
  once per operation per run (cache by `urlRegex.source`). Bounded case count prevents
  runaway input. No `fetch`, no DNR installation.
- **Accessibility:** Editor test panel meets the same keyboard / screen-reader /
  forced-colors / 200% zoom contract as F5 (REQ-012).
- **Operational:** `rogatio test` is scriptable via `--json` and stable exit codes.

## 9. Migration, rollout, backward compatibility

No schema, file-format, or public-API change to `.rogatio.json`. New package
`@rogatio/dry-run` is additive. CLI gains a new subcommand; editor gains a new route.
No migration required.

## 10. Open questions and assumptions

- **OQ-2:** Default `maxCases=256` — acceptable bound? (Adjustable via option; gate
  accepted the default.)
- **Assumption:** A rule with empty `resourceTypes` matches all resource types, and a
  rule with no `method` matches all methods, mirroring browser/DNR semantics.
- **Assumption:** The dry run tests the regex against the full URL string as provided,
  consistent with how Requestly-style URL regexes are authored.
