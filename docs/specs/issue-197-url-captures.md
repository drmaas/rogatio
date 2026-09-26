> Status: frozen 2026-09-25

# URL Capture Substitution

> Status: approved
> Audience: hybrid
> Issue: #197

## Problem

Rogatio matches requests with `urlRegex`, but only redirect destinations can currently reference captured URL groups, and redirects use Chrome's `\\1` syntax. Query values, header values, and body replacement fields cannot reuse values captured from the matched URL. This prevents common dynamic rewrite workflows and is inconsistent with the AI-assist examples.

## Goals

- Provide one documented `$1`–`$9` URL-capture contract across supported action fields.
- Preserve compatibility with existing redirect `\\1`–`\\9` values.
- Keep rule execution typed, bounded, deterministic, local-first, and free of arbitrary user JavaScript.
- Preview substitutions in the offline dry-run when a test URL is supplied.
- Reach comparable dynamic rewrite functionality to Requestly while retaining Rogatio's stricter security and reproducibility model.

## Scope

### Requirements

**REQ-001 — Canonical syntax.** Authors may use `$1` through `$9` for captures from the rule's `urlRegex` and `$$` for a literal dollar sign. Named captures and references beyond group 9 are not supported.

**REQ-002 — Capture source.** Captures are produced by matching the complete request URL against the rule's `urlRegex`. Captures are not taken from origins, methods, resource types, dry-run case fields, or action-specific regexes.

**REQ-003 — Redirect compatibility.** Redirect destinations accept `$N`. Existing `\\N` redirect references remain accepted and are normalized to the platform representation at compile/install time.

**REQ-004 — Query values.** Query `set` values support `$N`; query remove operations do not accept values. Dynamic query transformations must not be installed as static literals when the selected browser path cannot evaluate captures per request.

**REQ-005 — Header values.** Header `set` and `append` values support `$N`. Header names and remove operations do not support capture substitution. Existing forbidden-header and value bounds remain authoritative.

**REQ-006 — Body replace values.** Request-body and response-body replace-mode bodies support `$N` and `$$`.

**REQ-007 — Body regex semantics.** Request-body and response-body regex replacement fields retain their existing regex-capture semantics. URL captures are not mixed with body-pattern captures in the first implementation. This behavior is documented and URL captures in regex-mode replacement fields are rejected or explicitly diagnosed rather than silently misinterpreted.

**REQ-008 — Shared validation.** Schema validation finds capture references in every supported action field, counts capturing groups using the existing parser rules, and reports stable field-specific diagnostics when a reference exceeds the URL pattern's capture count or uses malformed syntax.

**REQ-009 — Shared substitution.** Compiler/runtime/platform code uses one bounded substitution contract rather than separate ad hoc parsers. Missing optional captures follow standard JavaScript replacement behavior and resolve to an empty string.

**REQ-010 — Runtime authority.** Runtime-backed substitution re-matches the URL and revalidates rule authority before body, query, or header transformation. Browser-provided match data is not a security boundary.

**REQ-011 — Dry-run previews.** Offline dry-run calculates URL captures for matched cases and previews substituted action values for supported fields. It never contacts the tested URL, requests permission, installs rules, or starts the runtime.

**REQ-012 — Editor/docs/examples.** Editor help, diagnostics, user documentation, AI-assist prompt text, and the basic sample use `$N` consistently and describe redirect `\\N` compatibility and body regex semantics.

## Non-goals

- Named capture references such as `$<id>`.
- Captures beyond nine groups.
- Substitution in origins, methods, resource types, permissions, or dry-run case URLs.
- Arbitrary JavaScript action programs.
- Combining URL captures with body-regex captures in one replacement string.
- Adding wildcard matching, GraphQL filtering, delay rules, script injection, or response-status mocking as part of #197.

## Architecture

The schema owns syntax validation and capture-count diagnostics. The compiler carries validated action strings without applying a request-specific capture. A shared pure capture/substitution utility is used by dry-run and runtime-facing execution paths. Redirects use DNR-native `\\N` substitution where possible. Query/header values that require per-request captures use the native runtime/interception path; they must not silently fall back to literal DNR values. Request/response body replacements use the existing native runtime.

The action model remains unchanged on disk except for the accepted string syntax. Existing projects containing redirect `\\N` values remain valid. No migration is required.

## Acceptance criteria

**AC-001.** A rule with `urlRegex` containing one capture accepts `$1` in redirect, query value, header value, request-body replace body, and response-body replace body fields.

**AC-002.** `$2` is rejected when `urlRegex` contains only one capturing group; non-capturing groups, lookarounds, escaped parentheses, and named-group syntax follow the existing counting rules.

**AC-003.** `$$` produces one literal `$`, and valid captures are substituted without interpreting replacement output as another template.

**AC-004.** Existing redirect `\\1` behavior remains valid and produces the same destination as the equivalent `$1` form.

**AC-005.** Query and header dynamic values are either executed through a path that evaluates captures per request or report an explicit unsupported status; they are never installed as literal `$1` text.

**AC-006.** Request/response replace-mode bodies substitute URL captures at runtime, with output and input limits preserved.

**AC-007.** Request/response regex-mode replacements preserve body-regex `$1` semantics and do not ambiguously mix URL captures.

**AC-008.** Runtime execution revalidates the URL match and rule authority before applying a dynamic transformation.

**AC-009.** Dry-run previews captures and supported substituted action values without network, permission, persistence, installation, or runtime side effects.

**AC-010.** Editor validation and the CLI/extension schema boundary expose stable, field-specific diagnostics for invalid capture references.

**AC-011.** Documentation, the sample, and AI prompt agree on `$N`, `$$`, redirect compatibility, and body regex semantics.

**AC-012.** `pnpm validate` passes, including unit, integration, browser/package, build, and manifest checks.

## Compatibility and security

The project file remains version 1. Existing redirect syntax is preserved. New syntax is additive. Substitution is bounded by existing field and body limits, does not broaden origins or permissions, and does not persist request/response bodies or captures. Any dynamic DNR limitation is represented as a runtime-backed or unsupported state rather than a false-success installation.

## Open questions resolved by recommendation

- **Q1: Should redirect `\\N` remain accepted?** Yes. It avoids breaking existing projects; `$N` becomes the canonical authoring syntax.
- **Q2: Should body regex replacements mix URL and body captures?** No for the initial implementation. Keeping one capture namespace prevents ambiguous behavior and preserves existing rules.
- **Q3: Should query/header support be deferred because DNR cannot express it directly?** No. Implement a runtime-backed path for dynamic values; only a platform capability limitation may report unsupported.
