---
title: Introduction
description: Rogatio is a local-first tool for creating, reviewing, and running browser request and response rules.
---

Rogatio is a local-first tool for creating, reviewing, and running browser request and
response rules. It replaces a handful of ad-hoc Requestly workflows with one
version-controlled `.rogatio.json` file, a CLI, and a Chrome extension. The repository
file is canonical — moving changes between it and the browser requires an explicit import
or export.

Rogatio has **no accounts, hosted runtime, cloud sync, telemetry, or retained traffic
history**.

## What you can do

- **Redirect** matching requests to an absolute destination, with controlled capture substitution.
- **Add or replace query parameters** while preserving unrelated ones.
- **Set, append, or remove request and response headers**, subject to immutable forbidden-header lists.
- **Mock** responses with a configured status, headers, delay, and inline or file-snapshot body.
- **Rewrite response bodies** by fetching an authorized public GET and applying bounded replacement through a local runtime.
- **Replace or modify request bodies** for eligible POST/PUT/PATCH XHR via the local runtime.
- **Test** any rule against a bounded batch of URLs offline before saving.

## Components

| Component | Purpose |
|-----------|---------|
| CLI (`rogatio`) | `edit`, `verify`, and `runtime` commands. Published to GitHub Packages. |
| Chrome extension | Imports/exports the project file, grants declared site access, and runs redirect/query/header/mock rules in-browser. |
| Local runtime | macOS native-messaging process for response-body and request-body rules. |
| `.rogatio.json` | The single source of truth, version-controlled in your repo. |

Continue with [Installation](/getting-started/installation/).
