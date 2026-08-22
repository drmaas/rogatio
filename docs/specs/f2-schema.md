# F2 - Schema Package

**Synthesis model:** `opencode-go/gpt-5.6-luna`
**Inputs:** primary and adversarial F2 design passes, repository overview, sequence, and F1 architecture
**Status:** Approved specification; implementation complete pending release
**Feature:** F2
**Depends on:** F1
**Enables:** F3 and later rule slices

## Problem Statement and Goals

The repository has no authoritative representation of a Rogatio project. Later packages need one strict, versioned source format and one validation boundary that can be used from Node and browser-oriented packages without silently accepting malformed or over-broad rules. F2 verifies the package as a Node ESM artifact; browser and MV3 packaging are later consumer-boundary concerns.

F2 establishes the `@rogatio/schema` package and the common version-1 project, group, and rule-matcher contract. It also centralizes bounded input policy, site-origin validation, and browser header restrictions for later rule slices.

Goals:

- Publish a strict JSON Schema for the common version-1 `.rogatio.json` document shape.
- Compile that schema with Ajv 8 using strict, non-mutating validation settings.
- Expose typed validation helpers and stable, JSON-pointer-addressed validation errors.
- Validate explicit HTTP(S) site origins and case-sensitive URL regular expressions.
- Enforce documented bounds before data reaches compiler or browser packages.
- Expose immutable request and response forbidden-header lists and case-insensitive lookup helpers.
- Preserve the F1 ESM, NodeNext, pnpm, and package-boundary conventions.

## Scope

F2 includes:

- A new `@rogatio/schema` workspace package.
- The version-1 common project document with project metadata, groups, and rule match criteria.
- The exported JSON Schema and an Ajv-compiled validator.
- Structural validation with `additionalProperties: false`, no type coercion, no defaults, and no input mutation.
- Semantic validation for globally unique IDs, effective origins, and the project-wide rule bound.
- Site-origin and URL-regex validation helpers.
- Shared bounds, resource-type names, HTTP-method names, and forbidden-header policies.
- Package and root tests, build integration, and documentation.

The F2 distribution target is Node ESM because Ajv compiles the validator at module initialization. MV3-safe standalone validator packaging is deferred to the browser/extension boundary and is not an F2 acceptance criterion.

F2 does not implement rule actions, compiler operations, browser permissions, persistence, editor behavior, extension behavior, CLI commands, runtimes, or traffic handling.

## Canonical Version-1 Common Document

The common document shape is:

```json
{
  "version": 1,
  "name": "Example project",
  "description": "Optional project description",
  "groups": [
    {
      "id": "group-main",
      "name": "Main sites",
      "origins": ["https://example.com"],
      "rules": [
        {
          "id": "rule-home",
          "name": "Home pages",
          "urlRegex": "^https://example\\.com/",
          "origins": [],
          "resourceTypes": ["main_frame"],
          "priority": 100
        }
      ]
    }
  ]
}
```

The required common fields are:

- The root `version` is exactly `1`.
- The root `name` is a non-blank string of at most 100 characters.
- The optional root `description` is at most 1,000 characters.
- `groups` is an array of at most 64 group records.
- A group has a stable `id`, non-blank `name`, `origins`, and `rules`.
- A rule has a stable `id`, non-blank `name`, case-sensitive `urlRegex`, `origins`, one or more `resourceTypes`, and an integer `priority`.
- A rule may specify one standard uppercase HTTP `method`; omission means no method restriction in the common matcher.
- A rule's effective origins are the union of its group's origins and its own origins. Every rule must have at least one effective origin.

Action-specific properties are intentionally not part of this F2 contract. They will be added with their rule slices while preserving the version-1 envelope and common matcher fields. F2 rejects unknown properties rather than accepting an unvalidated future action payload.

## Origin Policy

An origin must be an absolute HTTP or HTTPS origin:

- The scheme is exactly `http` or `https`.
- A hostname is required; localhost and IP literals are allowed.
- Userinfo, query strings, fragments, paths other than the URL origin slash, and wildcard hosts are rejected.
- An explicit port is allowed when it is a valid URL port.
- Origin strings are treated case-insensitively for semantic duplicate checks, while their source spelling is preserved because validation does not mutate input.
- Origins are bounded to 32 entries per group and per rule.

## Bounds and Enumerations

The package exports the limits as `LIMITS` so callers and tests do not duplicate numeric policy:

| Value | Limit |
| --- | ---: |
| Project groups | 64 |
| Rules per group | 256 |
| Rules per project | 4,096 |
| Origins per group or rule | 32 |
| Stable ID length | 64 |
| Project, group, or rule name length | 100 |
| Project description length | 1,000 |
| URL-regex length | 2,048 |
| Resource types per rule | 16 |
| Priority | 1 through 1,000 |

IDs use `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. Resource types use the browser-neutral names `main_frame`, `sub_frame`, `stylesheet`, `script`, `image`, `font`, `object`, `media`, `xmlhttprequest`, `ping`, `csp_report`, `websocket`, `webtransport`, `webbundle`, or `other`. Methods use `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `CONNECT`, or `TRACE`.

URL regular expressions are compiled with the ECMAScript `RegExp` constructor without flags. Invalid patterns are rejected, and no case-insensitive behavior is implied.

## Header Policy

The package exports frozen, lower-case request and response forbidden-header lists. `isForbiddenHeader(name, direction)` compares ASCII header names case-insensitively and recognizes the `proxy-` and `sec-` request-header prefixes. The helper does not modify or trim the supplied name. Header action validation and browser-specific limits remain in F11 and the extension boundary.

## Public Package API

`@rogatio/schema` provides:

- `projectSchema`: the exported draft-2020-12 JSON Schema.
- `projectValidator`: the strict Ajv-compiled structural validator.
- `validateProject(value)`: a boolean type guard covering structural and semantic validation.
- `validateProjectDetailed(value)`: a discriminated result containing either typed data or stable validation errors.
- `assertValidProject(value)`: returns typed data or throws `ProjectValidationError` with errors.
- `isSiteOrigin(value)` and `normalizeSiteOrigin(value)` for origin checks.
- `LIMITS`, resource-type and method constants, forbidden-header constants, and `isForbiddenHeader`.
- `RogatioProject`, `RogatioGroup`, `RogatioRule`, and related exported types.

Validation errors contain `instancePath`, `keyword`, `message`, and keyword parameters. Semantic errors use stable custom keywords such as `uniqueId` and `effectiveOrigin`. The validator never coerces, defaults, strips, or otherwise mutates caller-owned input.

## Functional Requirements

- **F2-FR-001:** The workspace shall contain an ESM `@rogatio/schema` package with explicit exports and a declared runtime dependency on Ajv.
- **F2-FR-002:** The package shall export a draft-2020-12 JSON Schema whose root version is exactly `1` and whose common records reject unknown properties.
- **F2-FR-003:** Structural validation shall reject wrong types, missing required fields, invalid IDs, blank labels, unsupported resource types, unsupported methods, invalid priorities, and out-of-range collection sizes.
- **F2-FR-004:** URL regular expressions shall be bounded and syntactically valid, and validation shall preserve case-sensitive ECMAScript semantics.
- **F2-FR-005:** Site origins shall accept only explicit HTTP(S) origins and reject credentials, paths, queries, fragments, wildcard hosts, and non-HTTP(S) schemes.
- **F2-FR-006:** Each rule shall have at least one effective origin after combining group and rule origins.
- **F2-FR-007:** Stable IDs shall be unique across all groups and rules in one project, and the total project rule count shall be bounded.
- **F2-FR-008:** The package shall expose frozen forbidden-header lists and case-insensitive request/response lookup without mutating names.
- **F2-FR-009:** Public validation helpers shall accept unknown JSON values and return actionable errors without throwing for ordinary invalid input.
- **F2-FR-010:** The package shall not implement action transformations, compiler behavior, browser integration, persistence, or runtime/network behavior.

## Observable Acceptance Criteria

### Valid Documents

- **F2-AC-001:** A minimal project with version `1`, a name, one origin-scoped group, and one common matcher rule validates successfully.
- **F2-AC-002:** A group origin may be reused by multiple rules, and a rule with only its own origin validates successfully.
- **F2-AC-003:** A rule with multiple resource types and an allowed uppercase method validates successfully.
- **F2-AC-004:** A valid URL regular expression remains case-sensitive when compiled by the exposed helper.

### Invalid Documents and Bounds

- **F2-AC-005:** Version values other than `1`, missing required properties, unknown properties, wrong JSON types, blank names, invalid IDs, unsupported methods, and unsupported resource types fail validation.
- **F2-AC-006:** Invalid, non-HTTP(S), credential-bearing, path-bearing, query-bearing, fragment-bearing, wildcard, and blank origins fail validation.
- **F2-AC-007:** Invalid URL regular-expression syntax and patterns above the documented maximum fail validation.
- **F2-AC-008:** A rule with no group or rule origin fails with an effective-origin error.
- **F2-AC-009:** Duplicate IDs and a project exceeding the total rule bound fail with stable semantic errors.
- **F2-AC-010:** Groups, rules, origins, resource types, labels, descriptions, priorities, and IDs at their documented maxima are accepted; values beyond them are rejected.

### API and Safety

- **F2-AC-011:** `validateProject` accepts arbitrary `unknown` values and returns `false` rather than throwing for ordinary malformed JSON-shaped values.
- **F2-AC-012:** `validateProjectDetailed` reports JSON-pointer paths and actionable keywords/messages for both Ajv and semantic failures.
- **F2-AC-013:** Calling validation does not add, remove, coerce, or reorder properties or array entries in the input object.
- **F2-AC-014:** Exported forbidden-header arrays are frozen; common request and response forbidden names match regardless of ASCII case, while unrelated names do not.
- **F2-AC-015:** `assertValidProject` returns the same typed value for valid input and throws `ProjectValidationError` containing the detailed errors for invalid input.

### Integration and Boundaries

- **F2-AC-016:** `pnpm install --frozen-lockfile`, formatting, linting, strict typechecking, root build, package tests, and root validation pass with the new package.
- **F2-AC-017:** The built schema package executes as an ESM Node module and its dependency on Ajv is declared rather than obtained transitively.
- **F2-AC-018:** The package exports no compiler, browser, editor, extension, CLI, runtime, traffic-capture, telemetry, credential, or hosted-service behavior.

## Security, Privacy, and Operational Requirements

- Validation is local and performs no network, filesystem, telemetry, or credential operation.
- Origin and collection bounds prevent accidental unbounded input from entering later consumers.
- Strict unknown-property rejection avoids silently accepting fields that a later package might misinterpret.
- Ajv is an exact, lockfile-controlled runtime dependency in the schema package; no broad install-script permissions are added.
- The verified F2 build target is Node ESM; a later MV3 package must not load the runtime-compiled validator under an extension CSP and must provide an approved standalone/browser packaging strategy.
- Error output contains input locations and validation reasons only; it must not echo credentials or persist the rejected document.

## Migration and Compatibility

The repository is greenfield and no pre-F2 `.rogatio.json` files are supported. The schema version is fixed at `1` for this feature. Future rule slices may add validated action variants without changing the common envelope; a future incompatible file-format change requires a new explicit schema version and migration decision.

## Assumptions and Open Questions

- The canonical root field is `version`, with value `1`; no alternate version field is accepted.
- Project, group, and rule names are user-facing labels and are not required to be unique; stable IDs provide identity.
- Group and rule origin arrays are present even when empty so the effective-origin rule is explicit and serialization is deterministic.
- Enablement is not stored in the F2 common schema; browser-core owns lifecycle and enablement state.
- Action-specific rule data is deliberately deferred to later vertical slices.

## Expected Verification Evidence

- `packages/schema` source, package metadata, tests, and explicit exports.
- The exported schema and Ajv validator with no mutation/coercion settings.
- Boundary tests for origins, regexes, bounds, IDs, effective origins, and forbidden headers.
- Root build and validation evidence, including frozen lockfile and emitted ESM schema execution.
- Updated architecture, README, and agent orientation documents describing the F2 boundary.
- No generated build output, dependencies, credentials, network handlers, or future package implementations committed.
