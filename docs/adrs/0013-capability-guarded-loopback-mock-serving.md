# 0013. Capability-guarded loopback mock serving

## Context

Binary file responses can exceed the 64 KiB native-messaging envelope. The
dormant mock faucet adds a second listener, while the unified host already owns
a loopback content listener. Rule ids and preset digests are not secrets.

## Decision

Serve mock responses from the unified host's existing loopback listener. Each
route requires a fresh per-session, per-rule random token and the active preset
digest. Reuse the internal `mock.connect` exchange after start to give tokens to
the extension. Retire the standalone faucet, `--mock-port`, and
`mock.request`/`mock.response`.

## Consequences

- Rendered inline and file bytes travel only over loopback HTTP.
- Native messaging carries bounded config, tokens, digests, status, and errors.
- Tokens are memory-only and expire on stop, disconnect, restart, or project
  replacement.
- There is no user-facing Check-and-connect flow or second mock connection
  state.
