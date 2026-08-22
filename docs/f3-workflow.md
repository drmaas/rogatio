# F3 Workflow Log

## Scope and Preflight

- **Feature:** F3 - `compiler` package
- **Base commit:** `87f96a2`
- **Branch:** `feature/f3-compiler`
- **Worktree:** `/home/drmaas/Projects/github/drmaas/rogatio-f3`
- **Implementation authorization:** The user's sequential F1/F2/F3 request authorizes implementation, subject to the SDD specification approval gate.
- **Release authorization:** The user explicitly authorized commit, push, pull request, merge, and worktree cleanup for F1, F2, and F3. Confirmation is still required immediately before deleting this worktree.

## Stage Status

- [x] Stage 0 - isolated worktree and model availability preflight
- [x] Stage 1 - primary and adversarial brainstorming; raw outputs remain ephemeral
- [x] Stage 2 - architecture synthesis in `docs/architecture.md`
- [x] Stage 3 - proposed specification in `docs/specs/f3-compiler.md`
- [x] Stage 4 - human approval for implementation scope; approved by the user in this session
- [x] Stage 5 - implementation plan in `docs/plans/f3-compiler.md`
- [x] Stage 6 - tests first; focused suite was intentionally red before source creation
- [x] Stage 7 - implementation
- [x] Stage 8 - verification and evidence
- [x] Stage 9 - independent fresh-context review; rounds completed: 3 of 3
- [x] Stage 10 - documentation updates after behavior stabilized
- [ ] Stage 11 - release actions

## Model Roles

- Luna (`opencode-go/gpt-5.6-luna`): primary brainstorm, architecture/specification synthesis, tests, and implementation.
- Minimax M3 (`opencode-go/minimax-m3`): adversarial brainstorm.
- GLM 5.3 (`opencode-go/glm-5.3`): implementation plan and independent review.
- Hy3 (`opencode-go/hy3`): verification and documentation.
- Model availability was verified at the overall workflow start with `opencode models opencode-go`; no fallback was needed.

## Brainstorm Synthesis

The primary proposal compared a flat matcher IR with a group-preserving compiled tree. The flat IR was selected because it emits one operation per rule, maps directly to later browser adapters, and avoids assigning group lifecycle responsibilities to the compiler. The adversarial pass required an explicit operation shape, complete F2 validation rather than trusting the ordinary TypeScript interface, atomic failure, defined ordering and priority behavior, stable diagnostic codes, and a Node-only packaging boundary inherited from F2.

F2's common envelope has no action field, so F3 emits only data-only matcher operations. It does not invent a no-op action, execute regular expressions, expand origin/resource-type combinations, sort by priority, or add browser-specific fields. Later rule slices will add their own specified action operations.

## Proposed Architecture Decisions

- `@rogatio/compiler` depends only on `@rogatio/schema` and exposes `compileProject(value: unknown)`.
- The compiler invokes F2's complete structural and semantic validation and returns no partial operations on failure.
- One `MatcherOperation` is emitted per source rule. Group/rule source order is preserved; priority is carried unchanged and has no F3 precedence semantics.
- Effective origins are normalized with F2, unioned, deduplicated, and sorted with deterministic code-unit ordering. Resource types use the shared `RESOURCE_TYPES` order. Regex source is copied exactly with empty flags; an omitted method remains omitted.
- Diagnostics have stable codes, `error` severity, JSON-pointer paths, safe structured parameters, and deterministic ordering. Ajv prose is not exposed as the compiler contract.
- Output is fresh, plain, and serializable. F3 performs no browser, action, runtime, filesystem, network, persistence, telemetry, or traffic-capture work.
- The verified distribution target is Node ESM; MV3-safe packaging remains a later browser-boundary decision.

## Approval Gate

The implementation plan, tests, and production code must not be written until the user explicitly approves `docs/specs/f3-compiler.md` and the architecture decisions above.

Approval recorded: the user selected "Approve and continue" for the F3 compiler specification and architecture decisions. The implementation plan may now be written.

The approved implementation plan was recorded in `docs/plans/f3-compiler.md`. It preserves the package boundary, requires tests before production source, and limits F3 to the validated matcher IR and stable diagnostics.

Tests were added before compiler source in `packages/compiler/test/compiler.test.ts`. After the existing F1/F2 artifacts were built, `pnpm exec vitest run packages/compiler/test/compiler.test.ts` failed as expected with `Cannot find module '../src/index.js'`; no compiler tests executed until the implementation stage.

## Implementation and Verification Evidence

- The private `@rogatio/compiler` package depends only on `@rogatio/schema` and exposes `compileProject(value: unknown)` plus the documented matcher and diagnostic types.
- Compilation uses complete F2 validation, emits one fresh matcher operation per rule, normalizes effective origins, orders resource types canonically, preserves regex/method/priority semantics, and returns no partial operations on failure.
- `pnpm install --frozen-lockfile` passed.
- `pnpm validate` passed: format and lint checked 41 files, strict typecheck passed, five ESM artifacts built, 34 Vitest tests passed (17 compiler tests), three intentional TypeScript fixtures failed as expected, emitted schema/compiler imports passed, and one Chromium browser test passed.
- The changed negative fixture now targets the absent downstream `@rogatio/browser-core` package; package metadata and validation checks enforce `schema -> compiler` with no downstream dependency.

## Hardening and Review Record

- Review round 1 passed after the compiler implementation review; it identified the need for stable F2 snapshots, explicit invariant paths, deterministic diagnostic tie-breaking, frozen shared constants, and complete CI validation.
- Review round 2 found one invalid CI indentation and accessor/proxy instability. The workflow indentation was corrected, F2 and compiler inputs were changed to stable own-data snapshots, custom array extensions/cycles are rejected, and the F2 release metadata was completed.
- Review round 3 passed with no blocking or actionable implementation findings. A priority-order regression was added so unequal priorities prove source order is preserved. Remaining gaps are non-blocking: the invariant-path catch branch is defensive and has no direct fault-injection test, and the broader validation script does not duplicate every package metadata assertion already covered by source and manifest checks.
- The final review confirmed the private ESM boundary, dependency direction, F2 validation use, atomic failures, normalization, diagnostics, CI, generated-file hygiene, and exclusion of browser/runtime/action behavior. MV3-safe packaging remains intentionally deferred.
