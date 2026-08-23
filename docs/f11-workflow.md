# F11 — Workflow Log (Request & Response Header Rules)

Tier: **Free** (user-selected). Single-model session: `opencode/hy3-free` served every
role (brainstorm, architecture, spec, plan, tests, implementation, verification, review,
documentation). The OpenCode Zen / OpenRouter free catalog IDs were not separately
reachable in this environment, so each stage was performed as a distinct self-contained
pass by the session model rather than substituting a paid provider. Fallback chain in the
free routing table was therefore not exercised; this is recorded, not silently substituted.

## Stage status

- [x] Stage 0 — Worktree. Clean `main` at `acf4c2c`; single worktree. Feature branch
  `feature/f11-header-rules` will be created via the opencode-worktree plugin before edits.
- [x] Stage 1 — Brainstorm (ephemeral). Synthesized below; no brainstorm file retained.
- [x] Stage 2 — Architecture. Section appended to `docs/architecture.md`.
- [x] Stage 3 — Specification. `docs/specs/f11-header-rules.md`.
- [ ] Stage 4 — Human review gate. **Pending approval.**
- [ ] Stage 5 — Plan. `docs/plans/f11-header-rules.md`.
- [ ] Stage 6 — Tests first.
- [ ] Stage 7 — Implementation.
- [ ] Stage 8 — Verification.
- [ ] Stage 9 — Independent review (fresh-context self-review).
- [ ] Stage 10 — Documentation.
- [ ] Stage 11 — Release (requires explicit authorization).

## Key findings (from codebase exploration)

- No rule-type discriminant exists yet. `schema/src/schema.ts` `rule` $def is matcher-only
  with `additionalProperties: false`. `RogatioRule` (`schema/src/types.ts`) has no `type`.
- `compiler` emits only `MatcherOperation` (kind `"matcher"`, actionless). `compileOperations`
  is the single emission site.
- `extension/src/projection.ts` `projectMatchers` hardwires `installable: false`.
  `service-worker.ts` `operationStatuses` forces every `active` status to `unsupported`
  (the F7 actionless pattern). This must become conditional for installable header ops.
- `extension/src/browser-schema.ts` is a hand-duplicated copy of the schema that MUST be
  updated in lockstep (F11 validation must be mirrored there).
- `browser-core` `RuleInstallerAdapter`, `computeDesiredRules`, `computeRuleStatuses`,
  `computeDeclaredOrigins` are pinned to `MatcherOperation[]` and access `operation.matcher`.
  A `HeaderOperation` carrying the same `matcher` keeps that logic intact via a union.
- `editor` already exposes `RuleTypeFieldExtension` (matches/mount/validate); F11 supplies a
  header extension; no editor-core change is needed except an optional `type` hint.
- Forbidden-header infrastructure (`schema/src/headers.ts`) was pre-built in F2 for F11.
- F9 (redirect) and F10 (query) are NOT implemented; F11 has no sibling slice to copy.

## Open questions surfaced to user (gate)

1. Introduce the `type` discriminant now (only `"header"` valid) and retire the
   actionless-matcher concept as a produced operation? (Recommended — clean forward path
   for F9/F10; requires updating compiler/extension/editor tests that currently create
   matcher-only rules.)
2. Should the editor host set `type: "header"` via the header `RuleTypeFieldExtension`
   (no editor-core change) — recommended.
3. DNR `modifyHeaders` only permits one header modification per rule in F11 (set/append/remove
   a single named header); multi-header rules deferred. Confirm single-header scope.
