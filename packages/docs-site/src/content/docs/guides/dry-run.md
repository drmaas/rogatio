---
title: Offline dry-run
description: Test rules against a bounded batch of URLs without contacting them.
---

Every rule can be tested against a bounded batch of URLs before saving. Nothing is
contacted, and nothing is saved. The same preview is used by `rogatio test`, the editor
Test console, and the extension Workspace.

## What it does

- Checks each URL against the compiled rules: the URL pattern, the method, and the
  resource type.
- Previews a redirect destination, the resulting query, a header value, and a replace-mode
  request or response body, with `$1` through `$9` expanded from the matched URL.
- In the editor, shows one sentence per matching rule. The rule name opens that rule.
  Rules that did not match stay collapsed, each with one reason (URL pattern, method, or
  resource type).

## What it never does

- Never contacts the tested URL.
- Never changes installed rules.
- Never connects a runtime.
- Never saves the test data.

## Using it

Open **Test console**. The page says “Check whether these URLs match your rules. Nothing
is contacted, and nothing is saved.” Enter one URL per line and click **Run test**. The
default case is a page load (GET), and the form says “Checking these as page loads (GET).”
Choose **Any method** or **Any resource type** only when you want that constraint left
untested; a match then says so. Up to 256 URLs can be checked at once. The editor mentions
that limit only when the list is longer. A project with no rules says “This project has no
rules to test.”

In the extension Workspace, Run test uses the current draft. A match in a group that is
off still shows, with “This group is off in Chrome, so the browser will not apply this
rule.”

In the CLI, `rogatio test` accepts `--urls`, `--urls-file`, `--method`, `--resource-type`,
and `--max-cases` (default 256). `--json` is the machine-readable result. The human report
still lists each rule with its match detail.

The dry-run is in memory only.
