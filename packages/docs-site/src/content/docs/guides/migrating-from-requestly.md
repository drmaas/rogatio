---
title: Migrating from Requestly
description: Turn a Requestly rule export into a Rogatio project with rogatio import requestly.
---

Rogatio can read a Requestly rule export and write a version-2 `.rogatio.json`.
The command maps the rule types Rogatio can represent and prints every rule it
changed or skipped.

```sh
rogatio import requestly requestly-export.json --out .rogatio.json
```

`--out` defaults to `.rogatio.json` in the current directory. If that file
already exists, the command stops and leaves it untouched. Pass `--merge` to
append the imported groups onto a valid project, keeping the existing name,
description, and request-body policy.

```sh
rogatio import requestly requestly-export.json --merge
```

`--json` prints the same report as JSON, including the path that was written.

## What is imported

| Requestly rule | Rogatio rule |
| --- | --- |
| Redirect to an absolute http(s) URL | Redirect. `$1`–`$9` in the destination become `\1`–`\9`. |
| Replace, when the text to replace is a fixed part of an http(s) URL | Redirect that substitutes the first literal occurrence. |
| Query parameter add or remove | Query parameter set or remove. |
| Header add, remove, or modify | One header rule per modification. |
| User agent | Request header `User-Agent`. |
| Static request body | Request-body replace, for `xmlhttprequest` and `POST`, `PUT`, or `PATCH`. |
| Static response body | Response-body replace. Rogatio still fetches the upstream response and keeps its status and headers. |

Requestly source operators (`Equals`, `Contains`, `Wildcard`, `Matches`) are
lowered to a Rogatio regular expression. A host condition that is a literal
hostname matches that hostname on any port, which the report calls out.
Several request methods become one Rogatio rule per method.

## What is skipped

Cancel, delay, and script rules are skipped. So are local-file and mock
redirects, JavaScript request or response bodies, response files on disk, and
"remove all query parameters". Page URL, page domain, and request payload
filters are skipped rather than widened to match more traffic. A forbidden
header modification is not imported.

Each skipped rule is listed with its Requestly name and the reason. Skipped
rules do not fail the command. Changed rules list what differs from Requestly.
The written file is validated with the same checks as `rogatio verify` before
it is saved.
