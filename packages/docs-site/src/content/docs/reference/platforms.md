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
| Redirects, query parameters, request/response headers | Entirely in the browser (DNR). |
| Response-body replacement/rewriting | Local runtime via native messaging. |
| Request-body replacement/modification | Local runtime via native messaging (TLS proxy). |

## Host install and Start/Stop

- Register the native-messaging host with
  `rogatio runtime install --extension-id <id>` (and remove it with `uninstall`).
  On capable platforms the same `install` also provisions and trusts the device-local CA.
- After install, the extension starts and stops the host via **Start runtime** /
  **Stop runtime**. Host start is unconditional once the manifest is registered.
- Response-body and request-body rules share one runtime session. The host itself runs as
  `rogatio runtime host <path>` (normally browser-launched).

## Request-body capability gate

- Request-body interception is separately capability-based: it excludes private browsing,
  cannot compose with another controlling proxy, PAC, extension, or enterprise policy, and
  requires a trusted device-local CA plus non-colliding Chrome PAC routing.
- macOS is the reference supported platform. Linux and Windows may also activate
  request-body interception when those capabilities are present; where they are absent,
  request-body activation reports `unsupported`, while the host can still start for
  response-body rules. Linux/Windows can still verify, edit, import, export, and dry-run
  request-body rules.
