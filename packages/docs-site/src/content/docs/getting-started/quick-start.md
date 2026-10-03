---
title: Quick start
description: Create your first Rogatio project and run a rule in the browser.
---

This quick start creates a project, adds one redirect rule, and runs it in Chrome.

## 1. Start the editor

```bash
rogatio edit
```

The editor opens in your browser. Create a new project, give it a name, and add a group.

## 2. Add a redirect rule

Add a rule of type **Redirect** with:

- A **source** condition: key `url`, operator `regex`, and a value matching the requests
  you want to redirect, e.g. `^https://example\.com/old-path/.*$`.
- A **destination** absolute URL, e.g. `https://example.com/new-path/`.

Use the editor's **URL → exact regex** helper to convert a full URL into a literal
anchored regular expression.

## 3. Test it offline

Open **Test console**. The page says “Check whether these URLs match your rules. Nothing
is contacted, and nothing is saved.” Paste one URL per line and click **Run test**. The
case is a page load (GET). A match names the group and the rule and says where the browser
would go. See [Offline dry-run](/guides/dry-run/).

## 4. Save

Validate and save. This writes `.rogatio.json` in the current directory.

## 5. Run it in Chrome

1. Import the project file into the extension. Any filename works; `.rogatio.json` is the default export name and the file the CLI looks for.
2. **Switch** to the project, open the group, and click **Enable**. The toolbar popup has the same **Enable** / **Disable** button.
3. Browse normally and inspect the visible rule status and toolbar badge.

For response-body or request-body rules, also [start the local runtime](/guides/runtime/).
