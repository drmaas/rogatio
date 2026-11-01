# F23 — Unified Native-Host Runtime Workflow

## Tier and model assignment

- Tier: **session model** (user explicitly selected the current session model).
- Brainstorm, adversarial brainstorm, architecture, specification, plan, tests,
  implementation, verification, independent review, and documentation: session model,
  kept as distinct role passes.
- No delegated external model or fallback was used.

## Worktree

- Branch: `feature/native-host-start-stop`
- Worktree: `/home/drmaas/.local/share/opencode/worktree/rogatio/feature/native-host-start-stop`
- Base: `77674bb` (`main`)
- Main checkout was clean before worktree creation.

## User decisions

- Start configures scoped PAC/proxy routing automatically.
- CLI remains installer/admin functionality only, not an operational connect/proxy requirement.
- Device-local CA trust is a one-time setup prerequisite, not repeated by Start.
- Unsupported/non-transformable requests pass through untouched.
- Only the highest-priority matching request-body rule applies.
- Mock, response-body, and request-body behavior share one native host.

## Stage status

| Stage | Status | Notes |
| --- | --- | --- |
| 0 Worktree | done | Dedicated feature worktree confirmed before edits. |
| 1 Brainstorm | done | Synthesized current runtime, CLI, extension, and architecture; adversarial omissions considered. |
| 2 Architecture | done | Unified host-owned proxy/TLS/session boundary recorded in F23 spec and plan. |
| 3 Specification | done | `docs/specs/f23-unified-native-host-runtime.md` created. |
| 4 Human review gate | done | User approved the specification and instructed continuation. |
| 5 Implementation plan | done | `docs/plans/f23-unified-native-host-runtime.md` created. |
| 6 Tests first | pending | Must author tests before production implementation. |
| 7 Implementation | pending | Not started. |
| 8 Verification | pending | Canonical validation required. |
| 9 Independent review | pending | Fresh-context review, maximum three rounds. |
| 10 Documentation | pending | Synchronize architecture, README, and affected runtime docs after behavior stabilizes. |
| 11 Release | pending | No commit/push/cleanup authorization. |

## Approved architecture summary

One registered native host owns the runtime lifecycle, mock handling, response-body
handling, request-body transformation, internal loopback proxy, TLS termination, and
upstream forwarding. Native messaging carries lifecycle and metadata/control only;
request/response bodies remain in the host-owned interception path. Start is transactional
and installs scoped PAC/proxy routing; Stop removes only owned routing, aborts active work,
and restores the previous browser configuration.
