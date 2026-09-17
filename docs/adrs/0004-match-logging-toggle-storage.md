# 0004. Match-logging toggle persistence

## Context

Users must turn match logging on or off from the popup and the management sidebar. The `rogatio` envelope is rebuilt from `version`, `projects`, and `activeProjectId` only, so a flag stored there is dropped. A new protocol command would widen the closed message union for a boolean.

## Decision

Store the flag at `chrome.storage.local` key `rogatio.matchLogging.enabled`, outside the envelope. Popup and management page read and write that key directly. Accessible name **Match logging**. No new protocol command.

**Default on:** missing key enables logging. Boolean `true` enables. Boolean `false` disables. Any other value disables (fail closed on garbage). UI must not read or write `rogatio.matchLogging.index` or the `rogatio` envelope. `createStorageAdapter` keeps reading only `rogatio`.

Amended: earlier plan assumed default off. Product confirmed default on.

## Consequences

- The service worker remains envelope authority; this key is an intentional exception.
- Toggle changes apply on the next match (per-match storage read). No `onChanged` cache.
- Both surfaces share one value with last-write-wins.
- First-run users get console lines without flipping a control.
