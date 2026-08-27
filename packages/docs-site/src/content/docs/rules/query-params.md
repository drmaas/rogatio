---
title: Query parameters
description: Add missing parameters and replace existing values while preserving unrelated ones.
---

Query parameter rules modify the query string of matching requests.

## Behavior

- **Add** missing configured parameters.
- **Replace all existing values** for configured parameter names.
- **Preserve** unrelated parameters, the scheme, authority, path, and fragment.

## Notes

- Only the named parameters are touched; everything else in the URL is left intact.
- Test the resulting query URL with the [offline dry-run](/guides/dry-run/).
