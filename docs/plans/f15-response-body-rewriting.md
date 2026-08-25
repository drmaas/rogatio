# F15 — Response-Body Rewriting Implementation Plan

**Specification:** `docs/specs/f15-response-body-rewriting.md` (approved 2026-08-24).
**Scope guardrail:** Do not implement F16 request-body trust lifecycle or F17 request-body rewriting.

## Ordered tasks

1. **Schema:** extend `packages/schema/src/types.ts`, `limits.ts`, `schema.ts`, and `validation.ts` with `ResponseBodyAction`, ordered replacements, strict bounds, regex validation, and stable diagnostics. Covers AC-001/002/010.
2. **Compiler:** extend compiler types, compilation, exports, and tests with deterministic `ResponseBodyOperation`. Covers AC-001/010.
3. **Transformation core:** add bounded UTF-8/content-type validation and ordered global replacements in `packages/runtime`, reusing F14 limits, outbound credential stripping, redirects rejection, exact revalidation, and stable errors. Covers AC-005/006/009.
4. **Interception provider:** add the capability-gated TLS/CA/PAC provider behind F14 lifecycle/interception seams with explicit start/stop, collision detection, scoped origins, and exact target checks. Covers AC-004/005/007/008.
5. **Native control:** extend F14 metadata-only lifecycle/control state without transferring bodies. Covers AC-004/008/009.
6. **Extension:** add operation validation, statuses, explicit provider lifecycle commands, scoped routing install/remove, permission handling, and state projection. Covers AC-004/005/007/008/010.
7. **Editor/CLI:** add ordered replacement editor fields and validation, host registration, and deterministic offline preview. Covers AC-003/011.
8. **Verification/docs:** run `pnpm validate`, review the complete diff, perform fresh-context review rounds, and synchronize README, architecture, and workflow evidence. Covers AC-010/012.

## Rollback

Revert F15 schema/compiler/runtime/provider/extension/editor/CLI changes. Schema remains v1 and existing projects remain valid; no F16/F17 migration is required.
