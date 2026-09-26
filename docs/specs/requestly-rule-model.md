# Requestly rule model — specification

> Audience: hybrid
> Status: approved 2026-09-25 (Stage 4)
> Issue: [#219](https://github.com/drmaas/rogatio/issues/219)

## 1. Problem and goals

Authors state host scope twice: once in `urlRegex`, once in group/rule `origins`. Those fields can disagree. Permissions, DNR `requestDomains`, dry-run, PAC, and the native re-check follow `origins`, not the matcher. The matcher is not the scope.

**Goals**

- Delete `origins` from groups and rules.
- Make one **source condition** the only statement of what a rule matches.
- Use one broad install-time host grant (Requestly model).
- Keep body-rule PAC routing scoped to enabled body rules' source conditions.
- Strengthen the native re-check. Never trust the browser grant as authority.
- Migrate v1 projects without data loss. Report every rule whose scope may widen.

## 2. Scope and non-goals

### In scope

- Schema v1 → v2: drop `origins`; add `source`; keep `method` / `resourceTypes` top-level.
- Compiler, dry-run, browser-core, editor, extension, runtime, CLI AI prompts, samples, docs.
- Manifest: `host_permissions: ["*://*/*"]`; remove `optional_host_permissions`.
- Remove per-origin grants, `grantedOrigins`, `needs permission`, grant UI.
- PAC generation from enabled body-rule source conditions; PAC spike gate.
- Migration notices for possible scope widening.

### Non-goals

- Deduce permissions or hosts from a regex.
- Operators `equals`, `contains`, `wildcard` (follow-up).
- `filters.pageDomain` (follow-up; see open questions).
- Nesting `method` / `resourceTypes` under a `filters` object.
- General forward proxy or wildcard PAC fallbacks.
- Dropping the dispatch marker because PAC is tighter.
- Traffic archive / match history (#204).
- Changing capture syntax (#197) beyond preserving regex bytes.
- Rewriting `requestBodyPolicy.localOrigins`.
- Switching `declarativeNetRequest` to `declarativeNetRequestWithHostAccess`.

## 3. Actors, entry points, environments

| Actor | Entry |
| --- | --- |
| Project author | Editor, `.rogatio.json`, `rogatio edit` / `verify` / `test` / `ai` |
| Extension user | Install, management page, popup, Start/Stop runtime |
| Chrome | DNR, `chrome.proxy` PAC, scripting inject, native messaging |
| Native host | PAC install, loopback proxy, `revalidateAuthority`, authorization |
| Stored projects | browser-core envelope + on-disk `.rogatio.json` |

Supported environment: Chrome MV3 + Rogatio native host (existing platforms). PAC spike must run on the repo's Chrome for Testing before RegExp-in-PAC is treated as approved behavior.

## 4. Functional requirements

### Schema and matcher

- **REQ-001** Project schema version becomes `2`. Version `1` documents are accepted only through migration.
- **REQ-002** Groups have `{ id, name, rules }` plus the existing enable toggle. Groups have no scope field.
- **REQ-003** Every rule has required `source: { key, operator, value }`.
  - `key`: `"url"` \| `"host"`
  - `operator`: const `"regex"` in this release
  - `value`: non-empty string; same length bound as today's URL regex (`maxUrlRegexLength`)
- **REQ-004** `source.operator: "regex"` uses today's case-sensitive, flagless ECMAScript semantics (`packages/schema/src/regex.ts`).
- **REQ-005** `key: "host"` matches the request host only (no scheme, no port). `key: "url"` matches the full request URL string used by today's regex match.
- **REQ-006** Keep `method` and `resourceTypes` as top-level rule fields. Do not add `filters` in this release.
- **REQ-007** Delete `origins` from group and rule. Delete the effective-origin semantic check and `rogatio-origin` format usage for those fields. Keep `isSiteOrigin` / `normalizeSiteOrigin` for `requestBodyPolicy.localOrigins` and any remaining site-origin policy.
- **REQ-008** Delete `maxOriginsPerScope` unless another field still needs it. Bound `source.value` with the existing regex length limit.

### Compiler and dry-run

- **REQ-009** Compiler emits a browser-neutral matcher carrying `source` (not `urlRegex` + `origins`). Delete `normalizeOrigins`.
- **REQ-010** Dry-run keeps four dimensions. Replace `effectiveOrigin` with a `source` dimension that explains match / miss.

### Permissions and status

- **REQ-011** Manifest declares `host_permissions: ["*://*/*"]` and does not declare `optional_host_permissions`. Keep existing `permissions` including `declarativeNetRequest` (do not switch to `declarativeNetRequestWithHostAccess` in this issue).
- **REQ-012** Remove `chrome.permissions.request` / `contains` / `remove` adapters used for per-origin grants. Keep badge helpers.
- **REQ-013** Remove `grantedOrigins` from stored project state and all grant-sync paths.
- **REQ-014** Remove status `needs permission` from the status union, badge math, popup precedence, and UI copy.
- **REQ-015** `scripts/validate.ts` and extension manifest tests assert the new host permission shape.

### DNR and session markers

- **REQ-016** Project DNR conditions with `regexFilter` set to the ECMAScript source value (Chrome RE2 surface). Do not use DNR `urlFilter` for operator `regex`.
- **REQ-017** For `key: "host"` with a single literal hostname, also set `requestDomains: [host]` **and** a host-pinned `regexFilter` that does not admit subdomains. Never use `requestDomains` alone.
- **REQ-018** For `key: "url"`, use `regexFilter` only (no `requestDomains`).
- **REQ-019** If a source cannot be projected without widening or without a usable RE2 pattern, do not install the rule. Stable diagnostic. Status `error` (see REQ-028).
- **REQ-020** Session body markers use the same condition projection as DNR for the URL/host match. Keep the per-rule dispatch marker.

### PAC and routing

- **REQ-021** Before implementing RegExp-inside-PAC as product behavior, run a Chrome-for-Testing spike that installs a PAC via `chrome.proxy.settings` and proves or refutes: `RegExp` availability, flagless case-sensitive match, no sticky `lastIndex` across calls, and whether `new URL` works. Record results in the workflow log. Node string tests alone are not evidence.
- **REQ-022** If the spike passes: `generatePacScript` takes enabled body rules' compiled source conditions (deterministic order). `FindProxyForURL` returns the proxy only when a condition matches; otherwise `'DIRECT'`.
- **REQ-023** Literal `key: "host"` with a proven single hostname uses the PAC `host` argument equality path (no `URL`, no `RegExp`).
- **REQ-024** If the spike fails: do not emit RegExp into PAC. URL-regex body rules are not routed (see REQ-029). Never extract a host from a URL regex to widen routing.
- **REQ-025** Install-time static reject: refuse patterns in a documented conservative unsafe set (nested unbounded quantifiers and similar). Inconclusive or rejected → omit that rule from PAC (fail closed). Never rely on a runtime deadline inside PAC. Never emit `PROXY` for `*` or a wildcard host.
- **REQ-026** Zero routable body rules ⇒ no PAC installed; interception inactive (preserve `lifecycle.ts` "no pac origins" invariant under new naming).
- **REQ-027** Replace `MAX_PAC_ORIGINS` with a bound on PAC route entries derived from source conditions. Exceeding the bound fails closed with a stable diagnostic.
- **REQ-028** DNR-unprojectable enabled rule → status `error` + stable diagnostic.
- **REQ-029** PAC-unroutable enabled body rule (spike failure, unsafe pattern, or non-literal host without RegExp support) → status `needs runtime` + stable diagnostic naming the PAC limitation. Request stays `DIRECT`.

### Native re-check and authorization

- **REQ-030** Browser grant is never authority. Every body transformation re-checks the canonical project.
- **REQ-031** URL/host gate: the request URL must match the rule's source condition. Failure reason remains `url-mismatch` (or a renamed stable equivalent documented in the release).
- **REQ-032** Target gate: replace `targetOrigin ∈ matcher.origins`. For body rewrite and authorization, `originOf(request.target ?? request.url)` must be same-origin with `originOf(request.url)` after the URL has matched the source condition. Outbound grant targets must be same-origin with the matched request URL (or match an explicit future target policy — not in this issue). Failure reason: `target-unauthorized`.
- **REQ-033** Initiator gate: see Open Question Q2. Until approved otherwise, require a present http(s) initiator origin for body transformations; deny `initiator-unauthorized` when missing or non-http(s). Do not reintroduce an origins allowlist in this issue. Document cross-origin widening vs today's initiator∈origins check in migration notices and architecture.
- **REQ-034** Method and resource-type checks stay. Fail closed.
- **REQ-035** Dispatch marker remains mandatory. Missing marker → existing fail-closed path. Valid marker + URL no longer matching source → deny (`url-mismatch`).
- **REQ-036** Canonical preset bytes include `source` instead of `urlRegex`+`origins`. Digest change once is expected; treat as clean re-issue, not failure.

### Editor, CLI, match logging

- **REQ-037** Remove group/rule origins editors. Add source key + operator (fixed regex) + value controls.
- **REQ-038** AI prompts stop asking for origins; ask for source condition.
- **REQ-039** Match logging inject no longer depends on per-origin grants. Broad host grant covers scripting host access.

### Migration

- **REQ-040** Pure tested v1 → v2 migration: drop group/rule `origins`; set `source: { key: "url", operator: "regex", value: <old urlRegex> }`. Preserve regex bytes (capture indexes unchanged).
- **REQ-041** Do not synthesize `key: "host"` in the migrator.
- **REQ-042** Emit a widening notice unless a small recognizer proves every match's origin lies in the old effective origin set (anchored `^https?://<literal-host>` prefix outside alternation, host boundary, origin ∈ old set). Inconclusive → warn.
- **REQ-043** Notices are a side channel (storage/editor/CLI), not fields inside `.rogatio.json`. Show once in the editor; print on CLI load. Do not auto-rewrite the user's on-disk file without an explicit save.
- **REQ-044** Mirror schema changes in `packages/extension/src/browser-schema.ts`. Upgrade stored envelope projects on read so the extension does not brick.

## 5. Acceptance criteria

- **AC-001** No `origins` field on group or rule in `packages/**/src`, and no `matcher.origins` on any operation. (REQ-007, REQ-009)
- **AC-002** Manifest has `host_permissions: ["*://*/*"]` and no `optional_host_permissions`; `scripts/validate.ts` asserts it. (REQ-011, REQ-015)
- **AC-003** No code path can call `chrome.permissions.request` for origins; `grantedOrigins` is gone. (REQ-012, REQ-013)
- **AC-004** `needs permission` is gone from status union, badge math, and UI copy. (REQ-014)
- **AC-005** Rule scope is the source condition alone in editor, compiler, dry-run, DNR, markers, and native re-check. (REQ-003–010, REQ-016–020, REQ-030–035)
- **AC-006** A v1 project with origins loads after upgrade; rules that may widen are reported; capture group indexes unchanged. (REQ-040–044)
- **AC-007** Tests cover: regex source semantics unchanged; host source with and without ports; a regex that matches a host the author did not expect; empty group; unusable DNR condition fails closed. (REQ-004, REQ-005, REQ-019, REQ-028)
- **AC-008** Routing corpus:
  1. Non-matching URL corpus → `DIRECT`, never reaches native host.
  2. Matching URL corpus for each enabled body rule → proxy.
  3. Project with only redirect/query/header → no PAC.
  4. Disabling the last body rule → PAC remove; traffic direct.
  5. Non-terminating / statically unsafe pattern → refused at install; no PAC entry; stable diagnostic.
  6. Marker missing → pass through / existing deny untouched.
  7. Marker valid but URL no longer matches source → `url-mismatch`.
  (REQ-022–029, REQ-035)
- **AC-009** Unsafe PAC pattern fails closed; no wildcard/broad fallback route. (REQ-025)
- **AC-010** Docs (`architecture.md`, README, package READMEs, docs site) state the broad-grant model and install-time warning plainly. Line that promised no broad host patterns is rewritten, not softened. Native re-check wording strengthened. (Stage 10)
- **AC-011** `pnpm validate` green. Decision docs frozen per `AGENTS.md` on release. (Stage 8/11)
- **AC-012** Target check: after URL matches source, `originOf(request.target ?? request.url)` is same-origin with `originOf(request.url)`; otherwise `target-unauthorized`. Outbound grant targets follow the same same-origin rule. (REQ-032)
- **AC-013** Chrome PAC spike result recorded in workflow log before RegExp-in-PAC ships. If spike fails, AC-008 still holds via REQ-024/REQ-029. (REQ-021, REQ-024)
- **AC-014** Breaking release uses `!` or `BREAKING CHANGE:` on the merge commit to `main`.

## 6. Compatibility and surfaces

| Surface | Change |
| --- | --- |
| `.rogatio.json` | Breaking v2 shape; migration from v1 |
| Compiler operations | `matcher.source` replaces `urlRegex`+`origins` |
| Extension UI | No grant buttons; source editor replaces origins editors |
| Status model | Drop `needs permission` |
| Manifest / store listing | "Read and change all your data on all websites" |
| AI prompts | Source condition instead of origins |
| Preset digests | All change once |

## 7. Security, privacy, performance, ops

- Accepted trust regression: broad install-time host grant.
- Compensating control: stronger canonical re-check (source, same-origin target, initiator policy per Q2, method, resource type, marker).
- No traffic archive. No general forward proxy.
- PAC runs on the network path: refuse unsafe patterns at install; omit from PAC.
- Diagnostics and PAC/preset bytes stay deterministic and free of third-party wording.

## 8. Migration and rollout

1. Ship schema/compiler/runtime/extension together (one breaking release).
2. Migrate on read for stored projects; migrate on load for CLI files into memory; persist v2 on explicit save.
3. Show widening notices once.
4. Release notes: broad grant, dropped origins, digest re-issue, initiator behavior decision from Q2.

Rollback: revert the release; v2 files are not loadable on v1 software without a down-migration (out of scope). Authors should keep backups before upgrade.

## 9. Open questions

**Q1: If the PAC RegExp spike fails, do URL-regex body rules become `needs runtime`?**  
Why it matters: most existing body rules use URL regex. Host-extraction would widen routing.  
**Recommendation:** Yes — `needs runtime` + `DIRECT` (REQ-024/029).  
Alternatives: always host-literals-only (breaks body path); host-extract (violates routing AC).

**Q2: Initiator policy after origins are gone?**  
Why it matters: today initiator must be in `matcher.origins` when present (`revalidate.ts:84-92`). Dropping that widens cross-origin page→API triggers. Non-negotiable 3 asks for a stronger re-check including initiator.  
**Recommendation:** Require present http(s) initiator for body transforms; deny if missing/non-http(s); do not add `pageDomain` or an origins allowlist in this issue; emit migration notices that initiator∈origins is gone. Document as accepted widening of initiator scope with a stronger presence check.  
Alternatives: (b) migrate effective origins into a temporary initiator allowlist; (c) ship `pageDomain` now; (d) keep skip-when-absent (weaker).

**Q3: DNR uses `regexFilter`, with `requestDomains` only as AND for one literal host?**  
Why it matters: issue text says `urlFilter` (Requestly non-regex language). `requestDomains` alone matches subdomains.  
**Recommendation:** Yes — REQ-016–019.  
Alternatives: `requestDomains` only; block all `key: "host"` this issue.

**Q4: Is an inconclusive widening proof a warning?**  
Why it matters: silent on inconclusive = silent widen.  
**Recommendation:** Warn on inconclusive (REQ-042).  
Alternatives: warn every migrated rule; warn only when a host can be extracted and disagrees.

**Q5: Keep `method` / `resourceTypes` top-level?**  
Why it matters: nesting under `filters` is a second migration.  
**Recommendation:** Yes — top-level; defer `pageDomain`.  
Alternatives: nest under `filters` now.

**Q6: Schema accepts only `operator: "regex"`?**  
Why it matters: accepting unimplemented operators is a false success.  
**Recommendation:** const `"regex"` only (REQ-003).  
Alternatives: full enum with semantic reject for others.

**Q7: Target authorization replacement (adversarial blocker)?**  
Why it matters: deleting origins removes `targetOrigin ∈ matcher.origins` without a replacement leaves any-target holes in `revalidate` / `authorization` / `preset` / `intercept-proxy`.  
**Recommendation:** Same-origin with the matched request URL after source match (REQ-032 / AC-012).  
Alternatives: require target URL to also satisfy the source condition; keep a separate target allowlist (rejected — reintroduces origins).

## 10. Architecture decisions appendix

*(Apply to `docs/architecture.md` after approval / Stage 10. Do not treat this appendix as the living doc.)*

### Package ownership

| Package | Responsibility |
| --- | --- |
| `schema` | v2 shape, source validation, migration pure function + notices, drop origin checks |
| `compiler` | `MatcherOperation.source`; delete `normalizeOrigins` |
| `dry-run` | `source` dimension |
| `browser-core` | Drop grants / `needs permission`; storage migration hooks; notice side-channel |
| `editor` | Source controls; drop origins UI; show notices once |
| `extension` | Manifest, DNR/markers, delete permissions adapters, PAC inputs from source, browser-schema mirror |
| `runtime` | PAC from source conditions, revalidate/authorize target+initiator+source, canonical bytes, bounds |
| `cli` | AI prompt + load-time migration notices |

### Chosen approaches

| Seam | Choice | Rejected |
| --- | --- | --- |
| PAC | Spike-gated RegExp + literal host fast path; fail closed | Host-extract from URL regex; wildcard PAC |
| Migration | Byte-preserve URL regex; warn inconclusive; side-channel notices | Synthesize `key:host`; warnings inside document |
| DNR | `regexFilter` authoritative; `requestDomains` AND only for literal host | `requestDomains` alone; DNR `urlFilter` for regex |
| Target auth | Same-origin with matched request URL | Any target after URL match; new origins-like allowlist |
| Permissions | `host_permissions: ["*://*/*"]` + keep `declarativeNetRequest` | Per-origin optional grants; switch to `declarativeNetRequestWithHostAccess` without need |

### Living architecture paragraphs to rewrite after approval

- Origins contract (~L59–63, 73, 87, 95–97, 210, 320, 329)
- Status model including `needs permission`
- PAC / F23 scoped routing
- Dry-run `effectiveOrigin` dimension
- AGENTS.md package blurbs mentioning origins / `needs permission`

### Rejected product alternatives (from research)

- Deduce permission origins from `urlRegex` (incomplete; not equivalent to matcher scope).
- Keep per-origin grants without an origins field (Chrome action DNR needs host access; no field to deduce from ⇒ must be broad).
