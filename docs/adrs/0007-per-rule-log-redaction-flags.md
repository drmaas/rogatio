# 0007. Per-rule log redaction flags

## Context

Product wants **one** editor checkbox on every rule kind except body rules: redact sensitive fields in logs. The previous plan kept `schema` / `compiler` / `editor` untouched, then briefly specified two checkboxes including a body-redact flag. Optional rule fields with `additionalProperties: false` must be declared in schema, compiled, mirrored in `browser-schema.ts`, and edited in the DOM editor. A second body-redact checkbox was rejected: this feature does not log bodies.

## Decision

Add one optional boolean on the source rule: `redactSensitiveInLogs`. Absent/omitted means `false` (do not redact). Checked = redact. **Unchecked by default.** Project version stays 1. Compiler resolves the flag onto every `RogatioOperation` (absent → `false`). Editor shows the checkbox on all rule kinds **except** body rules (`request-body`, `response-body`); accessible name **Redact sensitive fields in logs**; type change does not strip it; body-kind cards hide it. `browser-core` is unchanged (opaque JSON).

`redactSensitiveInLogs` gates the deny-list on URL/initiator/destination query values and on intended header/query-transform values. Hard truncate (≤200 + `...`) always applies even when the flag is false.

Do **not** add `redactBodiesInLogs`. Body-rule match logging (payload + a redact option) is **tracked in GitHub issue #163**.

## Consequences

- Schema, compiler, editor, and the extension browser-schema mirror all change. Dry-run and DNR projection ignore the flag.
- The flag is a **required** resolved boolean on every `RogatioOperation`, so every operation literal outside the compiler (cli, runtime preset, test fixtures) must set it. The runtime preset normalizer accepts the key on a matcher operation (non-boolean is rejected, absent resolves to `false`) but leaves it out of the canonical digest bytes, so runtime authorization and existing preset digests are unaffected.
- Old projects without the key remain valid and do **not** redact (deny-list off; truncate still applies).
- Body-kind editor cards have no redact control in this feature.
