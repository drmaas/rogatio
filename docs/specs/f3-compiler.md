# F3 - Compiler Package

**Synthesis model:** `opencode-go/gpt-5.6-luna`
**Adversarial model:** `opencode-go/minimax-m3`
**Status:** Released in PR #3 as commit `63bde12eeb497ee52cc7094f451c83cfd0785d4`
**Feature:** F3
**Depends on:** F2
**Enables:** F4, F5, and later rule-type compiler slices

## Problem Statement and Goals

F2 defines and validates the common version-1 `.rogatio.json` envelope, but later browser and platform packages need a stable browser-neutral representation of its matcher criteria. F3 provides that representation and a deterministic compiler boundary without adding action semantics before the corresponding rule slices exist.

Goals:

- Add a private ESM `@rogatio/compiler` workspace package.
- Convert each validated F2 rule into exactly one browser-neutral matcher operation.
- Normalize effective origins without broadening their authority or mutating source input.
- Preserve the exact case-sensitive regular-expression source, resource types, optional method, and priority semantics.
- Expose stable, structured compiler diagnostics for invalid input.
- Keep compilation pure, deterministic, serializable, and independent of browser or runtime APIs.
- Preserve the explicit `schema -> compiler` dependency direction and F1/F2 tooling conventions.

## Scope and Non-Goals

F3 includes:

- The `@rogatio/compiler` package and its public compile API.
- A data-only matcher intermediate representation (IR).
- F2 validation integration and stable diagnostic mapping.
- Effective-origin normalization and deterministic set-field ordering.
- Compiler package tests, root build and validation integration, and documentation.

F3 does not include:

- Rule actions, action payloads, or action registries.
- URL matching or regular-expression execution.
- Priority precedence, conflict resolution, or rule enablement.
- Browser APIs, WebExtensions, Declarative Net Request, permissions, or browser IDs.
- Editor, CLI, runtime, persistence, filesystem, network, telemetry, or traffic-capture behavior.
- MV3-safe packaging; the verified F2/F3 distribution target remains Node ESM until a browser boundary approves a standalone strategy.

## Actors and Entry Points

Consumers such as the future editor, CLI, browser-core, and browser adapters call `compileProject` with an unknown value read or assembled at their boundary. The compiler invokes `validateProjectDetailed` from `@rogatio/schema`; callers do not receive a typed-input escape hatch that could bypass F2 semantic validation.

The package is built and tested as a Node ESM artifact. It has no side effects beyond local validation and transformation.

## Public API and IR

The package exports the following conceptual TypeScript API:

```ts
export interface NormalizedMatcher {
  readonly urlRegex: {
    readonly source: string;
    readonly flags: "";
  };
  readonly origins: readonly string[];
  readonly resourceTypes: readonly ResourceType[];
  readonly priority: number;
  readonly method?: HttpMethod;
}

export interface MatcherOperation {
  readonly kind: "matcher";
  readonly groupId: string;
  readonly ruleId: string;
  readonly matcher: NormalizedMatcher;
}

export type CompilerDiagnosticCode =
  | "schema.required"
  | "schema.unknown-property"
  | "schema.invalid-type"
  | "schema.invalid-format"
  | "schema.invalid-value"
  | "schema.out-of-range"
  | "schema.invalid-structure"
  | "schema.duplicate-id"
  | "schema.no-effective-origin"
  | "schema.rule-limit"
  | "compiler.invariant";

export interface CompilerDiagnostic {
  readonly code: CompilerDiagnosticCode;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type CompileResult =
  | {
      readonly ok: true;
      readonly operations: readonly MatcherOperation[];
      readonly diagnostics: readonly CompilerDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly operations: readonly [];
      readonly diagnostics: readonly CompilerDiagnostic[];
    };

export function compileProject(value: unknown): CompileResult;
```

The successful diagnostics array is empty for the current F3 scope. Warnings are not emitted yet; the severity field is part of the forward-compatible diagnostic shape.

## Compilation Semantics

1. Validate the input with F2's complete `validateProjectDetailed` API. Structural and semantic failures are mapped to compiler diagnostics in deterministic order. Ordinary malformed JSON-shaped values fail without throwing.
2. Traverse groups and rules in their source array order and emit one `MatcherOperation` for each rule. Rules with identical matcher values remain separate because their stable IDs are distinct.
3. Combine group origins followed by rule origins. Normalize each with F2's `normalizeSiteOrigin`, deduplicate by normalized origin, and sort the resulting strings with deterministic JavaScript code-unit ordering. Do not create wildcard origins, remove schemes, or replace rule origins with group origins.
4. Copy the exact `urlRegex` source into `{ source, flags: "" }`. Do not execute, anchor, rewrite, case-fold, or convert it to a `RegExp` instance.
5. Emit resource types in the canonical order of F2's `RESOURCE_TYPES` constant. Every validated source value appears exactly once; no browser capability filtering occurs.
6. Copy a present uppercase method unchanged. Omit `method` when it is absent; omission means no method restriction.
7. Copy the validated integer priority unchanged. Do not sort operations or assign precedence based on priority or source order.
8. Allocate new operation, matcher, and array values. The output must be JSON-serializable and must not alias caller-owned arrays or contain `RegExp`, `URL`, `Set`, `Map`, callbacks, timestamps, random IDs, or environment-dependent values.

The compiler emits no partial operations. Any validation error or post-validation invariant failure returns `ok: false`, an empty operations array, and one or more diagnostics.

## Diagnostic Contract

Diagnostics retain the F2 `instancePath` as the compiler `path`, including an empty string for a root error. Diagnostic parameters are copied structured metadata and must not echo rejected input values or credentials. Ajv prose is not a stable compiler API; messages are generated from the stable code categories.

The default mapping is:

| F2 issue keyword | Compiler code |
| --- | --- |
| `required` | `schema.required` |
| `additionalProperties` | `schema.unknown-property` |
| `type` | `schema.invalid-type` |
| `format` | `schema.invalid-format` |
| `const`, `enum`, `pattern` | `schema.invalid-value` |
| `minLength`, `maxLength`, `minItems`, `maxItems`, `minimum`, `maximum`, `uniqueItems` | `schema.out-of-range` |
| `ownProperties` | `schema.invalid-structure` |
| `uniqueId` | `schema.duplicate-id` |
| `effectiveOrigin` | `schema.no-effective-origin` |
| `maxRulesPerProject` | `schema.rule-limit` |

An unrecognized structural keyword maps to `schema.invalid-value`; a failure in an internal post-validation invariant maps to `compiler.invariant` at the relevant JSON-pointer path. Diagnostic ordering is deterministic by path, code, and message using code-unit comparison.

## Functional Requirements

- **F3-FR-001:** The workspace shall contain a private ESM `@rogatio/compiler` package whose only product dependency is `@rogatio/schema`.
- **F3-FR-002:** Compilation shall invoke complete F2 validation and shall not treat the ordinary `RogatioProject` interface as proof that validation occurred.
- **F3-FR-003:** A valid project shall produce exactly one matcher operation per source rule with stable group and rule IDs.
- **F3-FR-004:** Operations shall contain only the documented matcher IR and no action or browser-specific fields.
- **F3-FR-005:** Effective origins shall be normalized, unioned, deduplicated, and deterministically ordered using F2 policy.
- **F3-FR-006:** Regex source, resource types, optional method, and priority shall preserve the documented F2 semantics without execution, coercion, filtering, or browser checks.
- **F3-FR-007:** Source operation order and priority handling shall be explicit: source group/rule order is preserved, priority is carried unchanged, and no precedence is invented.
- **F3-FR-008:** Failure is atomic: invalid, sparse, cyclic, over-limit, unknown, duplicate, or semantically invalid input returns stable diagnostics and no operations.
- **F3-FR-009:** Diagnostics shall expose stable codes, error severity, JSON-pointer paths, safe structured parameters, and deterministic ordering.
- **F3-FR-010:** Compilation shall not mutate input; output arrays and records shall be detached and serializable.
- **F3-FR-011:** Root build and validation shall verify the emitted Node ESM compiler artifact and enforce the `schema -> compiler` dependency direction.
- **F3-FR-012:** No F4 or later behavior shall be introduced through actions, browser APIs, permissions, persistence, runtime, telemetry, network, or traffic handling.

## Observable Acceptance Criteria

### Operations and Normalization

- **F3-AC-001:** A valid F2 project produces exactly one matcher operation for every source rule, including rules with identical matcher fields.
- **F3-AC-002:** Every operation preserves the source group ID and rule ID and contains no action, browser, permission, enablement, or runtime fields.
- **F3-AC-003:** Group and rule origins combine as the F2 effective-origin union; case variation, default ports, IPv6, HTTP versus HTTPS, and rule-only origins are tested.
- **F3-AC-004:** Origins are normalized, deduplicated, and sorted deterministically without mutating source arrays.
- **F3-AC-005:** Regex source is byte-for-byte preserved as a string with empty flags and is never executed or rewritten.
- **F3-AC-006:** Resource types use canonical shared ordering; methods are preserved or omitted; priorities are copied unchanged.
- **F3-AC-007:** A rule with many origins and resource types still produces one operation rather than a Cartesian expansion.

### Failure and Diagnostics

- **F3-AC-008:** Unknown values, wrong versions, missing fields, unknown properties, duplicate IDs, empty effective origins, invalid formats, sparse or inherited arrays, cycles, and over-limit projects fail without throwing, return zero operations, and do not return partial output.
- **F3-AC-009:** Diagnostics contain the documented stable code, `error` severity, JSON-pointer path, safe parameters, and deterministic order; tests do not rely on Ajv prose.
- **F3-AC-010:** A failure in a post-validation compiler invariant produces `compiler.invariant` and zero operations.

### Purity and Integration

- **F3-AC-011:** Repeated compilation and compilation of an equivalent deep clone produce identical JSON output; frozen and unfrozen inputs remain unchanged, and output arrays do not alias source arrays.
- **F3-AC-012:** The package's emitted Node ESM module runs through the root build and direct validation, with `@rogatio/schema` declared explicitly and no downstream dependency.
- **F3-AC-013:** The negative dependency fixture and manifest/source checks prove the intended package direction after the compiler package exists.
- **F3-AC-014:** Tests and scope audits prove that redirect, query, header, mock, body, runtime, permission, DNR, extension, editor, CLI, and dry-run behavior is absent.

## Security, Privacy, and Operations

- Compilation is local and pure: no filesystem, network, credential, telemetry, persistence, browser, or runtime operation is permitted.
- F2 remains the authority for input validation, bounds, origin policy, and forbidden-header constants; F3 must not broaden origin authority or accept action payloads.
- No user input, credentials, or rejected documents are echoed into diagnostics beyond safe F2 parameter metadata.
- Regexes are not executed by F3, and F3 makes no claim that F2's bounded syntax is safe for future matching performance.
- Node ESM is the verified distribution target. Browser/MV3-safe packaging is a later boundary decision.

## Compatibility and Migration

F3 is greenfield and introduces no migration. The matcher IR is a new internal package contract and is versioned through its discriminated `kind` and the enclosing package API. Future action slices may extend the compiler with separately specified operation kinds while preserving the common matcher semantics; they must not add an unvalidated `action: unknown` passthrough.

## Alternatives and Decisions

- **Flat matcher IR:** Chosen. It maps one source rule to one browser-neutral operation, is easy for later adapters to consume, and avoids coupling group lifecycle to the compiler.
- **Group-preserving compiled tree:** Rejected for F3. It duplicates source hierarchy and forces later browser adapters to flatten it without providing action semantics.
- **Custom or standalone compiler validation:** Rejected for F3. The compiler uses the complete F2 boundary; a standalone generated validator is deferred until a browser-safe packaging decision is approved.
- **Priority sorting or precedence resolution:** Rejected. F2 defines a priority bound but not conflict semantics, so F3 carries the value and preserves source order.

## Assumptions and Open Questions

- F2's `normalizeSiteOrigin` is the authority for origin canonicalization.
- F2's `RESOURCE_TYPES` order is the canonical output order.
- The current compiler has only error diagnostics; warning-producing conditions require a later specification.
- A future browser boundary will decide how to package the Node-only F2/F3 runtime safely for MV3.

## Expected Verification Evidence

- `packages/compiler` source, package metadata, tests, and explicit exports.
- Golden IR tests for normalization, order, identity, exact regex semantics, and no action fields.
- Diagnostic mapping, failure atomicity, purity, deep-clone determinism, and dependency-direction tests.
- Root frozen install, format, lint, strict typecheck, build, Vitest, negative fixtures, emitted compiler import, and browser smoke validation.
- Updated architecture, README, and agent orientation documents describing the released F2 and F3 boundaries.
- No generated build output, dependencies, credentials, downstream package stubs, browser behavior, or future rule implementation committed.
