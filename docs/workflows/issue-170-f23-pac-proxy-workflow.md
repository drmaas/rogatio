> Status: frozen 2026-09-24

# Issue #170 — workflow log (doit)

Feature tree: `docs/decisions/issue-170-f23-pac-proxy/` (freeze: `plan.md` → `docs/plans/issue-170-f23-pac-proxy.md`, `workflow.md` → `docs/workflows/issue-170-f23-pac-proxy-workflow.md`, `notes.md` → `docs/plans/issue-170-f23-pac-proxy-notes.md`).

## Context

- Worktree: `/home/drmaas/Projects/github/drmaas/rogatio-issue-170`, branch `feature/issue-170-f23-pac-proxy`, base `4100b9f` (main). `pnpm install` done.
- Request: implement issue #170 (PAC/chrome.proxy completion for live body-rule rewrite) via the lightweight `doit` workflow; F23 spec/plan already frozen, so no formal spec stage.
- Canonical validation: `pnpm validate` (same fail-fast sequence CI runs).
- **Takeover (2026-09-24):** Cursor agent resumed OpenCode session `ses_f29d74611ffeBqESkZ219Mjv6d`. Decision docs reviewed against code + F23 REQ-1..14 before Stage 3.

## Stage status

- [x] Stage 0 — worktree verified (`git rev-parse --show-toplevel`, branch).
- [x] Stage 1 — brainstorm/scope (ephemeral; no `brainstorm.md`). Notes in `notes.md`. Adversarial pass on takeover (see below).
- [x] Stage 2 — architecture note + ordered plan in `plan.md`. Graphify unavailable; proceeded without.
- [x] Stage 3 — tests first (steps 1–5 of plan).
- [x] Stage 4 — implementation (steps 6–7).
- [x] Stage 5 — verification (`pnpm validate` exit 0). LIVE_E2E body not run (no passwordless sudo).
- [x] Stage 6 — fresh-context review (in-session; Task models usage-limited). Verdict: pass with known LIVE_E2E gap.
- [x] Stage 7 — documentation (README §7b, architecture status, helper comment).
- [x] Stage 8 — freeze + release gate (user authorized freeze/commit/push/PR 2026-09-24).

## Stage 1 adversarial findings (takeover review)

| Severity | Finding | Disposition |
| --- | --- | --- |
| important | Stop order should remove PAC before stopping proxy | Applied in tests + interception.ts |
| important | lifecycle local `getCurrentSession` stub always null | Fixed in Stage 4 (import real) |
| important | InterceptionProvider does not take origins | Host sets `pendingOrigins` from `runtime.start` metadata |
| nit | BN-7 reason code naming | Fixed in notes |
| go | No sdd escalate | Proceeded |

## Stage 6 review findings (2026-09-24)

| Severity | Finding | Disposition |
| --- | --- | --- |
| important | LIVE_E2E body journey not executed (`sudo -n` fails) | Recorded; AC-002/003/004 proven at unit level; live remains operator gate |
| nit | `host.ts` detect hardcodes `controlling* = false` | Acceptable: collision enforced at extension `chrome.proxy` install (`controlled_by_other`) |
| nit | Verbose obsolete comments in host wrapper | Non-blocking; optional cleanup later |
| go | Compile fills group origins into empty rule origins → pacOrigins derivation works | Confirmed with compiler probe |

**Review verdict: pass** (no sdd escalate).

## Model / role selection

| Role | Model | Rationale |
| --- | --- | --- |
| reasoning / plan | prior OpenCode + Cursor inherit | Stage 1–2 recorded |
| adversarial / Stage 6 review | Cursor inherit | Opus/GPT Task blocked by usage limit |
| coding | inherit (Task) | Stages 3–4 |
| verify | inherit | Real `pnpm validate` |
| docs | inherit | Stage 7 |

## Verification record

### Stage 3–4 unit

```sh
rtk pnpm --filter @rogatio/runtime exec vitest run \
  test/interception.test.ts test/intercept-proxy.test.ts \
  test/host-bridge.test.ts test/lifecycle.test.ts test/envelope.test.ts
# exit 0 — 44 passed

rtk pnpm --filter @rogatio/extension exec vitest run \
  test/manifest.test.ts test/chrome.test.ts \
  test/native-session-pac.test.ts test/session.test.ts
# exit 0 — 17 passed
```

### Stage 5 canonical

```sh
rtk pnpm browser:install   # chrome@154.0.8037.57
rtk pnpm validate
# exit 0 — format/lint/typecheck/build; vitest 1009 passed; browser 54 passed / 4 skipped
# (body LIVE_E2E skipped — SUDO_OK=no)
```

### LIVE_E2E body (not run)

```sh
sudo -n true  # fails → SUDO_OK=no
# LIVE_E2E=1 pnpm test:browser -- test/browser/sample-basic-live.test.ts -t "body"
# deferred until passwordless sudo / CA trust available
```
