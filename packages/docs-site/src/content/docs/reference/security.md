---
title: Security & privacy
description: Rogatio's local-first, no-telemetry security and privacy model.
---

Rogatio is local-first by design.

## What Rogatio does not do

- No accounts, hosted runtime, cloud sync, or telemetry.
- No retained traffic history.
- No credentials, telemetry, hosted endpoints, traffic capture, native messaging, proxies,
  TLS handling, or persistent user data beyond the version-controlled `.rogatio.json`
  project file.

## Boundaries

- The **repository file is canonical**; moving changes between it and the browser requires
  explicit import or export.
- The **browser grant is not a security boundary**. Every native-messaging transformation is
  re-validated against the canonical `.rogatio.json` (rule existence, URL regex match, origin
  membership, method, resource type, initiator scope, target origin).
- The **mock/response server** binds only `127.0.0.1`, pairs through a random capability and
  preset digest, authorizes the exact rule, confines file access, and enforces SSRF,
  DNS-rebinding, redirect, credential, method, timeout, and size controls. It is never a
  general forward proxy or file server.
- The **local runtime** independently revalidates project, rule, URL, method, initiator,
  target, permission, and grant authority.

## Body confidentiality

Observed request/response bodies are processed in-process only. The native-messaging envelope
carries bounded metadata and transform instructions, never body bytes, credentials, sensitive
header values, or file contents. Observed bodies are never persisted, logged, exported, or
transferred through native messaging.

## Forbidden headers

Request/response header rules are subject to immutable forbidden-header lists owned by the
schema package and matched case-insensitively; these cannot be overridden by a rule.
