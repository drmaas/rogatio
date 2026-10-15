# Match history — plan

> Status: draft
> Issue: [#204](https://github.com/drmaas/rogatio/issues/204)

## Implementation strategy

TDD for the ring, redaction, storage location, toggle-off clear, and the feed. The service worker owns writes so the page and the popup do not race the ring.

## Steps

1. Add `match-history.ts`: cap, redaction via the console formatters, session key, clear, append seam registration, toggle-off clear, and the Clear message.
2. Add `match-history-view.ts` and a management-page destination named Match history.
3. Register the consumer from the service worker before the match listener.
4. Describe the session exception in `rogatio-overview.md`, `docs/architecture.md`, and the docs-site extension and privacy guides.
5. Test the cap and oldest-drop, redaction, toggle-off clear, session-only storage, pipeline gates, and the live feed.

## Rejected

- Writing history from the page or the popup.
- A second match listener.
- Storing the raw match index entry (it can hold unredacted intent).
