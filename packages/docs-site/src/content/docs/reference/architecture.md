---
title: Architecture
description: Rogatio's package boundaries and how they fit together.
---

Rogatio is a strict TypeScript 7, ESM/NodeNext monorepo using pnpm 10.32.1.

## Packages

| Package | Responsibility |
|---------|----------------|
| `@rogatio/schema` | Version-1 JSON Schema, AJV validation, origins, bounds, forbidden headers. |
| `@rogatio/compiler` | Validated source → browser-neutral operations + stable diagnostics. |
| `@rogatio/browser-core` | Versioned storage, migrations, permissions, enablement, CAS lifecycle, atomic install/recovery, runtime state, diagnostics, badge state. |
| `@rogatio/editor` | Shared framework-free DOM controller and accessible view. |
| Chrome MV3 extension | Translates neutral rules to WebExtensions/DNR. Designed to support more browsers later. |
| `@rogatio/cli` | Editor host, file verification, runtime dispatch, macOS runtime lifecycle. |
| `@rogatio/runtime` | Reusable bounded mock, response-body, and request-body transformation/runtime components. |

Dependency direction:

```text
schema -> compiler -> { browser-core, editor, runtime } -> cli -> { extension, native runtime }
```

## Build and quality

- Builds use **esbuild**.
- Quality gates use **Biome** (format + lint), strict **TypeScript** checks, **Vitest** for
  unit tests, and **Playwright** for end-to-end tests.
- CI and **semantic-release** publish the CLI to npm and extension ZIPs to GitHub Releases,
  with consistent CLI/extension/Git-tag versioning.
- The documentation site (this site) uses **Astro** and **Starlight** and is a separate
  static package that does not share runtime code with the product packages.
