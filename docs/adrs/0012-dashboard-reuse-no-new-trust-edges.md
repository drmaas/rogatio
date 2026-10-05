# 0012. Dashboard reuses existing commands and metadata-only AI shape

## Context

The Dashboard system-status card shows the same runtime/AI truth as the Workspace sidebar. The native host holds the AI key; the page must never see it. New commands, storage, or network paths would widen the trust boundary.

## Decision

Reuse existing commands (`refresh`, `check-ai-support`, `diagnose-native-runtime`, start/stop) with unchanged `protocol.ts` shapes; the service worker keeps returning AI metadata only (`supported`/`reported`/`providerUrl`/`model`), and the page keeps copying only the two display strings into `textContent` DOM.

## Consequences

- No new permissions, storage keys, network calls, or trust edges.
- Dashboard and sidebar cannot drift on key handling; key-absence browser assertion covers both.
- Any future surface needing secrets must revisit this ADR.
