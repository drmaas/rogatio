---
title: Quick start
description: Create your first Rogatio project and run a rule in the browser.
---

This quick start creates a project, adds one redirect rule, and runs it in Chrome.

## 1. Start the editor

```bash
rogatio edit
```

The editor opens in your browser. Create a new project, give it a name, and add a group
with one or more site origins (for example `https://example.com`).

## 2. Add a redirect rule

Add a rule of type **Redirect** with:

- A **URL regular expression** matching the requests you want to redirect, e.g.
  `^https://example\.com/old-path/.*$`.
- A **destination** absolute URL, e.g. `https://example.com/new-path/`.

Use the editor's **URL → exact regex** helper to convert a full URL into a literal
anchored regular expression.

## 3. Test it offline

Open the **Test rules** panel, paste a few URLs, and confirm the rule matches as
expected. The dry-run never contacts the URLs, requests permission, or changes installed
rules. See [Offline dry-run](/guides/dry-run/).

## 4. Save

Validate and save. This writes `.rogatio.json` in the current directory.

## 5. Run it in Chrome

1. Import the `.rogatio.json` file into the extension.
2. **Review** the complete project and **grant** only its declared site access.
3. **Switch** to the project, then explicitly **activate** the group.
4. Browse normally and inspect the visible rule status and toolbar badge.

For response-body or request-body rules, also [start the local runtime](/guides/runtime/).
