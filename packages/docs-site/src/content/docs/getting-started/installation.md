---
title: Installation
description: Install the Rogatio CLI from GitHub Packages and manually load the Chrome extension.
---

## CLI

The CLI is distributed as an npm package through the organization's authenticated GitHub
Packages registry. It requires **Node.js 24 or newer**.

1. Authenticate to GitHub Packages (see your organization's registry docs) so the
   `@rogatio/cli` package can be fetched.
2. Install the CLI:

   ```bash
   npm install -g @rogatio/cli
   ```

3. Verify the install:

   ```bash
   rogatio --help
   ```

The public CLI consists exactly of `edit`, `verify`, and `runtime`. See the
[CLI reference](/reference/cli/).

## Chrome extension

The extension is **unsigned** and manually loaded from a GitHub Release ZIP. There is no
browser-store install or automatic update.

1. Download the extension ZIP from the latest GitHub Release.
2. Unpack it to a stable local directory.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the unpacked extension directory.

Chrome sideloading may require the organization's extension entitlement. The extension
does not request broad host permissions up front; you grant only each project's declared
site access when you import a project (see [Chrome extension](/guides/extension/)).
