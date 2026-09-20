---
title: Request & response headers
description: Set, append, or remove headers subject to forbidden-header lists and browser limits.
---

Header rules set, append, or remove a named request or response header.

## Behavior

- **Set** a header to a value (replacing any existing value).
- **Append** an additional value to an existing header.
- **Remove** a named header.

## Constraints

- Subject to immutable **forbidden-header lists** (frozen, matched case-insensitively).
- Subject to browser limitations on which headers can be modified.
- Static header rules run entirely in the browser via DNR.
- Header values may use `$1` through `$9` from the rule's `urlRegex` and `$$` for
  a literal dollar sign. Capture-dependent values require the native runtime path.
- Header names do not support capture substitution.

## Notes

- Forbidden-header lists are owned by the schema package and cannot be overridden by a rule.
