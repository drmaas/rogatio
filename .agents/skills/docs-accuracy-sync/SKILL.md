---
name: docs-accuracy-sync
description: >-
  Sync Rogatio orientation docs and the Starlight docs-site with shipped code.
  Use when updating README, AGENTS.md, docs/architecture.md, rogatio-overview.md,
  packages/docs-site content, package READMEs, or when docs drift from CLI/runtime/
  extension behavior (pnpm pin, package DAG, install commands, host vs CA).
  Runs graphify (update or full) then queries the graph before editing.
  Lives at .agents/skills/ for multi-agent discovery (Cursor, Claude Code, etc.).
---

# Rogatio docs accuracy sync

Bring **current-behavior** docs in line with code. Decision records stay frozen.

## When to use

- User asks to update / fix / sync docs, README, AGENTS, architecture, or the docs site
- Post-feature work where user-facing or agent orientation text may lag
- Suspected stale install/start/CLI/platform/security claims

## Non-goals

- Do **not** rewrite `docs/specs/`, `docs/plans/`, `docs/workflows/`, `docs/research/`, or `docs/adrs/` to match current behavior (append-only; `Superseded by:` only when reviewing a record)
- Do **not** invent product behavior; code and tests win
- Do **not** edit in the main checkout
- Do **not** commit `graphify-out/` (gitignored local artifact)

## Source-of-truth priority

1. Code: `packages/`, `samples/`, root `package.json`
2. Tests: `packages/*/test/`, `test/`
3. `docs/architecture.md` (boundaries + decisions)
4. `README.md`, `packages/*/README.md`
5. Decision records (why / rejected — not what the system does now)

Graphify answers are **orientation aids**. If graphify and code disagree, **code wins**.

Live current-behavior surfaces that **must** stay synced with code:

| Surface | Role |
|---------|------|
| `README.md` | User overview + CLI |
| `AGENTS.md` | Agent orientation + pins + DAG |
| `rogatio-overview.md` | Product scope |
| `docs/architecture.md` | Package boundaries / seams |
| `packages/docs-site/src/content/docs/**` | Published user docs |
| `CONTRIBUTING.md` / `samples/*/README.md` | Toolchain pins when mentioned |
| `packages/cli/README.md` | Published CLI package readme |

## Worktree first

```bash
git worktree add -b docs/<short-slug> ~/Projects/github/drmaas/temp/rogatio-<slug> main
cd ~/Projects/github/drmaas/temp/rogatio-<slug>
pnpm install
# confirm: git rev-parse --show-toplevel is the worktree
```

All edits and validation run only in that worktree.

## Graphify (required)

After entering the worktree, **before** drafting doc edits, refresh and query the knowledge graph. Follow the `graphify` skill for install/detect details when the CLI is missing.

### Refresh

```bash
# Prefer incremental when a graph already exists in this worktree
if [ -f graphify-out/graph.json ]; then
  graphify . --update --no-viz
else
  graphify . --no-viz
fi
```

If `graphify` is not on `PATH`, install/resolve via the graphify skill (`uv tool install graphifyy` or equivalent), then re-run. Use worktree root as `INPUT_PATH`. Skip viz (`--no-viz`) unless the user wants HTML.

Optional deeper pass when architecture/DAG claims look badly wrong: `graphify . --mode deep --no-viz` (slower).

### Query before edit

Run these (or close equivalents) and keep answers for the audit:

```bash
graphify query "What are the Rogatio packages and their dependency direction?"
graphify query "What is the public CLI surface and runtime install vs Start/Stop model?"
graphify query "Where do README, AGENTS, architecture, and docs-site disagree with packages/cli and packages/runtime?"
graphify path "@rogatio/schema" "@rogatio/extension"
```

Use further `graphify query` / `explain` / `path` when a specific doc claim is ambiguous (match logging, AI, CA trust, rule statuses).

### After edits (optional but preferred)

```bash
graphify . --update --no-viz
graphify query "Do orientation docs and docs-site still contradict the package DAG or CLI?"
```

Do not treat a clean graphify answer as a substitute for `pnpm validate` or for reading `package.json` / CLI router.

## Audit before edit

Read code, not memory (cross-check graphify answers against these):

1. **Toolchain:** `package.json#packageManager`, `engines.node`, TypeScript version
2. **CLI surface:** `packages/cli/src/index.ts` router cases + `packages/cli/src/commands/*`
3. **Package DAG:** each `packages/*/package.json` `dependencies` (extension ∥ cli; runtime → schema+compiler only; cli depends on runtime)
4. **Runtime model:** extension Start/Stop vs `rogatio runtime install|uninstall|host`; CA/PAC for **request-body** only
5. **Statuses:** `needs runtime` vs `unsupported` in extension/browser-core
6. **UX shipped:** popup / Dashboard / Workspace / AI Assist if still present

Default product decisions unless user overrides:

- Public CLI inventory matches the router (include `ai` when present)
- Docs-site: CLI reference + inventory for AI; long AI prose may stay in root README (no new AI guide page unless asked)
- Light-sync `rogatio-overview.md` when it contradicts code (it poisons orientation)

## Edit order

1. `README.md` + `AGENTS.md` + `rogatio-overview.md` (+ CONTRIBUTING / samples pins)
2. `docs/architecture.md` — targeted hygiene (DAG, security wording, CLI components, remove false “remain accurate” on removed features, fix known factual errors). Not a full rewrite of every feature slice
3. Docs-site **P0** (wrong install/start copy, registry, trust/status, security denials, architecture DAG)
4. Docs-site **P1** (popup/Dashboard/Workspace, `--extension-id`, `trust unsupported` exits 0)
5. `packages/cli/README.md` if CLI flags/commands changed

### Docs-site P0 checklist

- [ ] Splash/install: `@rogatio/cli` (not wrong scope/name)
- [ ] Public npm (not GitHub Packages) unless code says otherwise
- [ ] No bare `rogatio runtime` as “start runtime” — Start/Stop is extension-owned
- [ ] `runtime install --extension-id <id>` documented
- [ ] Response-body does **not** require CA trust
- [ ] Stopped body rules → `needs runtime`; `unsupported` only for capability/adapter phase
- [ ] Platforms: host start unconditional after manifest; request-body CA/PAC gated
- [ ] Security: no false “does not use native messaging / proxy / TLS”
- [ ] Architecture page DAG matches `package.json`; stubs labeled stubs

## Stale-claim greps (live docs only)

After edits, grep **current-behavior** files (not frozen decision trees):

```bash
rg -n '10\.32\.1|@drmaas/rogatio|GitHub Packages|exactly of `edit`|start and connect|macOS runtime lifecycle|Requires the device-local CA trust' \
  README.md AGENTS.md CONTRIBUTING.md rogatio-overview.md docs/architecture.md \
  packages/cli/README.md packages/docs-site samples
```

Adjust patterns to the **previous** wrong pins when the toolchain moves. Expect hits only in frozen `docs/specs|plans|workflows|research` — leave those alone.

## Validation

```bash
pnpm --filter @rogatio/docs-site build
# remove generated packages/docs-site/.astro and dist before validate if biome would scan them
rm -rf packages/docs-site/.astro packages/docs-site/dist
pnpm browser:install   # if .browser-cache missing
pnpm validate
```

Do not declare done on a green unit suite alone when `pnpm validate` includes browser e2e.

## Ship

1. Open (or reuse) a GitHub issue; confirm number with user before inventing
2. Conventional commit: `docs: …` with `Closes #<NN>`
3. Push branch; `gh pr create`
4. After merge: `git pull` on main, `git worktree remove <path>`, delete local/remote feature branch

## Architecture hygiene patterns

- Security boundaries: forbid accounts / telemetry / traffic archive / cloud sync — **do not** deny NM, loopback proxy, or device-local CA that body rules use; describe confinement instead
- Package diagram: `schema → compiler → {editor, dry-run, browser-core} → {cli, extension}`; `runtime` off to the side (schema+compiler); `docs-site` / `sanity` / `smoke` off DAG
- Removed features (e.g. mock rules): mark **fully superseded**; never “remain accurate”
- Duplicate section headings: keep one canonical + rename the other or cross-link

## Additional resources

- Repo agent rules: `AGENTS.md`
- Graphify skill: follow `graphify` for install, detect, and query semantics
- Durable-docs policy: decision trees under `docs/decisions/` → freeze to `docs/{research,specs,plans,workflows}/`
- Site sidebar: `packages/docs-site/astro.config.mjs`
