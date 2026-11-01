---
title: Redirects
description: Send matching requests to an absolute destination with controlled capture substitution.
---

Redirect rules send matching HTTP(S) requests to an **absolute destination** URL.

## Behavior

- The destination is an absolute URL.
- Controlled regular-expression **capture substitution** is supported. Use `$1` through
  `$9` to carry parts of the matched request URL into the destination.
- Use `$$` for a literal dollar sign.
- Existing redirect files may keep using Chrome-style `\1` through `\9` references.
- Redirect rules run entirely in the browser via DNR.

Example:

```json
{
  "source": {
    "key": "url",
    "operator": "regex",
    "value": "^https://example\\.com/old/(.*)$"
  },
  "redirect": { "destination": "https://example.com/new/$1" }
}
```

## Notes

- Use the editor's URL → exact regex helper to build a literal anchored pattern.
- Test the resulting destination with the [offline dry-run](/guides/dry-run/), which
  previews redirect destinations without contacting the URL.
