# File mocks

## Status

Approved — ready for research; not implemented.

## Problem

Rogatio cannot serve a response from a local file. Redirect rules require an
HTTP or HTTPS destination, so users must run another server. Response-body
replace rules fetch an upstream response before changing its body. They cannot
set mock status, headers, or file content.

This leaves no built-in way to mock static assets without contacting upstream.

## User

Rogatio users who need matched browser requests to return controlled local
responses, including responses backed by local files.

## Outcome

- **O1:** Users can define a dedicated mock response with status, headers,
  delay, and either inline or file-backed content.
- **O2:** Users can author, validate, and preview mock rules through existing
  Rogatio workflows.
- **O3:** Enabled mock rules run through Rogatio's current runtime model, with
  clear rule status and no upstream request.

## Scope

- Add a dedicated mock rule type.
- Support per-rule status, headers, delay, and inline or file-backed content.
- Re-read file-backed content when a matching request is served.
- Support mock rules in project validation, compilation, editing, and offline
  preview.
- Serve matched mocks through the current unified native runtime host.
- Connect browser matching to mock responses without recursive interception.
- Report whether an enabled mock is active, needs runtime, unsupported, or in
  error.

## Non-goals

- Do not fold file mocks into response-body replace.
- Do not bring back the F13 standalone mock server.
- Do not bring back the `/v1/connection` protocol or Check-and-connect flow.
- Do not change redirect behavior.
- Do not change response-body behavior.
- Do not turn the runtime into a general file server.

## Requirements

- **R1 → O1:** A project can represent a mock rule with status, headers,
  delay, and exactly one body source: inline content or a local file.
- **R2 → O1, O2:** Rogatio validates mock rules with stable, field-specific
  errors and rejects unknown or unsafe values.
- **R3 → O2:** The shared editor can create, edit, copy, remove, save, and
  inspect mock rules alongside existing rule types.
- **R4 → O2:** Offline dry-run reports whether a case matches and previews the
  intended mock action. It does not read files, contact upstream, or start a
  runtime.
- **R5 → O1, O3:** A matched mock returns its configured response without
  contacting the original upstream destination.
- **R6 → O1, O3:** A file-backed mock reads the file at request time from a
  confined root and enforces bounded reads. File bodies may contain arbitrary
  bytes and do not need to be valid UTF-8. Missing, inaccessible, or oversized
  files fail closed with a visible rule error.
- **R7 → O3:** Browser routing uses the current unified native runtime host and
  prevents Rogatio's mock response path from matching itself.
- **R8 → O3:** Mocks are available only while the unified native runtime host
  is running; there is no always-on browser path. An enabled mock reports
  `needs runtime` until the host can serve it, then `active`; it reports
  `unsupported` or `error` when applicable.

## Open questions

none

## Decisions

- File-backed bodies may contain arbitrary binary data, including images,
  fonts, WebAssembly, and other bytes; UTF-8 is not required.
- Mocks are served only while the unified native runtime host is running. No
  always-on browser path is required.
