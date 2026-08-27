---
title: Extension reference
description: The Chrome MV3 extension boundary and its DNR translation.
---

The Chrome Manifest V3 extension is the first browser boundary for Rogatio. The extension
boundary is designed to accommodate additional browser extensions in the future.

## Responsibilities

- Owns Chrome MV3 adapters, the service-worker message protocol, and the extension-page
  project-management shell.
- Translates neutral matcher operations from `browser-core` into deterministic Chrome
  Declarative Net Request (DNR) rules.
- Depends on `browser-core`, `compiler`, `editor`, and `schema`; upstream packages remain
  browser-neutral and do not import Chrome APIs.

## Behavior

- The service worker is the authority for `storage.local` persistence, permissions, project
  lifecycle, group enablement, matcher projection, rule statuses, and the action badge.
- Permission requests are projected from sorted effective origins and never include
  undeclared origins or broad host patterns.
- Actionless matcher operations are reported as `unsupported` and are never sent to DNR.
- The extension emits no traffic or console diagnostics beyond the bounded, redacted
  `[Rogatio]` DevTools Console record described in [Chrome extension](/guides/extension/).

## Distribution

The extension is **unsigned** and manually loaded from a GitHub Release ZIP. There is no
browser-store installation or automatic update. Chrome sideloading may require the
organization's extension entitlement.
