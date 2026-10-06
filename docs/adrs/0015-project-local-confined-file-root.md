# 0015. Project-local confined file root

## Context

File mocks need device-local filesystem authority. Absolute roots must not enter
exported `.rogatio.json` files. Current descriptor reads still need proof
against concurrent intermediate symlink replacement.

## Decision

Store one user-chosen root in the device-local project record. For a CLI project
opened from a file, default an unset root to that file's directory. Never use
the process working directory. Send the root to the host with
`runtime.project.set`, canonicalize it once, and deny every file read unless the
platform reader can prove the opened descriptor stayed beneath that root.

## Consequences

- Extension exports and repository project files contain no absolute root.
- Extension imports cannot infer an OS path and need an explicit saved root.
- CLI root settings use device-local config keyed by canonical project path, not
  a project sidecar.
- Unsupported confinement reports `unsupported`; it never falls back to
  path-only checks.
