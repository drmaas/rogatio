# URL Capture Substitution Plan

> Status: approved — implemented
> Audience: hybrid
> Issue: #197

## 1. Shared capture utility

Create a pure compiler/schema-facing utility for counting URL captures, parsing `$N` and `$$`, substituting captures, and preserving stable diagnostics. Reuse the existing capture-count rules. Cover escaped parentheses, non-capturing groups, lookarounds, malformed templates, missing optional groups, and the nine-group bound.

Covers: REQ-001, REQ-002, REQ-008, REQ-009; AC-002, AC-003.

## 2. Schema and browser validation

Extend authoritative Node and browser-safe validation to inspect redirect, query, header, request-body replace, and response-body replace fields. Keep body regex replacement fields on their existing body-capture semantics. Update field types and comments.

Covers: REQ-003 through REQ-008; AC-001, AC-002, AC-004, AC-007, AC-010.

## 3. Compiler operation metadata

Carry enough validated action metadata for downstream execution to identify dynamic capture-dependent operations without applying captures at compile time. Preserve source order and serialized action data.

Covers: REQ-009, REQ-010; AC-005, AC-008.

## 4. Redirect and DNR projection

Normalize `$N` redirect references to Chrome's `\\N` representation. Retain existing `\\N` input. Add tests for equivalent outputs and ensure unsupported dynamic query/header values are not installed as literal DNR strings.

Covers: REQ-003, REQ-004, REQ-005; AC-004, AC-005.

## 5. Runtime transformations

Add URL-aware substitution to request-body and response-body replace paths. Add the narrow runtime path required for dynamic query/header values, or expose a stable unsupported state when platform capability is absent. Revalidate URL and rule authority before transformation. Preserve size, encoding, forbidden-header, and regex limits.

Covers: REQ-004 through REQ-007, REQ-010; AC-005 through AC-008.

## 6. Dry-run previews

Extend the dry-run preview contract to expose captures and substituted action summaries for supported fields. Keep all dry-run operations offline and side-effect free.

Covers: REQ-011; AC-009.

## 7. Editor and user-facing surfaces

Update rule-type validation/help text and stable diagnostics. Ensure the editor does not normalize authored source unexpectedly and explains redirect compatibility and body regex semantics.

Covers: REQ-012; AC-010, AC-011.

## 8. Documentation and sample

Update architecture and relevant rule guides, redirect/query/header/request-body/response-body references, AI prompt text, and `samples/basic`. Document syntax, compatibility, limits, and runtime-backed behavior.

Covers: REQ-012; AC-011.

## 9. Verification

Run focused schema/compiler/runtime/dry-run/editor/extension tests, build and browser checks, then `pnpm validate`. Review the final diff with a fresh context. Fix findings and rerun validation.

Covers: AC-012.
