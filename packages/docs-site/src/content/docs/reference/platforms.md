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
| Mocks | Local mock/response server (`127.0.0.1`). |
| Response-body rewriting | Local runtime via native messaging. |
| Request-body replacement/modification | Local runtime via native messaging (TLS proxy). |

## Capability-based activation

- **Mocks**, **response-body**, and **request-body** rules use the unified native host, started
  by the browser via the extension's Start/Stop controls; the host itself runs as
  `rogatio runtime host <path>`. Request-body rules additionally use
  `rogatio runtime install | uninstall`; the same `install` command
  also provisions the device-local CA on capable platforms. `uninstall` removes
  the host manifest, the device-local CA files, and the trust installation (idempotent).
- Mock, response-body, and request-body rules share one runtime session.

## Limitations

- Request-body activation is capability-based, excludes private browsing, and cannot compose
  with another controlling proxy, PAC, extension, or enterprise policy.
- The runtime activates only where a trusted device-local CA can be provisioned and Chrome PAC
  routing does not collide with an existing controlling proxy/PAC/extension/enterprise policy.
- macOS is the reference supported platform. Linux and Windows may also activate when those
  capabilities are present; where they are absent, activation reports `unsupported`, and
  Linux/Windows can still verify, edit, import, export, and dry-run request-body rules.
