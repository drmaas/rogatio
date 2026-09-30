---
title: Platforms & capabilities
description: Supported operating systems, browsers, and capability-based activation.
---

## Operating systems

Supported operating systems are **Linux, Windows, and macOS**. Chrome is the currently
supported browser.

## Where rules run

| Rule type | Runs in |
|-----------|---------|
| Static redirects, query parameters, request/response headers | Entirely in the browser (DNR). |
| Capture-dependent query and header values | Native runtime path; never installed as literal `$1` text. |
| Response-body replacement/rewriting | Local runtime via native messaging. |
| Request-body replacement/modification | Local runtime via native messaging (TLS proxy). |

## Host install and Start/Stop

- Register the native-messaging host with
  `rogatio runtime install` and remove it with `uninstall`. Release users never
  pass `--extension-id`. That flag is only for development (a local unpacked
  build without the release key) and for forks.
  The same transactional `install` also provisions and trusts the device-local CA, or
  rolls back and exits `1` when elevation or a required capability is missing.
- `rogatio runtime verify` checks the manifest, the `runtime-host` wrapper, the allowed
  origins (including whether they list the release extension ID), and the CA trust on
  any platform.
- After install, the extension starts and stops the host via **Start runtime** /
  **Stop runtime**. Host start is unconditional once the manifest is registered.
- Response-body and request-body rules share one runtime session. The host itself runs as
  `rogatio runtime host <path>` (normally browser-launched).

CA trust adapters exist for all three supported operating systems; each needs different
privilege. Linux shells out to `sudo update-ca-certificates`, macOS uses
`security add-trusted-cert` against the login keychain, and Windows uses
`certutil -addstore` into `Cert:\CurrentUser\Root`.

## Request-body capability gate

- Request-body interception is separately capability-based: it excludes private browsing,
  cannot compose with another controlling proxy, PAC, extension, or enterprise policy, and
  requires a trusted device-local CA plus non-colliding Chrome PAC routing.
- macOS is the reference supported platform. Linux and Windows may also activate
  request-body interception when those capabilities are present; where they are absent,
  request-body activation reports `unsupported`, while the host can still start for
  response-body rules. Linux/Windows can still verify, edit, import, export, and dry-run
  request-body rules.
