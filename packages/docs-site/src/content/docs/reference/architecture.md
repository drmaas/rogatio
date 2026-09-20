---
title: Architecture
description: Rogatio's package boundaries and how they fit together.
---

Rogatio is a strict TypeScript 7, ESM/NodeNext monorepo using pnpm 12.4.1.

For package decisions, rejected alternatives, and feature-slice history, see the repository
file `docs/architecture.md`. This page is the short user-facing summary.

## Packages

| Package | Responsibility |
|---------|----------------|
| `@rogatio/schema` | Version-1 JSON Schema, AJV validation, origins, bounds, forbidden headers. |
| `@rogatio/compiler` | Validated source → browser-neutral operations + stable diagnostics. |
| `@rogatio/browser-core` | Versioned storage, migrations, permissions, enablement, CAS lifecycle, atomic install/recovery, runtime state, diagnostics, badge state. |
| `@rogatio/editor` | Shared framework-free DOM controller and accessible view. |
| `@rogatio/dry-run` | Pure-offline bounded URL batch test engine (4-dim matching, preview seam). |
| `@rogatio/runtime` | Bounded response-body and request-body transformation/runtime components (native host). |
| `@rogatio/cli` | Editor host, file verification, dry-run (`test`), AI config (`ai`), runtime dispatch (`install` / `uninstall` / `host`). |
| `@rogatio/extension` | Chrome MV3 service worker, popup, management page, DNR projection, native-session bridge. |
| `@rogatio/docs-site` | Astro + Starlight static documentation site (this site); off the product package DAG. |
| `@rogatio/smoke` / `@rogatio/sanity` | Tiny workspace stubs for package wiring checks (not browser e2e fixtures). |

Dependency direction (no cycles):

```text
schema → compiler → { editor, dry-run, browser-core } → { cli, extension }
 ↑
 runtime (depends on schema + compiler only; cli depends on runtime)
```

## Build and quality

- Builds use **esbuild**.
- Quality gates use **Biome** (format + lint), strict **TypeScript** checks, **Vitest** for
  unit tests, and **Selenium** (Chrome for Testing) for end-to-end browser journeys.
- CI and **semantic-release** publish the CLI to the public npm registry and extension ZIPs
  to GitHub Releases, with consistent CLI/extension/Git-tag versioning.
- The documentation site (this site) uses **Astro** and **Starlight** and is a separate
  static package that does not share runtime code with the product packages.
