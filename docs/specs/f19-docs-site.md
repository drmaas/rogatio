# F19 — Documentation Site (Astro + Starlight)

- **Status:** Draft for human review (SDD Stage 3).
- **Branch:** `feature/f19-docs-site`
- **Tier:** Free (single-model session; each SDD role run as a distinct pass).

## 1. Problem statement and goals

Rogatio ships as a CLI, a Chrome extension, and a version-controlled `.rogatio.json`
project file, but has no published, navigable user documentation. The existing `docs/`
directory holds internal specs, plans, and workflow logs for agents — not end-user docs.
F19 delivers a separate static documentation site so users can install, configure, and
operate Rogatio correctly.

Goals:

- Publish a searchable, accessible documentation site built with **Astro 7** + **Starlight**.
- Document the shipped product surface: install, editor, rules, dry-run, extension, and
  runtime, consistent with `rogatio-overview.md`, `sequence.md`, and the per-feature specs.
- Keep the new package isolated so the repository's canonical validation
  (`format:check`, `lint`, `typecheck`, `build`, `test`) stays green.

## 2. Scope and non-goals

**In scope:**

- New workspace package `packages/docs-site` (private `@rogatio/docs-site`).
- `astro` + `@astrojs/starlight` as the only new dependencies.
- Starlight-themed static site with sidebar navigation and the content sections below.
- Build script (`astro build`) that emits `dist/` (gitignored).
- Isolation rules so root lint/typecheck/build/test remain unaffected.

**Non-goals:**

- Deploying or hosting the site (F20 release pipeline may cover later).
- Publishing the site to npm or packaging it into the extension ZIP.
- Generating docs from code/source comments (content is hand-authored Markdown).
- Adding analytics, telemetry, comments, or external tracking.
- Live API doc generation from TypeScript sources.

## 3. Actors, entry points, supported environments

- **Actors:** end users installing/using Rogatio; integrators reading the rules/CLI/extension
  reference.
- **Entry point:** `pnpm --filter @rogatio/docs-site dev` (local preview) and
  `pnpm --filter @rogatio/docs-site build` (static output).
- **Environments:** built with Node 24+ and pnpm 10.32.1, consistent with the repo baseline.
  Output is framework-free static HTML/CSS/JS usable on any static host.

## 4. Functional requirements

- **REQ-001** — The site must build to static assets via `astro build` with no external
  network calls at build time and no analytics/telemetry.
- **REQ-002** — Content must use Starlight's built-in docs collection under
  `src/content/docs/**` as Markdown (`.md`); the collection is declared in the package's
  `src/content.config.ts` via `docsLoader()` + `docsSchema()`, as required by Astro 7 and
  Starlight 0.41.
- **REQ-003** — The following sections must exist with accurate, overview-consistent
  content:
  - Overview / introduction (index).
  - Getting started: installation (CLI via GitHub Packages; extension manual load),
    quick start.
  - Guides: projects & rules, the editor (`edit`/`verify`), offline dry-run, the Chrome
    extension (import/export, switch, grant, activate), and the runtime (mocks,
    response-body, request-body, `rogatio runtime` lifecycle and trust commands).
  - Rules reference: redirects, query parameters, request/response headers, mocks,
    response-body rewriting, request-body replacement.
  - Reference: CLI (`edit`, `verify`, `runtime install|status|trust|untrust|uninstall`),
    extension, supported platforms & capabilities, security & privacy model, architecture.
- **REQ-004** — The new package must be excluded from the root `tsconfig.json` `exclude`
  and added to `.biomeignore`, so root `typecheck` and Biome do not process Astro/Markdown.
- **REQ-005** — Root canonical validation (`pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, `pnpm test`) must pass after the package is added.
- **REQ-006** — Sidebar must be defined in `astro.config.mjs` and must reflect the section
  structure in REQ-003.
- **REQ-007** — The site must not pull product runtime source into its bundle; it is
  content-only (Markdown + Starlight config).

## 5. Acceptance criteria

- **AC-001** — `pnpm --filter @rogatio/docs-site build` exits 0 and writes `dist/index.html`
  plus the Starlight asset tree. (REQ-001, REQ-002)
- **AC-002** — Every page listed in REQ-003 exists under `src/content/docs/` and renders in
  the built site (present in `dist/`). (REQ-003)
- **AC-003** — `packages/docs-site` is present in the root `tsconfig.json` `exclude` and in
  `.biomeignore`. (REQ-004)
- **AC-004** — After adding the package, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, and `pnpm test` all exit 0 from the repo root. (REQ-005)
- **AC-005** — `astro.config.mjs` defines a Starlight sidebar whose entries map 1:1 to the
  REQ-003 sections. (REQ-006)
- **AC-006** — No `node_modules`, `dist`, secrets, or telemetry configuration are committed;
  the build output is gitignored. (REQ-001, REQ-007)
- **AC-007** — Content states the documented public CLI is exactly `edit`, `verify`, and
  `runtime`, and that request-body activation is capability-based and reports `unsupported`
  where required capabilities are absent — matching `rogatio-overview.md`. (REQ-003)

## 6. API / CLI / file-format / compatibility changes

- New `packages/docs-site/package.json` (private), `astro.config.mjs`,
  `src/content/docs/**.md`, and `tsconfig.json` (Astro-generated types) inside the package.
- Modifies repo-root `tsconfig.json` (add `packages/docs-site/**/*` to `exclude`) and
  `.biomeignore` (add `packages/docs-site`).
- Adds `astro` and `@astrojs/starlight` to the workspace dependency graph (new lockfile
  entries). No change to product package APIs.

## 7. Security, privacy, performance, accessibility, operational

- **Security/Privacy:** static, content-only site; no runtime, no network calls at build or
  runtime beyond Starlight's own static assets; no analytics or telemetry; no secrets.
- **Performance:** static output; no client-side framework; Starlight ships minimal JS.
- **Accessibility:** inherits Starlight's accessible UI (keyboard nav, ARIA, color contrast);
  authored content uses semantic Markdown headings and descriptive link text.
- **Operational:** build is reproducible and offline-capable once dependencies are installed;
  output is host-agnostic static files.

## 8. Migration, rollout, backward-compatibility

- No migration: greenfield package. Backward compatibility is N/A for product APIs.
- If a future feature changes CLI/extension behavior, its docs page is updated in the same
  change that ships the feature (kept consistent with the repo's documentation rule).

## 9. Open questions and assumptions

- **Assumption:** Astro 7 + Starlight 0.41.x are mutually compatible (verified: Starlight
  0.41.9 peers `astro ^7.0.2`). If a newer incompatible pair appears at install time, pin to
  the verified compatible versions.
- **Assumption:** content is authored from the existing `rogatio-overview.md`,
  `sequence.md`, and feature specs; no new product behavior is introduced by docs.
- **Open:** exact deployment target/hosting is owned by F20; F19 only produces the build.
