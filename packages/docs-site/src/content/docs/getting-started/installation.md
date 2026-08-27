---
title: Installation
description: Install the Rogatio CLI from npm and manually load the Chrome extension.
---

## CLI

The CLI is distributed as an npm package from the public npm registry. It requires
**Node.js 24 or newer**.

1. Install the CLI globally:

   ```bash
   npm install -g @rogatio/cli
   ```

2. Verify the install:

   ```bash
   rogatio --help
   ```

The public CLI consists exactly of `edit`, `verify`, and `runtime`. See the
[CLI reference](/reference/cli/).

## Chrome extension

The extension is **unsigned** and manually loaded from a GitHub Release ZIP. There is no
browser-store install or automatic update.

1. Download the extension ZIP attached to the latest GitHub Release.
2. Unpack it to a stable local directory.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the unpacked extension directory.

Chrome sideloading may require the organization's extension entitlement. The extension
does not request broad host permissions up front; you grant only each project's declared
site access when you import a project (see [Chrome extension](/guides/extension/)).
