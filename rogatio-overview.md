# Rogatio — Product and Technical Overview

## What it is

Rogatio is a local-first tool for creating, reviewing, and running browser request and response rules. It replaces six selected Requestly workflows with one version-controlled `.rogatio.json` file, a CLI, and a Chrome extension. The application uses an extensible browser-extension boundary so additional browser extensions can be added in the future. The repository file is canonical; moving changes between it and a browser requires explicit import or export. Rogatio has no accounts, hosted runtime, cloud sync, telemetry, or retained traffic history.

## Complete functionality

Rules belong to named groups. Each rule specifies a stable ID, a source condition (`key` `url` or `host`, `operator` `regex`, case-sensitive `value`), resource types, priority, and—where supported—an HTTP method.

- **Redirects:** Send matching HTTP(S) requests to an absolute destination, including controlled regular-expression capture substitution. `$1`–`$9` are canonical; existing redirect `\\1`–`\\9` values remain compatible.
- **Query parameters:** Set or remove configured parameter names per rule. Set adds missing names and replaces all existing values for configured names; remove drops configured names from the query string. Set values may use URL captures. Unrelated parameters, scheme, authority, path, and fragment are preserved.
- **Request and response headers:** Set, append, or remove a named header, subject to immutable forbidden-header lists and browser limitations. Set and append values may use URL captures.
- **Response body:** Fetch an authorized public GET without browser credentials, then either replace the entire response body or apply bounded regex rewrites to the fetched UTF-8 body through native messaging to an explicitly started local runtime. Replace bodies may use URL captures. Upstream status and headers are preserved.
- **Request-body replacement/modification:** Replace a complete body or apply bounded global ECMAScript regular-expression replacement to eligible POST, PUT, or PATCH XHR requests. Replace bodies may use URL captures; regex-mode replacements retain body-regex captures. Supported inputs are bounded UTF-8 JSON, form-encoded, or textual bodies without unsupported framing, encoding, or signatures. This feature works in existing Chrome profiles on macOS through native messaging to a separately installed native runtime.

Every rule can be tested against a bounded batch of HTTP(S) URLs before saving. This offline dry run reports source, method, and resource-type results and previews substituted action values. It never contacts the tested URL, requests permission, changes installed rules, connects to a runtime, or saves the test data.

## User experience

The typical workflow is:

1. Install the Node 24+ CLI and manually load the Chrome extension.
2. Run `rogatio edit`, create or update rules in the visual editor, test them, verify them, and save `.rogatio.json`.
3. Import the file into Chrome, review the complete project, and activate groups when ready.
4. Explicitly activate the required groups.
5. Start the local runtime from the extension's **Start runtime** control when response-body rules or request-body rules require one. Stop it from the extension's **Stop runtime** control when done.
6. Use the browser normally, inspect visible rule statuses, and export the browser project if browser-side edits should replace the repository file.

The CLI and Chrome extension share one accessible, framework-free editor. Users can edit project metadata; create, copy, and remove groups; create, copy, reorder, and remove rules; convert URLs to exact-match regular expressions; validate, save, cancel unsaved changes; and inspect field-level errors. The responsive workspace provides a Project destination, one destination per group, a Test console destination, project-wide group/rule search, a contextual command bar, desktop route rail, and compact mobile navigation. Entity actions (add/copy rule, rule reorder/remove, copy/remove group) sit next to their content. It supports keyboard use, screen readers, narrow layouts, forced colors, and 200% zoom.

Each browser profile can retain up to 64 uniquely named projects and has exactly one active project whenever any exist. Users explicitly create, import or update, switch, edit, export, and remove projects. Merely choosing a project in the selector has no effect until Switch project is selected. Creation, import/update, and browser save leave every group disabled; group activation remains a separate visible action. Switching restores the destination project's saved enablement choices without contacting a local runtime. Conflicts preserve committed state and provide an explicit refresh path, while removal uses a named, cancelable confirmation.

Rules visibly report `active`, `disabled`, `needs runtime`, `unsupported`, or `error`; the toolbar badge reflects the successfully installed active rules. Redirect, query, and header rules run entirely in the browser. Response-body and request-body rules use native messaging through the unified `rogatio runtime` host, started and stopped from the extension's Start/Stop runtime controls. Request-body rules use the trust lifecycle `rogatio runtime install` (a single command that provisions both the native-messaging host and, on capable platforms, the device-local CA), and `rogatio runtime uninstall` to remove the host registration, the device-local CA files, and the CA trust; the native-messaging host itself runs as `rogatio runtime host <path>`.

CA trust installation requires elevated privileges: Linux requires `sudo` (passwordless or prompted), macOS requires keychain authorization, and Windows requires Administrator. The `rogatio runtime install` command reports `trust unsupported: <reasons>` when elevation is unavailable and exits 0 (the manifest is still installed; only the CA trust step is skipped).

When Chrome authoritatively reports a Rogatio-installed DNR rule match (unpacked extension load only), the extension can place one bounded, redacted, live-only lowercase `[rogatio]` line in the matched page's DevTools Console. **Match logging** is controlled by a popup and management-sidebar toggle (default **on**). Coverage is redirect, query, and header rules, plus body rules when session URL-match markers are installed and indexed on the same `onRuleMatchedDebug` pipeline (matcher rules are not logged). Body markers install only while a native session is active and the runtime strip path is available; production keeps that strip gate fail-closed (`false`) until live traffic hits strip, so body kinds stay silent until the gate flips. Live fields are URL, method, initiator, and resource type; intended redirect, query, header, or body action plus rule id and display name come from rule config. Present fields are labeled (`method=`, `type=`, `url=`, `ruleId=`, `name=`, `kind=`, `initiator=`); absent fields omit their key. The line reports a match and intended action — not proof the network operation or body rewrite succeeded — and logs no live request/response bodies. Any rule card may opt into **Redact sensitive fields in logs** (default off). No history or management-page feed is created (#204 may reuse the append seam later).

## Architecture and technology

Rogatio is a strict TypeScript 7, ESM/NodeNext monorepo using pnpm 12.4.1 as its package manager:

- **`schema`** owns the version-2 JSON Schema, generated AJV validation, source conditions, bounds, forbidden headers, and v1→v2 migration.
- **`compiler`** converts validated source into browser-neutral operations and stable diagnostics.
- **`browser-core`** owns versioned project storage, migrations, enablement, compare-and-swap lifecycle, atomic rule installation and recovery, runtime state, diagnostics, and badge state.
- **`editor`** provides the shared framework-free DOM controller and accessible view.
- The Chrome Manifest V3 package translates neutral rules to WebExtensions and Declarative Net Request APIs. The extension boundary is designed to accommodate additional browser extensions in the future.
- **`cli`** bundles the editor host, file verification, offline dry-run (`test`), AI provider configuration (`ai`), and runtime dispatch (`install` / `uninstall` / `host`).
- **`runtime`** supplies reusable bounded response-body and request-body transformation/runtime components. The native host and runtime-owned request-body TLS proxy remain separate processes.

The native runtime binds only `127.0.0.1`, pairs through a random capability and preset digest, authorizes the exact rule, confines file access, and enforces SSRF, DNS-rebinding, redirects, credentials, method, timeout, and size controls. It is never a general forward proxy or file server. The macOS runtime uses native messaging for control and response-body and request-body transformation routing, along with scoped Chrome PAC or proxy routing, an ephemeral TLS proxy, and a device-local CA. It independently revalidates project, rule, URL/source match, method, initiator, and target same-origin authority; observed bodies are never persisted, logged, exported, or transferred through native messaging.

Builds use esbuild. Quality gates use Biome for formatting and linting, strict TypeScript checks, Vitest for unit testing, and Selenium (Chrome for Testing) for end-to-end headless browser testing, along with integration tests, browser journeys, and packaged-install tests. GitHub Actions and semantic-release, using the semantic-release plugin, publish the CLI module to npmjs.org and the extension ZIP files as GitHub Releases. The extension and npm module use consistent versioning, with the same version also recorded in the Git tag. The documentation site uses Astro and Starlight.

## Supported platforms, distribution, and boundaries

Supported operating systems are Linux, Windows, and macOS. Chrome is the currently supported browser. The application is designed to support adding additional browser extensions in the future.

The public CLI consists of `edit`, `verify`, `test`, `runtime`, and `ai`. It is distributed as an npm package from the public npm registry. The Chrome extension is unsigned and manually loaded from a GitHub Release ZIP, with no browser-store installation or automatic updates. Chrome sideloading may require the organization's extension entitlement.

After `rogatio runtime install --extension-id <id>` registers the native-messaging host, the extension can start and stop the host unconditionally via **Start runtime** / **Stop runtime**. Request-body interception is separately capability-based: it excludes private browsing, cannot compose with another controlling proxy, PAC, extension, or enterprise policy, and requires a trusted device-local CA plus non-colliding Chrome PAC routing. macOS is the reference supported platform; Linux and Windows may also activate request-body interception when those capabilities are present. Where they are absent, request-body activation reports `unsupported` while the host can still start for response-body rules; Linux and Windows can still verify, edit, import, export, and dry-run request-body rules.
