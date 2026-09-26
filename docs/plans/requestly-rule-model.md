# Requestly rule model — implementation plan

> Audience: hybrid
> Status: written 2026-09-25 (Stage 5)
> Issue: [#219](https://github.com/drmaas/rogatio/issues/219)
> Spec: [spec.md](spec.md) (approved 2026-09-25, append-only)

Execute this plan in the worktree
`/home/drmaas/Projects/github/drmaas/temp/rogatio-requestly-rule-model`
on branch `feature/requestly-rule-model`.

A **source condition** is the rule object `source: { key, operator, value }`.
It is the only statement of what a rule matches.
`key` is `"url"` or `"host"`.
`operator` is the constant `"regex"`.

## When to use

Use this plan to implement the approved spec.
Write tests before production code for each task (TDD).
A new test may fail first.
It must pass after that task's code lands.

## When not to use

Do not add operators `equals`, `contains`, or `wildcard`.
Do not add `filters.pageDomain`.
Do not nest `method` or `resourceTypes` under `filters`.
Do not deduce hosts from a URL regex to widen permissions, DNR, or PAC.
Do not switch `declarativeNetRequest` to `declarativeNetRequestWithHostAccess`.
Do not drop the per-rule dispatch marker.
Do not rewrite `requestBodyPolicy.localOrigins`.
Do not change native-messaging host `allowed_origins` in `packages/cli/src/commands/runtime.ts`. That list is the extension id pin, not rule scope.
Do not edit the approved spec body.
Corrections go in a `spec-NN-<topic>.md` sibling or in `workflow.md`.

## Locked readings

These resolve spec sentences an implementer could read two ways.
They do not change the approved spec.

| Topic | Execute this |
| --- | --- |
| Q1–Q6 | Adopt every recommendation in spec §9. |
| Q7 / REQ-032 / AC-012 | After the URL matches `source`, `originOf(request.target ?? request.url)` must be same-origin with `originOf(request.url)`. Outbound HTTP grant targets follow that same rule against the matched request URL. Do not also require the target URL to match `source`. |
| Q2 / REQ-033 | Body transforms require a present `http:` or `https:` initiator. Missing or non-http(s) initiator denies with `initiator-unauthorized`. Do not keep an origins allowlist. |
| REQ-010 dry-run | Delete result fields `urlRegex` and `effectiveOrigin`. The match axes are `source`, `method`, and `resourceType`. `source` explains match or miss. Origin membership is not an axis. Do not add a fourth axis. |
| Spike fail | URL-regex body rules are not put in PAC. Status is `needs runtime`. Traffic stays `DIRECT`. |

## Classification

| Kind | Tasks | Meaning |
| --- | --- | --- |
| Foundational | T02–T07, T08–T12, T15 | Schema, compiler, dry-run, native checks, PAC route model, storage/status types |
| Gate | T01 | Chrome PAC probe. Blocks only T13. |
| Integration | T13, T14, T16–T22 | Wire PAC branch, proxy, extension, editor, CLI, samples |
| Cleanup | inside the task that replaces the behavior | Delete the old symbol in that same task. No compatibility shim. |
| Docs / release | T23, T24 | Stage 10 writes living docs. Stage 8/11 run validate and the breaking release marker. |

## Execution order

1. Start **T01** immediately. It does not need schema v2. Record the result in `workflow.md` before **T13**.
2. **T02 → T03 → T04 → T05** (schema, then the browser mirror).
3. **T06 → T07** (compiler, then dry-run).
4. **T15** before extension status and grant UI (**T18**, **T19**). DNR projection (**T17**) needs **T06**, not **T15**.
5. **T08 → T12** can follow **T06**. **T13** waits for the T01 record. **T14** waits for **T12** and **T13**.
6. **T16** can follow **T02**. **T17** follows **T06**. **T18–T19** follow **T15** and **T17**.
7. **T20–T21** follow **T04** and **T07**. **T22** follows **T04** (fixtures). Browser journeys that grant origins move with **T18**.
8. **T23** is Stage 10. **T24** is the last check.

Package direction stays:

```
schema → compiler → { editor, dry-run, browser-core } → { cli, extension }
runtime depends on schema + compiler
cli depends on runtime
```

## Shared shapes

Put the literal-host predicate and the source matcher in the compiler.
Runtime and the extension already depend on the compiler.
Schema must not import the compiler.

`packages/compiler/src/source-match.ts` (new):

- `sourceMatches(source, url)` — `key: "url"` tests the full URL string with today's flagless regex (`packages/schema/src/regex.ts`). `key: "host"` tests `new URL(url).hostname` only (no scheme, no port).
- `literalHostname(source)` — returns one hostname or `null`. Proven only when `key` is `"host"`, `operator` is `"regex"`, and `value` is `^` + that hostname + `$`. Dots in the pattern are `\.`. No other metacharacters. No alternation. DNS labels or one IPv4 literal qualify. Anything else returns `null`.

Migration widening stays in schema (`packages/schema/src/migrate-v1.ts`).
It is a different recognizer (old URL regex prefix, not `key: "host"`).

Stable codes to lock in the first test that asserts them:

| Code | When |
| --- | --- |
| `url-mismatch` | Request URL does not match `source`. Keep this reason string. |
| `target-unauthorized` | Same-origin target check fails. |
| `initiator-unauthorized` | Body transform initiator missing or not http(s). |
| `extension.source-unprojectable` | Rule cannot be projected to DNR or session markers. Status `error`. Do not install it. |
| `runtime.pac-unroutable` | Enabled body rule has no PAC route. Status `needs runtime`. Request stays `DIRECT`. |
| `runtime.pac-route-limit` | Route count exceeds the PAC bound. Fail closed. No PAC script. |
| `migration.possible-scope-widen` | Per-rule side-channel notice. |
| `migration.initiator-policy` | One project-level side-channel notice. |

Delete `schema.no-effective-origin` and `runtime.request-body-empty-origins`.
Rename lifecycle reason `no-pac-origins` to `no-pac-routes`.

## Generated and migration surfaces

| Surface | What changes | Commit? |
| --- | --- | --- |
| `PROJECT_VERSION` | `1` → `2` in `packages/schema/src/types.ts` | Yes (source) |
| `ENVELOPE_VERSION` | `1` → `2` in `packages/browser-core/src/types.ts` | Yes (source) |
| `packages/schema/src/migrate-v1.ts` | Pure v1 → v2 function plus notices | Yes |
| `packages/extension/src/browser-schema.ts` | Hand-maintained mirror. Not generated. Re-export migrate via a relative import, same pattern as `clone.ts`. | Yes |
| `packages/extension/dist/**` | esbuild output | No |
| Preset canonical bytes | `packages/runtime/src/canonical.ts` `matcherValue` uses `source` | Yes. Digest change once is expected. |
| Native policy JSON | Drop `grantedOrigins` from `buildNativePolicy` and `RequestBodyPolicyV1` | Yes. Host and extension ship together. |
| CLI `.rogatio.json` | Migrate in memory on load. Write v2 only on explicit save. | — |
| `chrome.storage` envelope | `loadEnvelope` returns v2 and writes the migrated envelope back once. That write is storage migration, not a user-file rewrite. | — |
| Feature flag | None | — |

Rollback is revert the release.
v2 files do not load on v1 software.
There is no down-migration.
Authors should keep backups before upgrade.

## T01 — Chrome PAC spike

**Kind:** gate. **Blocks:** T13 only.

**Files / packages**

- New `test/browser/pac-regexp-spike.test.ts`
- Existing Chrome for Testing harness (`pnpm test:browser`, `vitest.browser.config.ts`)
- Extension already has the `proxy` permission (`packages/extension/public/manifest.json`)
- Record in `docs/decisions/requestly-rule-model/workflow.md`

**Behavior / invariant**

Install a PAC with `chrome.proxy.settings`.
Prove or refute each probe.
Node string tests are not evidence.

Run four installs. Each PAC returns `PROXY` to a local listener only when that probe passes, else `DIRECT`.

1. `RegExp` is a function inside `FindProxyForURL`.
2. Flagless match is case-sensitive (`^Ex$` matches `Ex` and does not match `ex`).
3. `lastIndex` does not stick across `FindProxyForURL` calls. Construct `new RegExp(source)` inside the function on each call. Also probe a `/g` regex created outside the function. Record both.
4. `new URL(url)` works inside the PAC.

**Dependencies**

None. Start in parallel with T02.

**AC:** AC-013. AC-008 still holds later if the spike fails (REQ-024 / REQ-029).

**Done when**

`pnpm exec vitest run --config vitest.browser.config.ts test/browser/pac-regexp-spike.test.ts` ran on Chrome for Testing.
`workflow.md` lists pass or fail for each probe, the command, and the exit code.
T13 may emit `new RegExp` only if probes 1, 2, and 4 pass, and probe 3 passes for a `RegExp` constructed inside `FindProxyForURL` on each call.
If that bar fails, T13 takes the fail-closed branch and does not emit `RegExp`.

## T02 — Schema v2 shape

**Kind:** foundational.

**Files / packages**

- `packages/schema/src/types.ts` (`PROJECT_VERSION`, `RogatioRule`, `RogatioGroup`)
- `packages/schema/src/schema.ts` (JSON Schema, `additionalProperties: false`)
- `packages/schema/src/limits.ts`
- `packages/schema/src/index.ts` exports
- `packages/schema/test/schema.test.ts`

**Behavior / invariant**

- `PROJECT_VERSION` is `2`. The schema `const` is `2`. A v1 document fails validation until T04 migrates it.
- Group required fields are `id`, `name`, `rules`. No `origins`.
- Rule required fields include `source`. No `urlRegex`. No `origins`.
- `source` is `{ key: "url" | "host", operator: "regex", value: string }`.
- `value` is non-empty and at most `LIMITS.maxUrlRegexLength` (2048).
- `operator` is the JSON Schema `const` `"regex"`. Any other operator fails schema validation.
- `method` and `resourceTypes` stay top-level.
- Delete `LIMITS.maxOriginsPerScope`. Keep `maxLocalOrigins` and `rogatio-origin` on `requestBodyPolicy.localOrigins` only.
- Keep `isSiteOrigin` / `normalizeSiteOrigin` in `packages/schema/src/origins.ts`.

**Dependencies:** none (parallel with T01).

**AC:** AC-001 (schema half), AC-005 (schema half), AC-007 (reject bad source).

**Done when**

Tests written first in `packages/schema/test/schema.test.ts`, then:

`pnpm exec vitest run packages/schema/test/schema.test.ts`

Covers v2 accept, v1 reject, missing `source`, unknown operator, empty `value`, over-long `value`, group/rule `origins` reject, and `localOrigins` still accepted.

## T03 — Semantic source checks

**Kind:** foundational.

**Files / packages**

- `packages/schema/src/validation.ts` (effective-origin block around the `effectiveOrigins` loop)
- `packages/schema/src/regex.ts` (reuse `isValidUrlRegex` / `compileUrlRegex` for `source.value`)
- `packages/compiler/src/diagnostics.ts` (delete `effectiveOrigin` → `schema.no-effective-origin`)
- `packages/compiler/src/types.ts` (delete that diagnostic code)
- `packages/schema/test/` and `packages/compiler/test/compiler.test.ts`

**Behavior / invariant**

- `source.value` uses today's case-sensitive flagless ECMAScript check. Invalid regex is a stable schema diagnostic.
- Delete the effective-origin semantic check (`keyword: "effectiveOrigin"`).
- Do not reject a rule for an empty origin set.
- `localOrigins` uniqueness checks stay.

**Dependencies:** T02.

**AC:** AC-001, AC-007.

**Done when**

`pnpm exec vitest run packages/schema/test packages/compiler/test/compiler.test.ts`

A rule with only `source` validates.
A rule whose group and rule used to have empty origins is not `schema.no-effective-origin`.
An invalid `source.value` fails closed with a stable code.

## T04 — v1 → v2 migration and notices

**Kind:** foundational.

**Files / packages**

- New `packages/schema/src/migrate-v1.ts`
- Export from `packages/schema/src/index.ts` and `packages/schema/src/browser-index.ts`
- New `packages/schema/test/migrate-v1.test.ts`

**Behavior / invariant**

Pure function. No I/O.

Input v1 project → `{ project, notices }`.

- Set `version: 2`.
- Drop group and rule `origins`.
- Set `source: { key: "url", operator: "regex", value: <old urlRegex bytes> }`.
- Do not synthesize `key: "host"`.
- Preserve regex bytes so capture indexes stay the same.
- Leave `method`, `resourceTypes`, actions, and `requestBodyPolicy` unchanged.
- Emit `migration.possible-scope-widen` for a rule unless a small recognizer proves every match origin is in the old effective set (normalized group origins ∪ rule origins):
  - Anchored prefix `^https?://<literal-host>` outside `|` alternation.
  - Host boundary after the host (port, `/`, or end).
  - If the prefix allows both `http` and `https`, both origins must be in the old set.
  - Inconclusive → warn. Empty old set → warn.
- Emit one project-level `migration.initiator-policy` notice: initiator∈origins is gone; any http(s) initiator is allowed; a missing initiator is denied.
- Notices are return values only. Do not add fields on the project object.
- Sort rule notices by group index, then rule index.
- Adversarial input (prototype keys, accessors, cycles, sparse arrays, non-string `urlRegex`) fails closed with a stable error. Do not throw third-party text.

**Dependencies:** T02.

**AC:** AC-006, AC-007 (unexpected-host case is a widening notice, not a silent rewrite).

**Done when**

`pnpm exec vitest run packages/schema/test/migrate-v1.test.ts`

Includes: byte-identical `value`, capture-group count unchanged, no `key: "host"` output, warn on inconclusive regex, no warn when the anchored literal host is in the old set, initiator notice present once, adversarial reject.

## T05 — Browser schema mirror

**Kind:** foundational.

**Files / packages**

- `packages/extension/src/browser-schema.ts`
- `packages/extension/test/browser-schema.test.ts` and sibling `browser-schema-*.test.ts` that embed `urlRegex` / `origins`
- `scripts/build.ts` already aliases `@rogatio/schema` to this file. Do not add Ajv or `node:` imports.

**Behavior / invariant**

Mirror T02–T04. v2 shape, `source` required, `origins` / `urlRegex` rejected, `operator` const `"regex"`.
Re-export `migrateV1Project` (name the export in T04 and use it here) through a relative import of `packages/schema/src/migrate-v1.ts`, same bypass as `clone.ts`.
`localOrigins` stays.

**Dependencies:** T02, T04.

**AC:** AC-001, AC-006 (extension read path will call this in T15).

**Done when**

`pnpm exec vitest run packages/extension/test/browser-schema.test.ts`

Plus the existing browser-schema action tests updated to v2 fixtures.
`scripts/validate.ts` still rejects `ajv` / `node:` in `packages/extension/dist/*.js` after a later build. Do not weaken that check.

## T06 — Compiler matcher

**Kind:** foundational.

**Files / packages**

- `packages/compiler/src/types.ts` (`NormalizedMatcher`)
- `packages/compiler/src/compile.ts` (`compileMatcher`, delete `normalizeOrigins`)
- `packages/compiler/src/matcher.ts`
- `packages/compiler/src/selector.ts` (`selectWinningOperation`)
- New `packages/compiler/src/source-match.ts`
- `packages/compiler/src/index.ts`
- `packages/compiler/test/compiler.test.ts`, `packages/compiler/test/selector.test.ts` (add if missing)

**Behavior / invariant**

`NormalizedMatcher` carries `source: { key, operator: "regex", value }` plus existing `resourceTypes`, `priority`, and optional `method`.
No `urlRegex`. No `origins`.
`compileMatcher` copies `rule.source` through. It does not read group origins.
Delete `normalizeOrigins` and `CompilerInvariantError` for origins.

`selectWinningOperation`:

- Remove the `grantedOrigins` parameter and the all-granted check.
- URL gate uses `sourceMatches`.
- Target gate is same-origin of `context.url` and `context.target` (Q7). Do not require `context.target` to match `source`.
- Method and resource-type checks stay. Fail closed.
- Initiator allowlist stays out of this function. Body initiator policy is T08.

Capture checks (`packages/schema/src/captures.ts` callers in the compiler) count groups in `source.value`.
For migrated rules, `key` is `"url"` and the subject stays the full URL, so indexes do not move.
A `key: "host"` rule captures from the hostname subject only.

**Dependencies:** T03, T04.

**AC:** AC-001, AC-005, AC-007, AC-012 (selector half).

**Done when**

`pnpm exec vitest run packages/compiler/test`

Assert no `matcher.origins` and no `matcher.urlRegex` on operations.
Host source matches `https://Example.com:8443/a` when the pattern is `^Example\\.com$` (hostname has no port; regex stays case-sensitive).
Same pattern does not match `https://evil.com/?x=Example.com`.
Empty group compiles.
`selectWinningOperation` ignores grants and denies a cross-origin target.

## T07 — Dry-run source dimension

**Kind:** foundational.

**Files / packages**

- `packages/dry-run/src/types.ts`
- `packages/dry-run/src/dryrun.ts` (match loop near the `urlRegex` / `effectiveOrigin` dimensions)
- `packages/dry-run/test/dryrun.test.ts` and other dry-run tests that read those fields
- `packages/editor/src/types.ts` dry-run dimension types only if T07 changes the shared result shape the editor already imports. Editor UI labels wait for T20.

**Behavior / invariant**

`RuleMatchResult` dimensions are `source`, `method`, and `resourceType`.
Delete `urlRegex` and `effectiveOrigin`.
`source.state` is `matched` or `unmatched` from `sourceMatches`.
Detail text states the key and whether the subject matched. Keep detail deterministic.
`method` and `resourceType` behavior stay (including `not-applicable`).
`matched` is true only when `source` is matched and method and resource type are not unmatched.
No origin axis.

**Dependencies:** T06.

**AC:** AC-005, AC-007.

**Done when**

`pnpm exec vitest run packages/dry-run/test`

Covers: URL regex semantics unchanged versus today's full-URL test, host source with and without a port, a regex that matches an unexpected host (miss on `key: "host"` when the hostname differs; hit on `key: "url"` when the full URL matches), empty group.

## T08 — Native re-check

**Kind:** foundational.

**Files / packages**

- `packages/runtime/src/revalidate.ts`
- `packages/runtime/test/revalidate.test.ts`

**Behavior / invariant**

Browser grant is not an input. Do not read `grantedOrigins`.

Order:

1. Existing snapshot / project / operation consistency checks stay.
2. Source gate via `sourceMatches`. Failure reason `url-mismatch`.
3. Target gate: same-origin as in the locked Q7 row. Failure `target-unauthorized`.
   Unparseable origin → `target-unauthorized`.
   Absent `request.target` compares the request URL origin to itself.
4. Body operations (`request-body`, `response-body`): initiator must be present and `originOf` must be `http:` or `https:`. Else `initiator-unauthorized`. Do not consult an origins list. Non-body kinds skip this gate.
5. Method and resource-type checks stay. Fail closed.
6. Dispatch-marker absence stays the caller's existing fail-closed path (do not drop it here). Valid marker plus source miss is `url-mismatch` at this function.

**Dependencies:** T06.

**AC:** AC-005, AC-008 items 6–7 (marker cases are asserted with the caller in T14), AC-012.

**Done when**

`pnpm exec vitest run packages/runtime/test/revalidate.test.ts`

Includes cross-origin target deny, same-origin target allow, absent target allow when the URL matches source, missing initiator deny for a body op, http(s) initiator allow even when that origin was not in the old origins list, method and resource-type deny.

## T09 — Authorization and preset grants

**Kind:** foundational.

**Files / packages**

- `packages/runtime/src/authorization.ts` (`authorizeExact`)
- `packages/runtime/src/preset.ts` (`freezeMatcher`, `makeGrant`, origins length checks that use `maxOriginsPerScope`)
- `packages/runtime/src/url.ts` (`isOriginAllowed` — delete if unused after this task)
- `packages/runtime/test/` authorization and preset tests

**Behavior / invariant**

Preset matchers store `source`, not `urlRegex` + `origins`.
`makeGrant` does not accept an outbound target because it sat in `matcher.origins`.
`authorizeExact` takes the matched request URL.
For `outbound-http`, allow only when `originOf(grant.target)` equals `originOf(requestUrl)`.
Missing request URL → deny outbound HTTP (fail closed).
`confined-file` stays on `normalizeLogicalPath`. Do not apply same-origin to file paths.
Do not require the grant target to match `source`.

**Dependencies:** T06, T08 (shared origin helper; keep one implementation, do not copy a third parser).

**AC:** AC-012.

**Done when**

`pnpm exec vitest run packages/runtime/test`

A grant whose target origin differs from the matched request URL is `runtime.authorization-denied`.
A same-origin target is allowed even though it would have failed the old origins list.
A cross-origin target that happens to match the source regex is still denied.

## T10 — Canonical preset bytes

**Kind:** foundational.

**Files / packages**

- `packages/runtime/src/canonical.ts` (`matcherValue`)
- Preset digest tests under `packages/runtime/test/`

**Behavior / invariant**

Canonical matcher JSON uses `source` (`key`, `operator`, `value`) and omits `urlRegex` and `origins`.
Field order is fixed. No third-party wording.
One digest change for existing presets is expected. Treat it as a clean re-issue.
Do not special-case old digests as failure.

**Dependencies:** T09.

**AC:** AC-005 (preset bytes), spec REQ-036.

**Done when**

Digest test shows two calls with the same preset produce the same bytes.
A fixture that still has `origins` in the matcher does not canonicalize.

## T11 — Runtime policy document

**Kind:** foundational.

**Files / packages**

- `packages/runtime/src/policy.ts`
- `packages/runtime/src/types.ts` (policy and error unions)
- `packages/extension/src/native-session.ts` (`buildNativePolicy` `grantedOrigins` argument)
- Call sites that pass `grantedOrigins` into the policy
- Matching tests

**Behavior / invariant**

Drop `grantedOrigins` from the policy object and from `buildNativePolicy`.
Operation matchers use `source`.
Delete the empty-origins failure `runtime.request-body-empty-origins`.
Keep `localTargetOrigins` / `requestBodyPolicy.localOrigins`.
Host and extension must agree in the same change set. No second protocol version unless a test already switches on `version`.

**Dependencies:** T06.

**AC:** AC-003 (policy half), AC-005.

**Done when**

Policy tests reject a document that still requires `grantedOrigins`, and accept a v2 matcher with `source` and no origins.

## T12 — PAC routes without user RegExp

**Kind:** foundational. Does not emit user `RegExp` into PAC.

**Files / packages**

- `packages/runtime/src/pac.ts` (`generatePacScript`)
- `packages/runtime/src/types.ts` (`MAX_PAC_ORIGINS`)
- New `packages/runtime/src/pac-safety.ts`
- `packages/runtime/src/lifecycle.ts` (`pacOrigins`, reason `no-pac-origins` near the empty check)
- `packages/runtime/src/interception.ts` (caller of `generatePacScript`)
- `packages/runtime/src/host.ts` (`pendingOrigins`, `activation.pacOrigins`, session start wrapper)
- `packages/runtime/test/pac.test.ts`, `packages/runtime/test/lifecycle.test.ts`

**Behavior / invariant**

Replace `MAX_PAC_ORIGINS` with `MAX_PAC_ROUTES` (keep the numeric cap 256 unless a test shows a tighter bound is required).
The cap counts PAC route entries derived from source conditions, not origin strings.

`generatePacScript` input is enabled body rules' compiled sources, already filtered to routable entries, in deterministic order (group order, then rule order, as compiled).

This task emits only the literal-host path:

- `literalHostname(source)` is non-null → compare the PAC `host` argument with string equality. No `new URL`. No `RegExp`.
- Non-literal sources are omitted here. T13 adds them only after the spike. Callers treat an omitted body rule as `runtime.pac-unroutable` (status wiring in T15 / T18).
- Unsafe classifier exists and is unit-tested now, even though user regex is not emitted yet. Refuse nested unbounded quantifiers (a quantified group that contains `*`, `+`, or `{n,}`). Inconclusive (backreference, lookaround, or scan overflow) → omit. Never emit `PROXY` for `*` or a wildcard host. No deadline inside the script.
- Zero routable entries → do not install PAC. `lifecycle.ts` returns interception inactive with reason `no-pac-routes`.
- Over the cap → throw or return a stable `runtime.pac-route-limit` result. No script. Fail closed.
- Output bytes are deterministic for the same routes and endpoint.

Rename `pacOrigins` fields on the session config to `pacRoutes` (or an equivalent name used in both `lifecycle.ts` and `interception.ts`). Update both together.

**Dependencies:** T06. Independent of T01.

**AC:** AC-008 items 3–5 (partial: header-only project has no PAC; unsafe pattern omitted; literal route present), AC-009.

**Done when**

`pnpm exec vitest run packages/runtime/test/pac.test.ts packages/runtime/test/lifecycle.test.ts`

Literal host routes proxy that host only.
A URL-regex body rule produces no PAC entry in this task.
Redirect/query/header-only input yields no script and `no-pac-routes`.
Unsafe and over-cap cases fail closed.
Script text has no `RegExp` and no `new URL`.

## T13 — RegExp PAC branch or fail-closed branch

**Kind:** integration. **Depends on the T01 record.**

**Files / packages**

- `packages/runtime/src/pac.ts`
- `packages/runtime/src/pac-safety.ts`
- `packages/runtime/test/pac.test.ts`
- `workflow.md` spike record (read it; do not guess)

**Behavior / invariant**

If the spike bar in T01 failed: do not emit `RegExp`. URL-regex body rules stay omitted (`runtime.pac-unroutable`, `DIRECT`). Literal-host routes from T12 stay.

If the spike bar passed:

- For a non-literal `key: "url"` source that passes `pac-safety`, emit `new RegExp(<json-escaped value>)` inside `FindProxyForURL` on each call (the shape the spike allowed). Test it against the full URL. No flags.
- For a non-literal `key: "host"` source that passes `pac-safety`, test the regex against the PAC `host` argument only when probe 4 (`new URL`) passed and you still do not need `new URL` for this path. Prefer the `host` argument. Do not parse the URL to recover a host from a URL regex.
- Unsafe or inconclusive → omit that route. Stable `runtime.pac-unroutable`.
- Never extract a hostname from a URL regex to widen the route.
- Never a wildcard `PROXY`.

**Dependencies:** T01 recorded, T12.

**AC:** AC-008 items 1, 2, 5; AC-009; AC-013.

**Done when**

PAC unit tests match the recorded branch.
On the pass branch, a matching URL returns the proxy string and a non-matching URL returns `DIRECT`.
On the fail branch, the generated script still has no `RegExp`, and a URL-regex body rule is reported unroutable.

## T14 — Intercept proxy and session wiring

**Kind:** integration.

**Files / packages**

- `packages/runtime/src/intercept-proxy.ts` (`matcherMatches`, dispatch marker path)
- `packages/runtime/src/url-captures.ts` (capture subject follows `source`)
- `packages/runtime/src/interception.ts` (pass routable sources, not origin strings)
- `packages/extension/src/native-session.ts` (stop collecting origins for PAC)
- `packages/runtime/test/intercept-proxy.test.ts`, `packages/runtime/test/lifecycle.test.ts`, `packages/extension/test/native-session-pac.test.ts`

**Behavior / invariant**

Body match uses `sourceMatches`, method, and resource type. No origin list.
Then `revalidateAuthority` (T08).
Missing dispatch marker keeps today's fail-closed behavior.
Marker present but URL no longer matches source → `url-mismatch`.
Disabling the last routable body rule removes PAC and leaves traffic direct.
Non-body projects do not start interception (`no-pac-routes`).
Capture substitution uses the same subject as the match (full URL for `key: "url"`).

**Dependencies:** T08, T12, T13.

**AC:** AC-008, AC-005 (native match).

**Done when**

`pnpm exec vitest run packages/runtime/test/intercept-proxy.test.ts packages/runtime/test/lifecycle.test.ts packages/extension/test/native-session-pac.test.ts`

Cover AC-008 items 1–7 at this seam (corpus or focused cases): non-match never calls the native rewrite, match does, header-only has no PAC, last body rule off removes PAC, unsafe pattern has no route, missing marker unchanged, stale marker is `url-mismatch`.

## T15 — Browser-core status, grants, storage

**Kind:** foundational. Land before T18 and T19.

**Files / packages**

- `packages/browser-core/src/types.ts` (`ENVELOPE_VERSION`, `StoredProject`, `RuleStatusKind`, `RuleStatusInput`)
- `packages/browser-core/src/status.ts`
- `packages/browser-core/src/migrate.ts`
- `packages/browser-core/src/repository.ts` (grant add/remove, `computeDeclaredOrigins` callers)
- `packages/browser-core/src/index.ts`
- `packages/browser-core/test/status.test.ts`, `migrate.test.ts`, `repository.test.ts`
- `scripts/validate.ts` smoke that calls `computeRuleStatuses` with `grantedOrigins` (update the call in the same task)

**Behavior / invariant**

- Delete `grantedOrigins` from stored project state.
- Delete `computeDeclaredOrigins`.
- Delete status `needs permission`.
- `computeDesiredRules` takes operations and enabled group ids only. Enabled rules are desired. No grant filter.
- `computeRuleStatuses` no longer takes `grantedOrigins`.
  Disabled group → `disabled`.
  Enabled, not installed, and not otherwise classified → `error` with `core.rule-not-installed`.
  Installed → `active`.
  Status `error` for `extension.source-unprojectable` and `needs runtime` for `runtime.pac-unroutable` are supplied by the extension installer report (T17/T18). browser-core must accept those statuses and must not overwrite `error` with `needs runtime`.
  Precedence used by badge attention stays: anything other than `active` and `disabled` raises attention. Active count is unchanged.
- `ENVELOPE_VERSION` is `2`.
  On load, strip `grantedOrigins`, run `migrateV1Project` when `data.version === 1`, and persist the v2 envelope once.
  Store notices beside the project, not inside `data` (for example `migrationNotices` on the envelope).
  Editor ack lives on that side channel (T20). Reloading does not duplicate notices after ack.
- `additional` project JSON keys from v1 (`origins`, `urlRegex`) are removed only by the migrator, not left beside `source`.

**Dependencies:** T04, T06.

**AC:** AC-001, AC-003, AC-004, AC-006.

**Done when**

`pnpm exec vitest run packages/browser-core/test`

A v1 envelope loads, stored project data is v2, notices exist until acked, `grantedOrigins` is absent, and no status string is `needs permission`.

## T16 — Manifest host permission

**Kind:** integration.

**Files / packages**

- `packages/extension/public/manifest.json`
- `packages/extension/test/manifest.test.ts`
- `scripts/validate.ts` (manifest assertion around `optional_host_permissions`)

**Behavior / invariant**

`host_permissions` is `["*://*/*"]`.
Delete `optional_host_permissions`.
Keep `permissions` including `declarativeNetRequest`, `scripting`, `nativeMessaging`, and `proxy`.
Do not switch to `declarativeNetRequestWithHostAccess`.

**Dependencies:** none beyond the worktree. Can land next to T02.

**AC:** AC-002.

**Done when**

`pnpm exec vitest run packages/extension/test/manifest.test.ts`
and, after a build, `pnpm validate` reaches the manifest assertion (full validate is T24).

## T17 — DNR and session-marker projection

**Kind:** integration.

**Files / packages**

- `packages/extension/src/dnr.ts` (`redirectQueryCondition`, `hostnamesFromOrigins`)
- `packages/extension/src/projection.ts`
- `packages/extension/src/session-body-markers.ts` (`buildBodyMarkerRule`)
- New shared helper in the extension, for example `packages/extension/src/source-projection.ts`, used by both DNR and markers
- `packages/extension/test/dnr.test.ts`, `projection.test.ts`, `session-body-markers.test.ts`

**Behavior / invariant**

One projection function for DNR and session markers (REQ-020).

- `key: "url"`: `regexFilter` is `source.value` bytes. No `requestDomains`.
- Proven DNS literal `key: "host"`: set both `requestDomains: [host]` and a host-pinned `regexFilter` that cannot match a subdomain. Never `requestDomains` alone. Pinned pattern shape: `^https?://` + escaped host + `(?::[0-9]+)?(?:[/?#]|$)`.
- IPv4 or IPv6 literal: Chrome rejects IP `requestDomains` (see the comment in `dnr.ts` near `hostnamesFromOrigins`). Omit `requestDomains`. Keep the host-pinned `regexFilter`. Do not widen.
- Any other `key: "host"` (non-literal): do not install. `extension.source-unprojectable`. Status `error` (wired in T18).
- Do not use DNR `urlFilter` for operator `regex`.
- Keep the per-rule dispatch marker on body rules.
- A Chrome install rejection of `regexFilter` stays status `error`. Keep stable code `extension.dnr-error` and `params.reason` for that path. Pre-emptive refusal uses `extension.source-unprojectable`.

**Dependencies:** T06.

**AC:** AC-005, AC-007 (unusable DNR condition fails closed).

**Done when**

`pnpm exec vitest run packages/extension/test/dnr.test.ts packages/extension/test/projection.test.ts packages/extension/test/session-body-markers.test.ts`

Assert: URL key has no `requestDomains`; literal host has both fields and the pinned regex rejects `https://a.example.com/`; non-literal host is not installed; marker condition equals the DNR condition for the same operation.

## T18 — Remove grant adapters and grant UI

**Kind:** integration / cleanup.

**Files / packages**

- `packages/extension/src/permissions.ts` (delete `declaredPermissionOrigins`)
- `packages/extension/src/chrome.ts` (`createPermissionAdapter` request/contains/remove)
- `packages/extension/src/service-worker.ts` (grant sync, `chrome.permissions.request` / `contains` / `remove`)
- `packages/extension/src/extension-page-entry.ts` (grant button and `chrome.permissions.request`)
- `packages/extension/src/index.ts` exports
- Match-logging path (`match-listener.ts` and related) so inject does not wait on per-origin grants
- `test/browser/extension-context.ts` (`seedGrantedOrigins`) — delete the per-origin seed once the manifest host grant is `*://*/*`
- Tests: `permissions.test.ts`, `chrome.test.ts`, `service-worker.test.ts`, match-logging tests

**Behavior / invariant**

No code path calls `chrome.permissions.request`, `contains`, or `remove` for origins.
Delete the adapter methods if nothing else needs them.
Keep `setBadge`.
Match-log scripting uses the install-time `*://*/*` host grant. Do not request origins first.
Installer feeds unprojectable rules as `error` + `extension.source-unprojectable`, and PAC-unroutable body rules as `needs runtime` + `runtime.pac-unroutable`.
If a rule is unprojectable, do not also mark it `needs runtime`.

**Dependencies:** T15, T16, T17. PAC status codes need T12/T13 results available to the extension session layer (T14).

**AC:** AC-003, AC-004 (call-site half), AC-005, REQ-039.

**Done when**

`pnpm exec vitest run packages/extension/test/permissions.test.ts packages/extension/test/service-worker.test.ts`

Repo search in `packages/**/src` finds no `chrome.permissions.request` and no `grantedOrigins`.
A match-log test enables logging without a grant call.

## T19 — Popup and attention copy

**Kind:** integration / cleanup.

**Files / packages**

- `packages/extension/src/popup-model.ts` (`GroupStatus`, `STATUS_PRECEDENCE`)
- `packages/extension/src/popup.ts`
- `packages/extension/src/attention.ts`
- `packages/extension/src/extension-page-entry.ts` status copy
- `packages/extension/test/popup-model.test.ts`, `attention.test.ts`, `status.test.ts`

**Behavior / invariant**

Remove `needs permission` from the union, precedence, and UI strings.
Precedence is `error > needs runtime > unsupported > active`.
A disabled group is `disabled`.
An enabled group with no rules is `active`.
Badge math still counts `active` only.

**Dependencies:** T15.

**AC:** AC-004.

**Done when**

`pnpm exec vitest run packages/extension/test/popup-model.test.ts packages/extension/test/attention.test.ts packages/extension/test/status.test.ts`

No assertion and no user string still says `needs permission`.

## T20 — Editor source controls and notices

**Kind:** integration.

**Files / packages**

- `packages/editor/src/editor.ts` (origin add/remove around the group/rule origins handlers; URL regex field; draft defaults)
- `packages/editor/src/types.ts` (rule draft `origins` / `urlRegex`)
- `packages/editor/src/ai-assist-panel.ts` (detail lines)
- `packages/editor/test/editor.test.ts`, `ai-assist.test.ts`
- Editor fixture `test/fixtures/editor-fixture.html` if it embeds v1 rules

**Behavior / invariant**

Remove group and rule origins editors.
Source controls: key select `url` | `host`, operator shown as fixed text `regex` (not a free input), value field for the regex.
Draft defaults use `source: { key: "url", operator: "regex", value: "" }` and version `2`.
Dry-run rows show the `source` dimension from T07.
Show migration notices once. Dismiss writes the envelope ack from T15 through the host `save` port. Do not store notices inside the project JSON.
AI apply path writes `source`, not `origins` / `urlRegex`.
Browser bundle stays free of Ajv and `node:` (host supplies `validate`).

**Dependencies:** T04, T05, T07, T15.

**AC:** AC-005 (editor), AC-006 (show once).

**Done when**

`pnpm exec vitest run packages/editor/test/editor.test.ts packages/editor/test/ai-assist.test.ts`

Editor test creates a rule with key `host` and a regex value, rejects a missing source via the host validator, and shows a widening notice once.

## T21 — CLI AI prompts and load path

**Kind:** integration.

**Files / packages**

- `packages/runtime/src/ai-prompt.ts`
- `packages/runtime/src/ai-assist.ts` (proposal shape `urlRegex` / `effectiveOrigin`)
- `packages/cli/src/utils/file.ts` (`readProject`) and the edit / verify / test / ai callers
- `packages/cli/src/commands/test.ts` (dimension print)
- `packages/cli/src/utils/project-storage.ts` (empty project `version`)
- `packages/runtime/test/ai-prompt.test.ts`, `ai-assist.test.ts`
- `packages/cli/test/` verify, routes, and runtime tests that embed v1 projects

**Behavior / invariant**

Prompts ask for a source condition (`key`, operator `regex`, `value`).
They do not ask for origins or for an effective-origin union.
Proposal schema matches T02. Invalid `source.value` still repairs in place.
`readProject` consumers: if `version === 1`, migrate in memory, print notices to stderr, and do not write the file.
Explicit save from `rogatio edit` writes v2.
`rogatio test` prints the `source` dimension.
New empty projects are version `2` with no origins.

**Dependencies:** T04, T07, T10 if AI presets include canonical matchers.

**AC:** AC-005 (CLI print), AC-006 (print on load, no silent disk rewrite).

**Done when**

`pnpm exec vitest run packages/runtime/test/ai-prompt.test.ts packages/runtime/test/ai-assist.test.ts packages/cli/test`

A v1 file load prints a widening notice and leaves the file bytes unchanged.
A saved project is v2.

## T22 — Samples and browser fixtures

**Kind:** integration.

**Files / packages**

- `samples/basic/.rogatio.json`
- `samples/basic/README.md` grant steps (prose can be finished in T23; fixtures must be v2 before browser tests)
- `test/browser/sample-basic-helpers.ts`
- `test/browser/ai-live.test.ts` and other browser tests that set `urlRegex` or grant origins
- `packages/runtime/test/helpers.ts` and fixture builders that still emit `urlRegex` + `origins`

**Behavior / invariant**

Sample project is version `2`.
Each rule has `source` copied from today's `urlRegex` (`key: "url"`, operator `regex`) and no `origins`.
Helpers that retarget the sample to localhost rewrite `source.value`, not `urlRegex`.
Delete grant / needs-permission steps from journey code.
Do not change capture syntax.

**Dependencies:** T04. Browser grant removal follows T18.

**AC:** AC-006 (sample loads), AC-007 where fixtures cover host and URL cases.

**Done when**

Sample JSON validates as v2 via the schema test or a CLI verify test.
Browser helper types compile against `source`.

## T23 — Docs (Stage 10)

**Kind:** docs. Do not edit these files in Stages 6–7.

Living docs are Stage 10 (`docs` role), after behavior is stable.
`docs/architecture.md` is the living boundary doc. This plan does not update it.

Rewrite, do not soften, the lines that promise no broad host access:

- `README.md` (host grant paragraph near the "does not request broad host permissions" sentence)
- `docs/architecture.md` line that says permission requests never include broad host patterns
- `packages/docs-site/src/content/docs/getting-started/installation.md`
- `packages/docs-site/src/content/docs/guides/extension.md`
- `packages/docs-site/src/content/docs/reference/extension.md`

Also update status lists and PAC / re-check wording:

- `AGENTS.md` browser-core blurb (`needs permission`)
- `rogatio-overview.md` status list
- `docs/architecture.md` origins contract, status model, PAC routing, dry-run dimension (spec appendix cites about lines 59–63, 73, 87, 95–97, 210, 320, 329)
- `packages/docs-site/src/content/docs/guides/projects-rules.md`
- `packages/docs-site/src/content/docs/guides/runtime.md`
- `packages/docs-site/src/content/docs/reference/architecture.md`
- Rule guides that show `urlRegex` (`rules/redirects.md`, `headers.md`, `query-params.md`, `request-body.md`, `response-body.md`)
- `samples/basic/README.md`
- Package READMEs that mention origins or `needs permission`

State plainly: install grants `*://*/*` ("Read and change all your data on all websites").
The native re-check is the authority: source match, same-origin target, http(s) initiator required for body transforms, method, resource type, dispatch marker.
Mention v1→v2 migration, widening notices, and one-time preset digest re-issue.

**Dependencies:** implementation tasks complete.

**AC:** AC-010.

**Done when**

Stage 10 checklist in `workflow.md` names each file touched.
`pnpm validate` still passes if it builds the docs site.

## T24 — Validation and release prep

**Kind:** release prep. Not a behavior change.

**Behavior / invariant**

- Run `pnpm validate` from the worktree. Record command and exit code in `workflow.md`.
- AC-011: that command is green before review is called passed.
- AC-014: the commit that merges to `main` uses `feat!:` or a `BREAKING CHANGE:` footer so semantic-release cuts a major. Do not hand-edit the version to force 2.0.0.
- Stage 11 freeze moves `spec.md`, `plan.md`, and `workflow.md` per `AGENTS.md`. Do not freeze during implementation.
- Audit for secrets, `dist/`, coverage, and `graphify-out/` before any release commit.

**Dependencies:** T01–T22, and T23 before the release gate.

**AC:** AC-011, AC-014.

**Done when**

`pnpm validate` exits 0 and the workflow log quotes that result.

## Acceptance map

| AC | Tasks |
| --- | --- |
| AC-001 | T02, T03, T05, T06, T15, T18 |
| AC-002 | T16 |
| AC-003 | T11, T15, T18 |
| AC-004 | T15, T18, T19 |
| AC-005 | T02, T06, T07, T08, T10, T11, T14, T17, T18, T20, T21 |
| AC-006 | T04, T05, T15, T20, T21, T22 |
| AC-007 | T02, T03, T04, T06, T07, T17, T22 |
| AC-008 | T12, T13, T14 |
| AC-009 | T12, T13 |
| AC-010 | T23 |
| AC-011 | T24 |
| AC-012 | T06, T08, T09 |
| AC-013 | T01, T13 |
| AC-014 | T24 |

## Test default

For each task, add or adjust the listed test first.
Run that file and confirm the new assertion fails for the right reason.
Then change production code.
Run the same file again.
Do not delete an assertion to go green.
Prefer real schema, compiler, and PAC string output over mocks of those pure functions.
Adversarial cases belong on T04 and on any parser that accepts project JSON (`revalidate`, preset, envelope migrate).
