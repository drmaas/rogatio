# F15 — Response-Body Rewriting Rules

**Status:** Approved specification (Stage 4 gate passed 2026-08-24).
**Depends on:** F14 native-messaging runtime, F7 extension shell, F5 editor.
**Tier:** Normal tier explicitly overridden by the user: every role pass is served by the current Codebuff session model.

## Problem and goals

Rogatio cannot currently alter the body of an authorized upstream response. F15 adds a response-body rule that performs bounded textual replacements for explicitly authorized public GET requests through the separately started local native runtime.

The feature is end-to-end: it includes the capability-gated live TLS interception provider, device-local CA handling, and Chrome PAC integration needed to route eligible traffic. Request-body trust lifecycle and request-body rewriting remain F16/F17 scope.

## Scope

In scope: version-1 schema and editor support for `type: "response-body"`; an ordered replacement list of `{ pattern, replacement }`; compiler `ResponseBodyOperation`; bounded ECMAScript-regex textual rewriting; public GET requests without browser credentials; F14 native-runtime/revalidation integration; live TLS interception with trusted device-local CA verification/provisioning, capability detection, explicit start/stop, scoped Chrome PAC routing, and collision detection; extension status/commands/diagnostics; and metadata-only native messaging.

Explicit non-goals: F16 request-body trust lifecycle; F17 request-body replacement/modification; browser credential/cookie/client-certificate forwarding; private or reserved targets; redirects; compressed or unsupported encodings; binary rewriting; unbounded buffering; persistent bodies or traffic history; automatic runtime start/trust; silent proxy/PAC takeover; and generic proxy behavior.

## Requirements

- **REQ-001:** Add `"response-body"` to the rule type enum.
- **REQ-002:** Require `responseBody.replacements`, a non-empty bounded array of `{ pattern, replacement }` objects; reject unknown properties.
- **REQ-003:** Validate each pattern as a bounded ECMAScript regular expression source and each replacement as a bounded string. Apply replacements globally in declared order.
- **REQ-004:** Compile to `ResponseBodyOperation` with deterministic matcher and replacement order.
- **REQ-005:** Use stable diagnostics and paths independent of AJV or platform wording.
- **REQ-006:** Accept only exact-authorized public GET requests; reject credentials, unauthorized initiators/targets, stale grants, mismatched project/rule/URL/method/resource type, and unknown operations.
- **REQ-007:** Never forward browser cookies, authorization headers, client certificates, or other browser credentials.
- **REQ-008:** Follow no redirects; reject unsupported transfer/content encodings; allow `text/*`, JSON, JavaScript, CSS, and XML.
- **REQ-009:** Reuse F14 response limits; decode UTF-8, apply ordered global replacements, re-encode UTF-8, and fail closed on invalid UTF-8/binary content.
- **REQ-010:** Never persist, log, export, or native-message response/request bodies.
- **REQ-011:** Do not implement a generic forward proxy; each connection is exact-operation and authority bound.
- **REQ-012:** Provision or verify a device-local CA only through explicit capability-gated user action; never silently install trust.
- **REQ-013:** Detect controlling proxy/PAC/extension/enterprise collisions before activation; report `unsupported` without changing routing.
- **REQ-014:** Scope PAC routing to declared eligible origins; non-matching traffic remains direct.
- **REQ-015:** Make start/stop explicit and idempotent; stop removes routing and closes active sessions.
- **REQ-016:** Validate TLS hostnames against exact authority; reject arbitrary CONNECT targets.
- **REQ-017:** Reuse F14 resource/header/timeout/concurrency bounds and stable redacted errors.
- **REQ-018:** Report `needs proxy`, `needs permission`, `active`, `unsupported`, or `error` according to runtime, permission, capability, and install state.
- **REQ-019:** Extend F14 native-runtime control without automatic start/trust; include provider state.
- **REQ-020:** Install routing only for enabled, authorized response-body operations and remove it when stopped/disabled/replaced.
- **REQ-021:** Keep CLI verify/edit and dry-run offline; dry-run never contacts runtime or target.
- **REQ-022:** Preserve existing F13/F14 and browser-only behavior.
- **REQ-023:** Keep public serialization/status/diagnostics deterministic.
- **REQ-024:** Keep browser bundles free of Node-only runtime/validation imports.

## Acceptance criteria

- **AC-001:** A valid multi-replacement rule validates and compiles to `ResponseBodyOperation`, preserving order.
- **AC-002:** Missing/empty replacements, unknown properties, invalid regexes, oversized fields, and malformed actions fail with stable diagnostics.
- **AC-003:** The editor renders ordered replacement rows, add/remove controls, validation, and a browser-safe bundle.
- **AC-004:** Before explicit runtime/provider start, enabled rules report `needs proxy` and install no routing.
- **AC-005:** On a supported platform with explicit trusted CA/provider start, permission, enablement, and exact authority, a matching public GET response is rewritten globally in order.
- **AC-006:** Non-GET, credentialed, private/reserved, unauthorized, stale, redirected, malformed, binary, invalid-UTF-8, unsupported-encoding, and over-limit operations fail closed without body persistence.
- **AC-007:** Capability collisions/missing CA report `unsupported` and leave existing routing unchanged.
- **AC-008:** Explicit stop removes F15 routing and terminates active sessions; repeated stop is safe.
- **AC-009:** Native envelopes, logs, diagnostics, state, and exports contain no body content.
- **AC-010:** Existing F13/F14/browser-only suites remain green.
- **AC-011:** CLI/editor dry-run never contacts target/runtime.
- **AC-012:** `pnpm validate` passes with no generated artifacts, secrets, credentials, traffic captures, or unrelated changes.

## API and compatibility

Schema version remains 1 and the new rule type is additive. New exported types are `ResponseBodyAction`, `ResponseBodyReplacement`, and `ResponseBodyOperation`. Runtime/provider APIs extend F14 seams. F16 owns request-body trust lifecycle; F17 owns request-body rewriting and reuses the shared interception infrastructure. Existing projects require no migration.

## Resolved decisions

- Ordered replacement list of `{ pattern, replacement }`.
- Reuse F14 runtime limits.
- Support `text/*`, JSON, JavaScript, CSS, and XML.
- Include the concrete live TLS interception/device-local CA/Chrome PAC provider required for end-to-end F15.
- Keep F16/F17 out of scope.
