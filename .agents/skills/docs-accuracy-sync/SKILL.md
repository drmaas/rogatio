---
name: docs-accuracy-sync
description: >-
  Sync Rogatio orientation docs and the Starlight docs-site with shipped code.
  Use when updating README, AGENTS.md, docs/architecture.md, rogatio-overview.md,
  packages/docs-site content, package READMEs, or when docs drift from CLI/runtime/
  extension behavior (pnpm pin, package DAG, install commands, host vs CA).
  Queries the main checkout's graphify graph (packages/ only, built once in the
  main checkout) before editing. Lives at .agents/skills/ for multi-agent discovery
  (Cursor, Claude Code, etc.).
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
- Do **not** edit in the main checkout (the one exception is a graphify rebuild, which runs there and writes nothing tracked)
- Do **not** commit `graphify-out/` (gitignored local artifact)
- Do **not** build a graph in a worktree; read the main checkout's graph with `--graph`
- Do **not** graph anything but `packages/`

## Source-of-truth priority

1. Code: `packages/`, `samples/`, root `package.json`
2. Tests: `packages/*/test/`, `test/`
3. `docs/architecture.md` (boundaries + decisions)
4. `README.md`, `packages/*/README.md`
5. Decision records (why / rejected — not what the system does now)

Graphify answers are **orientation aids**. If graphify and code disagree, **code wins**. The graph is built from `main` and only covers `packages/`, so it is always one branch behind the current worktree — treat every answer as a lead to verify, never as evidence.

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
git worktree add -b docs/<short-slug> <worktree-parent>/rogatio-<slug> main
cd <worktree-parent>/rogatio-<slug>
pnpm install
# confirm: git rev-parse --show-toplevel is the worktree
```

`<worktree-parent>` is any stable directory outside the clone (see `AGENTS.md`, Worktree Convention). Never hardcode one contributor's home path.

All edits and validation run only in that worktree.

## Graphify (required)

After entering the worktree, **before** drafting doc edits, query the knowledge graph. Follow the `graphify` skill for install/detect details when the CLI is missing.

Two fixed rules keep the graph cheap and consistent across worktrees:

1. **Graph `packages/` only.** The corpus is the product source, never the repo root. `docs/`, `test/`, `samples/`, and decision records are prose, not product code; graphing them buries the package graph in document nodes.
2. **The graph lives in the main checkout, not in worktrees.** One graph per repository, built from `main`'s `packages/`. Worktrees read it; they never build one.

Resolve the main checkout from git, not from a hardcoded path. `git worktree list` lists every checkout; the one whose branch is `main` is the graph owner:

```bash
MAIN=${ROGATIO_MAIN:-$(git worktree list --porcelain | awk '$1=="worktree"{p=$2} $1=="branch" && $2=="refs/heads/main"{print p; exit}')}
GRAPH="$MAIN/graphify-out/graph.json"
```

`ROGATIO_MAIN` is the escape hatch for clones that are not registered as worktrees.

### Query (every worktree, every run)

Point the read commands at the main checkout's graph. `--graph` overrides the default `graphify-out/graph.json` lookup, so these work from any worktree:

```bash
graphify query "What are the Rogatio packages and their dependency direction?" --graph "$GRAPH"
graphify query "What is the public CLI surface and runtime install vs Start/Stop model?" --graph "$GRAPH"
graphify query "Where do README, AGENTS, architecture, and docs-site disagree with packages/cli and packages/runtime?" --graph "$GRAPH"
graphify path "@rogatio/schema" "@rogatio/extension" --graph "$GRAPH"
graphify explain "createRequestBodyTrustController" --graph "$GRAPH"
```

Use further `graphify query` / `explain` / `path` / `affected` when a specific doc claim is ambiguous (match logging, AI, CA trust, rule statuses). `query` / `path` / `explain` / `affected` all accept `--graph`.

### Refresh (main checkout only, or an explicit user request)

Never run this from a worktree. Refresh in the main checkout after code lands on `main`, or when the user explicitly asks for a rebuild:

```bash
cd "$MAIN"
if [ -f graphify-out/graph.json ]; then
  graphify packages --update --no-viz --code-only --out .
else
  graphify packages --no-viz --code-only --out .
fi
```

Notes:

- `INPUT_PATH` is `packages`, not `.`.
- `--code-only` is required. Without it graphify indexes the 23 docs and 4 images under `packages/` and dies on `error: no LLM API key found (27 doc/paper/image file(s) need semantic extraction)`.
- `--out .` is required. Output otherwise lands in `packages/graphify-out/`, where the default `--graph` lookup and the Biome exclude (`!!graphify-out`) do not reach it.
- Skip viz (`--no-viz`) unless the user wants HTML.
- An `--update` run does not regenerate `GRAPH_REPORT.md`; follow it with `graphify cluster-only packages --graph graphify-out/graph.json --no-viz`. Skip that step when community names are not needed.
- Optional deeper pass when DAG claims look badly wrong: `graphify packages --mode deep --no-viz --code-only --out .` (slower).
- If `graphify` is not on `PATH`, install/resolve via the graphify skill (`uv tool install graphifyy` or equivalent), then re-run.
- `graphify-out/.graphify_root` records the scanned root; it should end in `/packages`. If it reads anything else, the last build used the wrong `INPUT_PATH`.
- A worktree that needs a fresher graph than `main` has is a signal to ask the user, not to build locally.

### After edits (optional but preferred)

Re-run the relevant read commands against the same main-checkout graph. Do not rebuild:

```bash
graphify query "Do orientation docs and docs-site still contradict the package DAG or CLI?" --graph "$GRAPH"
```

Do not treat a clean graphify answer as a substitute for `pnpm validate` or for reading `package.json` / CLI router. A worktree graph is always one branch behind, so code reading wins on every claim it touches.

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
4. Docs-site **P1** (popup/Dashboard/Workspace, `--extension-id`, `runtime verify`, `trust unsupported` exits 1 with the manifest rolled back)
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
- [ ] Dry-run is described as **3-dimension** (source, method, resourceType), never 4-dim
- [ ] `runtime install` trust failure → **exit 1 with the manifest rolled back**, never “exit 0, manifest installed, CA skipped”
- [ ] Every routed subcommand is listed: `runtime install | uninstall | verify | host`, and top-level `edit | test | verify | runtime | ai`

## Stale-claim greps (live docs only)

After edits, grep **current-behavior** files (not frozen decision trees):

```bash
rg -n '10\.32\.1|@drmaas/rogatio|GitHub Packages|exactly of `edit`|start and connect|macOS runtime lifecycle|Requires the device-local CA trust|4-dim|exits? `?0`? \(manifest' \
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
- Graphify skill: follow `graphify` for install, detect, and query semantics. Corpus is `packages/`; the graph lives in the main checkout (`$MAIN/graphify-out/`, resolved via `git worktree list`) and worktrees read it with `--graph`
- Durable-docs policy: decision trees under `docs/decisions/` → freeze to `docs/{research,specs,plans,workflows}/`
- Site sidebar: `packages/docs-site/astro.config.mjs`
