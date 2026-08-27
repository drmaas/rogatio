---
title: Offline dry-run
description: Test rules against a bounded batch of URLs without contacting them.
---

Every rule can be tested against a bounded batch of URLs before saving. The offline
dry-run reports regular-expression, effective-origin, method, and resource-type results,
and previews redirect destinations or resulting query URLs.

## What it does

- Evaluates matcher operations for each test URL.
- Reports, per rule, the four matching dimensions: URL regex, effective origin, method,
  and resource type.
- Previews redirect destinations and resulting query URLs.

## What it never does

- Never contacts the tested URL.
- Never requests permission.
- Never changes installed rules.
- Never connects a runtime.
- Never saves the test data.

## Using it

- In the editor: open the **Test rules** panel, enter one URL per line, and run.
- In the CLI: use `rogatio test` with `--urls`, `--urls-file`, and options for method,
  resource type, and batch size (`--max-cases`, default 256).

The dry-run is usable from both the editor and the CLI, and is purely in-memory.
