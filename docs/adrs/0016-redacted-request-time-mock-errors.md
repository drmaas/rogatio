# 0016. Redacted request-time mock errors

## Context

A file can fail after a rule installs. The extension needs a visible per-rule
error without exposing a logical or absolute path or adding a push channel.

## Decision

Keep a bounded, in-memory map from rule id to stable error code. Expose it on
the existing runtime status reply. Clear one entry after a successful read, and
clear all entries on project save or host restart.

## Consequences

- The next existing state refresh shows or clears the rule error.
- Diagnostics contain stable codes only, with no path or third-party text.
- No traffic history, subscription, polling timer, or persistent error store is
  added.
