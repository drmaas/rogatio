# F9 Workflow Log — Redirect Rules

## Stage 0 — Orientation & tier

- Task: `use sdd to implement F9` (Redirect rules).
- Feature definition: "Absolute destination with controlled regex capture substitution."
- Dependencies confirmed in `sequence.md`: F7 (extension shell) + F5 (editor).
- **Tier: Free.** User selected Free tier. No separate model-call tool exposed in this session; the
  SDD is executed as a single-model session (hy3-free) running distinct role passes (brainstorm,
  architecture, spec, plan, tests, implementation, verification, review, docs) with a fresh-context
  self-review at Stage 9. Each role pass is separated by a `compress` to keep context sharp.
- Worktree: `feature/f9-redirect-rules`
  (`/home/drmaas/.local/share/opencode/worktree/8ab719d1d66b959f03fa7887060b82ec0f0fdb35/feature/f9-redirect-rules`).
  All edits happen in the worktree.

## Stage 1 — Brainstorm (synthesized, single-model)

- F9 is the first action-bearing rule type. Existing `RogatioRule` is actionless; F7 surfaces
  actionless matchers as `"unsupported"`.
- Established the redirect contract: optional `type:"redirect"` on the rule; `redirect.destination`
  absolute `http`/`https` URL with `\1`..`\9` backrefs to `urlRegex` capture groups.
- Confirmed F9 must implement the real DNR `RuleInstallerAdapter` (F7 deferred it).
- Backref syntax chosen: `\N` (1–9) to match Chrome DNR `regexFilter` substitution semantics.

## Stage 2 — Architecture synthesis

- Introduce `RogatioOperation = MatcherOperation | RedirectOperation` union; ripple to compiler
  `CompileResult`, browser-core `status.ts`/`install.ts`/`types.ts`.
- New extension `dnr.ts`: `translateRedirectToDnr` + `createDnrInstaller`; add `declarativeNetRequest`
  to `ChromeApi`.
- Editor: rule-type `<select>` + `createRedirectRuleType()` shipped from `@rogatio/editor` (imported
  by both CLI and extension).
- Status: redirect op enabled+installed → `"active"`; actionless matcher → `"unsupported"`;
  installed ids sourced from `installer.current()`.
- Validation mirrored in both `schema/validation.ts` and `extension/browser-schema.ts`.

## Stage 3 — Specification

- Spec written: `docs/specs/f9-redirect-rules.md`.

## Stage 4 — Human review gate (APPROVED)

- Spec `docs/specs/f9-redirect-rules.md` presented and approved.

## Stage 5 — Implementation plan

- `docs/plans/f9-redirect-rules.md` written with step-by-step plan.

## Stage 6 — Tests first (COMPLETED)

- 6 test files written:
  - `packages/schema/test/redirect.test.ts` (12 tests: valid/invalid destination, backrefs, limits, countCapturingGroups)
  - `packages/compiler/test/redirect.test.ts` (2 tests: redirect→RedirectOperation, actionless→MatcherOperation)
  - `packages/extension/test/dnr.test.ts` (3 tests: translateRedirectToDnr, createDnrInstaller install, missing DNR API)
  - `packages/extension/test/redirect-status.test.ts` (2 tests: installed redirect→active, matcher→unsupported)
  - `packages/extension/test/browser-schema-redirect.test.ts` (6 tests: mirror of node schema validation)
  - `packages/editor/test/redirect.test.ts` (4 tests: matches, validate well-formed, missing destination, backref exceed)

## Stage 7 — Implementation (COMPLETED)

- **Schema**: `types.ts` (RuleType, RedirectAction, RogatioRule.type/redirect), `limits.ts` (+maxRedirectDestinationLength, maxCaptureGroups), `schema.ts` (type enum, redirect object, if/then), `validation.ts` (validateRedirectDestination, countCapturingGroups in semanticIssues, Ajv strictRequired:false), `index.ts` exports.
- **Compiler**: `types.ts` (RedirectOperation, RogatioOperation union), `compile.ts` (emit RedirectOperation on type==="redirect"), `index.ts` exports.
- **browser-core**: `types.ts` (widened RuleInstallerAdapter, RuleStatusInput, computeRuleStatuses/install to RogatioOperation[]), `status.ts`, `install.ts`.
- **Editor**: `editor.ts` (COMMON_RULE_FIELDS + type, rule-type select rendering, updateCommonField clears action fields on type change), `rule-types/redirect.ts` (createRedirectRuleType), `index.ts` exports.
- **Extension**: `dnr.ts` (translateRedirectToDnr, createDnrInstaller), `chrome.ts` (declarativeNetRequest optional), `background.ts` (real installer), `service-worker.ts` (operationStatuses: redirect→active, matcher→unsupported, projectState uses installer.current()), `browser-schema.ts` (local validateRedirectDestination + countCapturingGroups, exports validateRedirectDestination for build alias), `extension-page-entry.ts` (register redirect rule-type).
- **CLI**: `edit.ts` (register redirect rule-type).

## Stage 8 — Verification (COMPLETED)

Canonical validation evidence:
- `pnpm test`: **35 test files, 241 tests PASS** (includes 29 new F9 tests)
- `pnpm format:check`: **PASS** (145 files, 0 fixes)
- `pnpm typecheck`: **PASS** (0 errors)
- `pnpm build`: **PASS** (11 ESM artifacts built)
- `pnpm lint` (scoped to changed files): **PASS** (1 file with biome-ignore for AJV `then` keyword; assign-in-expression fixed in both schema and browser-schema)
- Note: full-repo `pnpm lint` OOMs in sandbox (environment limitation); scoped lint on 27 changed files passes.

## Stage 9 — Independent review (COMPLETED)

- Fresh-context self-review of critical paths:
  - `extension/src/dnr.ts`: translateRedirectToDnr builds correct DNR rule; createDnrInstaller tracks Map, guards undefined DNR API.
  - `packages/compiler/src/compile.ts:210–217`: emits RedirectOperation correctly.
  - `packages/schema/src/schema.ts:99–118`: if/then with required:["type"] correctly gates redirect requirement.
  - `packages/editor/src/editor.ts:1303–1320`: updateCommonField clears action fields when type changes/clears.
  - `packages/extension/src/service-worker.ts:188–210`: operationStatuses forces matcher→unsupported, redirect keeps active/disabled/needs-permission/error.

## Stage 10 — Documentation (COMPLETED)

- `docs/architecture.md`: updated with F9 Redirect Rules architecture section (inserted before F11).
- `docs/f9-workflow.md`: this log updated with verification evidence.
- `docs/f9-workflow.md` (main repo copy) updated.

## Stage 11 — Release (PENDING)

- Awaits explicit user authorization for commit/PR/merge.
- Worktree audit: no generated output, secrets, or unrelated changes in tracked/untracked.
