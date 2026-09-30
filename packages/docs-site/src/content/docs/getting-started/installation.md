---
title: Installation
description: Install the Rogatio CLI from npm and manually load the Chrome extension.
---

## CLI

The CLI is distributed as an npm package from the public npm registry. It requires
**Node.js 24 or newer**. Install the CLI globally with your preferred package manager:

```sh
npm install -g @rogatio/cli
```

```sh
pnpm add -g @rogatio/cli
```

```sh
bun add -g @rogatio/cli
```

```sh
vp install -g @rogatio/cli
```

Verify the install:

```sh
rogatio --help
```

The public CLI consists of `edit`, `verify`, `test`, `runtime`, and `ai`. See the
[CLI reference](/reference/cli/).

## Chrome extension

The extension is **unsigned** and manually loaded from a GitHub Release ZIP. There is no
browser-store install or automatic update.

1. Download the extension ZIP attached to the latest
   [GitHub Release](https://github.com/drmaas/rogatio/releases).
2. Unpack it to a stable local directory.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the unpacked extension directory.

Release builds include a public `key` in the extension manifest, so Chrome assigns
the same extension ID no matter which folder you unpack into. Upgrading is: unpack
the new ZIP (a different folder is fine), load it, and leave the previous unpacked
copy disabled or removed so only one Rogatio is loaded.

If this machine already ran `rogatio runtime install` against an older,
path-derived extension ID, run `rogatio runtime install` again after loading the
new build (same elevation as the first install; no `--extension-id` for a release
build). That rewrites the native host's `allowed_origins`. `rogatio runtime verify`
prints the command when the host is still pinned to a different ID. Dev or forked
builds that do not carry the release key pass `--extension-id <id>` instead.

Chrome sideloading may require the organization's extension entitlement. The extension
declares broad host access (`*://*/*`) at install time so DNR rules can match any HTTP(S)
URL your projects describe; there is no per-origin grant step (see
[Chrome extension](/guides/extension/)).
