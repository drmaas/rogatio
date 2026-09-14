---
title: Query parameters
description: Set or remove configured query parameters while preserving unrelated ones.
---

Query parameter rules modify the query string of matching requests. Each param is a **set** (default when `operation` is omitted) or a **remove**.

## Behavior

- **Set** adds missing configured parameters and replaces all existing values for those names.
- **Remove** drops configured names from the query string.
- **Preserve** unrelated parameters, the scheme, authority, path, and fragment.

Set requires a `value`. Remove must omit `value`.

## Notes

- Only the named parameters are touched; everything else in the URL is left intact.
- Test the resulting query URL with the [offline dry-run](/guides/dry-run/).
