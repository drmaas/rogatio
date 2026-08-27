---
title: Redirects
description: Send matching requests to an absolute destination with controlled capture substitution.
---

Redirect rules send matching HTTP(S) requests to an **absolute destination** URL.

## Behavior

- The destination is an absolute URL.
- Controlled regular-expression **capture substitution** is supported, so parts of the
  matched request URL can be carried into the destination.
- Redirect rules run entirely in the browser via DNR.

## Notes

- Use the editor's URL → exact regex helper to build a literal anchored pattern.
- Test the resulting destination with the [offline dry-run](/guides/dry-run/), which
  previews redirect destinations without contacting the URL.
