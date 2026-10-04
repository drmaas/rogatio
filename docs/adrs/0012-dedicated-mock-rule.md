# 0012. Dedicated mock rule

## Context

Response-body rules fetch upstream before changing a body. A mock must return a
complete local response without contacting upstream.

## Decision

Add a dedicated `mock` rule with status, headers, delay, method matching, and
one inline or file body. No method filter means all methods. `HEAD` performs the
same delay and file read, returns the same status and headers, and sends no
body.

## Consequences

- Mock behavior does not change redirect or response-body behavior.
- Schema, compiler, editor, preview, runtime, and extension gain one mock branch.
- File errors and `Content-Length` remain observable on `HEAD`.
