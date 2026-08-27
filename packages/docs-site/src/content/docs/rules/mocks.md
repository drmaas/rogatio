---
title: Mocks
description: Return a configured response without contacting upstream.
---

Mock rules return a configured response from the local mock/response server. Mocks **never
contact upstream**.

## Behavior

- Configured **status** code.
- Configured **headers**.
- Optional **delay**.
- Either an **inline body** or a **live UTF-8 snapshot** of one approved local file.

## Connecting

- Mocks use `rogatio runtime` and exactly one user-clicked **Check and connect** request.
- Its status represents the last check, not continuous monitoring.
- The mock/response server binds only `127.0.0.1`, pairs through a random capability and
  preset digest, authorizes the exact rule, confines file access, and enforces SSRF,
  DNS-rebinding, redirect, credential, method, timeout, and size controls. It is never a
  general forward proxy or file server.
