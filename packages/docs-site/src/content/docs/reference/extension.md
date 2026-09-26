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

- The service worker is the authority for `storage.local` persistence, project lifecycle,
  group enablement, matcher projection, rule statuses, and the action badge.
- The manifest declares broad host access (`host_permissions: ["*://*/*"]`) at install
  time; there is no per-origin grant UI or `optional_host_permissions` flow.
- Actionless matcher operations are reported as `unsupported` and are never sent to DNR.
- Console **match logging** injects a bounded, redacted, live-only lowercase `[rogatio]`
  line into the matched page's DevTools Console when `onRuleMatchedDebug` fires (unpacked
  load only; redirect/query/header, plus body via session markers when the strip path
  gate allows install). See [Chrome extension](/guides/extension/) for coverage, the
  **Match logging** toggle (default on), per-rule redact checkbox, live vs intended
  fields, and limitations.

## Distribution

The extension is **unsigned** and manually loaded from a GitHub Release ZIP. There is no
browser-store installation or automatic update. Chrome sideloading may require the
organization's extension entitlement.
