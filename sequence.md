# Rogatio — Implementation Sequence

Derived from `rogatio-overview.md`. Features are sized to be independently shippable units (a coherent slice spanning the packages it touches). Phases are **sequential**; items **within** a phase are parallelizable unless noted. Hard dependencies appear in *Depends on*; an *Early start* note marks where a feature can begin ahead of its phase if capacity allows.

## How to read this

- Each feature is a vertical slice through the packages it needs (`schema` → `compiler` → `browser-core`/`editor`/`extension`/`runtime`/`cli`).
- Rule-type slices include their schema fields, compiler operations, editor UI, extension DNR translation, and tests as one unit.
- "Parallel" means no hard dependency between items; they may still share a package and need coordination.

---

## Phase 1 — Foundation (sequential)

Nothing else can begin until the monorepo exists, and the compiler depends on schema.

- **F1 — Monorepo & tooling bootstrap.** pnpm 10.32.1 workspaces, strict TS 7 + ESM/NodeNext, Biome (format + lint), esbuild build pipeline, Vitest, Playwright, base GitHub Actions. *Depends on: nothing.*
- **F2 — `schema` package.** Version-1 JSON Schema, AJV-generated validation, site origins, bounds, and forbidden-header lists. *Depends on: F1.*
- **F3 — `compiler` package.** Validated source → browser-neutral operations + stable diagnostics. *Depends on: F2.*

---

## Phase 2 — Core platform (parallel)

All three depend only on `schema` + `compiler` and are mutually independent, so they run concurrently.

- **F4 — `browser-core`.** Versioned project storage, migrations, permissions, enablement, compare-and-swap lifecycle, atomic rule install/recovery, runtime state, diagnostics, and badge state. Defines the rule status model (`active` / `disabled` / `needs permission` / `needs proxy` / `unsupported` / `error`) even though runtime-dependent statuses only populate later. *Depends on: F2, F3.*
- **F5 — `editor`.** Framework-free DOM controller + accessible view: project metadata editing, group/rule create-reorder-remove, URL→exact-regex conversion, validate/save/cancel, field-level errors, project-wide search, contextual command bar, desktop route rail, compact mobile nav, keyboard / screen-reader / forced-colors / 200% zoom support. Exposes a rule-type field extension point consumed by later slices. *Depends on: F2, F3.*
- **F6 — `runtime` mock/response server foundation.** `127.0.0.1` bind, capability + preset-digest pairing, exact-rule authorization, file-access confinement, and SSRF / DNS-rebinding / redirect / credential / method / timeout / size controls. Never a general forward proxy or file server. *Depends on: F2, F3.*

---

## Phase 3 — Extension & CLI shell (parallel)

Both depend on the core platform landing in Phase 2.

- **F7 — Chrome MV3 extension shell.** Manifest, background service worker, deterministic matcher projection for future WebExtensions/DNR action slices, permission flow (review & grant only declared site access), project import/export, project selector with explicit **Switch**, create/import/update/remove (cancelable confirmation), group activation kept separate from permission, conflict refresh path, 64-project cap with exactly one active project, and rule status rendering plus toolbar badge. Actionless F3 matcher operations are reported as `unsupported` and are not installed until a later action slice defines their DNR action. The bounded/redacted/live-only `[Rogatio]` DevTools Console record is explicitly deferred to a later feature specification. *Depends on: F4, F5.*
- **F8 — CLI `edit` + `verify`.** Editor host wrapping F5, `.rogatio.json` file verification (`verify`), and validate/save/cancel against the file. *Depends on: F4, F5; `verify` also uses F3.*

---

## Phase 4 — Browser-only rule types + offline dry-run (parallel)

Each is a vertical slice through schema → compiler → extension DNR, plus its editor UI. All are browser-only and independent of one another.

- **F9 — Redirect rules.** Absolute destination with controlled regex capture substitution. *Depends on: F7, F5.*
- **F10 — Query parameter rules.** Add missing configured params; replace all existing values for configured names; preserve unrelated params, scheme, authority, path, fragment. *Depends on: F7, F5.*
- **F11 — Request & response header rules.** Set / append / remove, subject to forbidden-header lists and browser limits. *Depends on: F7, F5.*
- **F12 — Offline dry-run / test.** Bounded URL batch; reports regex, effective-origin, method, resource-type results; previews redirect destinations and resulting query URLs. Never contacts the URL, requests permission, changes installed rules, connects a runtime, or saves test data. Usable from both editor and CLI. *Depends on: F2, F3, F5, F8.*

---

## Phase 5 — Runtime-dependent foundation (parallel)

Both depend on the `runtime` package patterns but are independent processes and may run together. F6 (mock server) already landed in Phase 2.

- **F13 — Mock rules.** Configured status, headers, optional delay, and either an inline body or a live UTF-8 snapshot of one approved local file. Never contacts upstream. Integrates the rule slice with F6's server, the editor, and the extension, including the single user-clicked Check-and-connect request whose status reflects the last check. *Depends on: F6, F7, F5.*
- **F14 — macOS native-messaging runtime.** `rogatio runtime` control for response-body and request-body transformation routing, scoped Chrome PAC/proxy routing, ephemeral TLS proxy, device-local CA, and independent revalidation of project/rule/URL/method/initiator/target/permission/grant authority. Observed bodies are never persisted, logged, exported, or transferred through native messaging. Explicit Start/Stop controls. *Depends on: F2, F3. Early start: may begin in Phase 2 in parallel, since its only hard dependency is schema/compiler.*

---

## Phase 6 — Native-messaging rule types (partial parallel)

F16 must precede F17; F15 runs in parallel with both.

- **F15 — Response-body rewriting rules.** Authorized public GET without browser credentials; bounded textual replacement via native messaging to the explicitly started local runtime. *Depends on: F14, F7, F5.*
- **F16 — Request-body trust lifecycle.** `rogatio runtime install | status | trust | untrust | uninstall`. *Depends on: F14.*
- **F17 — Request-body replacement/modification rules.** Full body replace or bounded global ECMAScript regex replace on eligible POST/PUT/PATCH XHR; bounded UTF-8 JSON / form-encoded / textual inputs (reject unsupported framing/encoding/signatures). Activation is macOS-only and cannot compose with another controlling proxy, PAC, extension, or enterprise policy; Linux/Windows allow verify/edit/import/export/dry-run but report activation as `unsupported`. Uses the runtime-owned TLS proxy. *Depends on: F14, F16, F7, F5.*

---

## Phase 7 — Hardening, docs, release (parallel)

- **F18 — E2E & integration test suite.** Playwright headless browser journeys, integration tests, and packaged-install tests across supported platforms. *Depends on: all features.*
- **F19 — Documentation site.** Astro + Starlight. *Early start: scaffold may begin in Phase 1; content fills as features land.*
- **F20 — Release pipeline.** GitHub Actions + semantic-release (semantic-release plugin) publishing the CLI to the authenticated GitHub Packages registry and extension ZIPs to GitHub Releases, with consistent CLI/extension/Git-tag versioning. *Depends on: F1; finalize after features.*

---

## Dependency graph (summary)

```
F1 → F2 → F3
        ├→ F4 ─┐
        ├→ F5 ─┼─→ F7 ──→ {F9, F10, F11}
        └→ F6 ─┤     └──→ F8 ──→ F12
              └→ F13
F2,F3 → F14 → {F15, F16 → F17}

F7 + F4 → rule status + badge (populated progressively)
all  → {F18, F20}; F1 → F19 (early)
```

## Critical path

`F1 → F2 → F3 → F5 → F7 → F17 → F18`

The longest chain runs through the editor and Chrome extension to the most complex rule type (request-body), then to the full E2E suite. F14 can be pulled forward to run parallel with Phases 2–4 to shorten the critical path once schema/compiler exist.

## Parallelism summary

| Phase | Parallel items | Notes |
|-------|----------------|-------|
| 1 | — (sequential) | compiler needs schema |
| 2 | F4, F5, F6 | independent; all need only schema+compiler |
| 3 | F7, F8 | both need core platform |
| 4 | F9, F10, F11, F12 | independent browser-only slices |
| 5 | F13, F14 | separate runtime processes; F14 may start earlier |
| 6 | F15 ∥ (F16 → F17) | F16 gates F17 |
| 7 | F18, F19, F20 | F19/F20 may start early |
