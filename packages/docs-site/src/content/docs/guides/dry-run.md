---
title: Offline dry-run
description: Test rules against a bounded batch of URLs without contacting them.
---

Every rule can be tested against a bounded batch of URLs before saving. The offline
dry-run reports source, method, and resource-type results, and previews redirect
destinations, resulting query URLs, header values, and replace-mode body values with URL
captures expanded.

## What it does

- Evaluates matcher operations for each test URL.
- Reports, per rule, the three matching dimensions: source, method, and resource type.
- Previews redirect destinations, resulting query URLs, header values, and
  replace-mode body values.
- Shows `$1` through `$9` values from the matched URL when an action uses captures.

## What it never does

- Never contacts the tested URL.
- Never changes installed rules.
- Never connects a runtime.
- Never saves the test data.

## Using it

- In the editor: open the **Test console** panel, enter one URL per line, and run.
- In the CLI: use `rogatio test` with `--urls`, `--urls-file`, and options for method,
  resource type, and batch size (`--max-cases`, default 256).

The dry-run is usable from both the editor and the CLI, and is purely in-memory.
