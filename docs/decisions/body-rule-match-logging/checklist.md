# Checklist: body-rule-match-logging

Track implement progress. Update checkboxes as work lands. Strategy: **TDD** (§2–§6); §1 probe empirical then lock asserts.

## §1 Probe — AC4, AC10

- [x] Add browser probe mirroring `header-match-probe` (session `modifyHeaders` requestHeaders reserved marker + strip; **inert** logging values)
- [x] Assert `onRuleMatchedDebug` fires for request-body-shaped URL matcher
- [x] Assert marker headers absent upstream (request path)
- [x] Repeat event + no-leak asserts for response-body-shaped URL matcher
- [x] Assert probe marker values are inert (no capability / digest / rewrite-auth substring)
- [x] If session install fails: retry dynamic; record fallback in probe notes / plan risk outcome
- [x] Gate: do not ship response-body markers/index path unless both response asserts pass; same gate for request-body asserts before request-body ship

**Done when:** AC4 probe evidence green (or fallback documented with same two asserts); inert marker check recorded. Cite evidence on ADR 0006 when green.

**§1 outcome (Chrome 153):** session store won (no dynamic fallback). Locked mode `remove-when-present` (client sends inert `X-Rogatio-Dispatch-BodyMatch`, session rule removes). Both shapes: event fire + no-leak pass. Evidence: `test/browser/body-match-probe.test.ts` header notes. Probe asserts smoke echo live (`status` 200 + `host` header) so no-leak is not vacuous when another process owns `:4173`.

## §2 Session API + marker helper + id band — AC8, AC10

- [x] Extend `ChromeApi` / `chrome.ts` with session-rule update/get ports
- [x] Define body-marker id band (`3_000_001+` or approved alternate) in **session** store; document vs ADR 0009 dynamic bands
- [x] Add session-rules helper: build **set-only** inert marker rules from body operations (reserved name + opaque id); **no** DNR remove of same header; install/remove `getSessionRules ∩` owned band only; never `updateDynamicRules`
- [x] **TDD:** band ownership; no wipe of dynamic redirect/query/header ids; harness chrome adapter
- [x] **TDD:** built rules are set-only; values match inert sentinel; never capability/digest; never paired DNR strip

**Done when:** AC8 + AC10 (inert set-only build) met; helper unit tests red→green.

## §3 Lifecycle + index merge — AC4, AC8, AC9, AC10

- [x] Hook marker install into native-session start only when **runtime strip path is available**; only kinds that passed probe
- [x] Confirm/wire reserved-marker strip on session proxy path (reuse scaffolding; no F17 capability mint)
- [x] Hook marker remove into stop **and** start-failure rollback (no orphans)
- [x] Merge body marker ids into match-index write so lookup sees them; on remove, drop those index ids
- [x] Keep redirect/query/header in dynamic `createDnrInstaller` only; no PAC / pending-auth / capability mint (AC9)
- [x] **TDD:** start → session body-band present + index hit by id
- [x] **TDD:** stop → session body-band empty + index lacks those ids (orphan-on-stop)
- [x] **TDD:** start-failure rollback → no orphan session body rules + index clean
- [x] **TDD:** no strip path → no marker install
- [x] **TDD:** response-body skipped when probe gate false; non-body DNR tests unchanged

**Done when:** AC4 gated install, AC8 no cross-wipe, AC9 no #170 coupling in path, AC10 remove-on-stop/failure + no-leak via runtime strip — all proven by tests above.

## §4 Index + format body kinds — AC1, AC2 (redact), AC3

- [ ] Extend `MatchIndexEntry.kind` + body intent types
- [ ] Teach `rawEntryFromOperation` / sanitize / `boundStoredKind` for body kinds; unknown kinds fail-closed
- [ ] `formatIntendedAction`: mode + ≤200 rewrite summary from config; never live body bytes; never marker header values
- [ ] **TDD:** `match-index.test.ts` — body round-trip; sanitize drops unknown/malformed body kind
- [ ] **TDD:** `match-format.test.ts` — body line has URL/method/initiator/type + mode + ≤200; no live `body`; redact flag honored on rewrite text

**Done when:** AC1 (format path), AC3, AC2 redaction — unit evidence green.

## §5 Append seam — AC2, AC6

- [ ] Extract post-lookup seam from `handleRuleMatchedDebug` (entry + live fields)
- [ ] Wire console inject as sole consumer (in-process only; no native match feed)
- [ ] **TDD:** seam invoked for body-kind index hit; inject still works
- [ ] **TDD fail-closed (silent):** toggle off; unknown id; `tabId === -1`; missing API; inject throw
- [ ] **TDD:** no history UI/storage write

**Done when:** AC2 fail-closed + AC6 seam — unit evidence green.

## §6 Editor checkbox — AC7

- [ ] Show `redactSensitiveInLogs` on body rule cards (remove `isBodyRuleType` hide)
- [ ] **TDD:** flip `redact-sensitive-in-logs.test.ts` (expect visible + toggle on body cards)
- [ ] Confirm schema already accepts field (no schema change unless gap found)

**Done when:** AC7 met.

## §7 Architecture docs — AC5

- [x] Amend ADR 0001 — body via markers; drop silent; reject native-host match logging (plan review)
- [x] Amend ADR 0006 — body kinds in coverage; probe-gated cite (plan review; add evidence path after §1)
- [x] Amend ADR 0007 — body checkbox (plan review)
- [x] Amend ADR 0009 — body marker session band; session DNR for match logging; no cross-store wipe (plan review)
- [ ] Update `docs/architecture.md` match-logging + marker sections (logging-only inert markers; single pipeline)
- [x] After §1 green: add probe evidence cite to ADR 0006 amendment

**Done when:** AC5 met (docs consistent; probe cite when §1 green).

## §8 End-to-end verify — AC1–AC10

- [ ] Run focused match-* / editor / probe / lifecycle orphan tests
- [ ] Run `pnpm validate`
- [ ] Spot-check each AC1–AC10 against evidence (probe notes, unit names, doc cites)
- [ ] Confirm no #170 PAC / capability mint in shipped marker path (AC9 review)

**Done when:** All AC1–AC10 have named evidence; validate green; ready for implementation review.
