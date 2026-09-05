# Rogatio — Product and Technical Overview

## What it is

Rogatio is a local-first tool for creating, reviewing, and running browser request and response rules. It replaces six selected Requestly workflows with one version-controlled `.rogatio.json` file, a CLI, and a Chrome extension. The application uses an extensible browser-extension boundary so additional browser extensions can be added in the future. The repository file is canonical; moving changes between it and a browser requires explicit import or export. Rogatio has no accounts, hosted runtime, cloud sync, telemetry, or retained traffic history.

## Complete functionality

Rules belong to named groups. Groups can define shared site origins, while individual rules can add origins and specify a stable ID, case-sensitive URL regular expression, resource types, priority, and—where supported—an HTTP method.

- **Redirects:** Send matching HTTP(S) requests to an absolute destination, including controlled regular-expression capture substitution.
- **Query parameters:** Add missing configured parameters and replace all existing values for configured names while preserving unrelated parameters, scheme, authority, path, and fragment.
- **Request and response headers:** Set, append, or remove a named header, subject to immutable forbidden-header lists and browser limitations.
- **Mocks:** Return a configured status, headers, optional delay, and either an inline body or a live UTF-8 snapshot of one approved local filename. Mocks never contact upstream.
- **Response-body rewriting:** Fetch an authorized public GET without browser credentials and perform bounded textual replacement through native messaging to an explicitly started local runtime.
- **Request-body replacement/modification:** Replace a complete body or apply bounded global ECMAScript regular-expression replacement to eligible POST, PUT, or PATCH XHR requests. Supported inputs are bounded UTF-8 JSON, form-encoded, or textual bodies without unsupported framing, encoding, or signatures. This feature works in existing Chrome profiles on macOS through native messaging to a separately installed native runtime.

Every rule can be tested against a bounded batch of HTTP(S) URLs before saving. This offline dry run reports regular-expression, effective-origin, method, and resource-type results and previews redirect destinations or resulting query URLs. It never contacts the tested URL, requests permission, changes installed rules, connects to a runtime, or saves the test data.

## User experience

The typical workflow is:

1. Install the Node 24+ CLI and manually load the Chrome extension.
2. Run `rogatio edit`, create or update rules in the visual editor, test them, verify them, and save `.rogatio.json`.
3. Import the file into Chrome, review the complete project, and grant only its declared site access.
4. Explicitly activate the required groups.
5. Start the local runtime from the extension's **Start runtime** control when mocks, response-body rules, or request-body rules require one. Stop it from the extension's **Stop runtime** control when done.
6. Use the browser normally, inspect visible rule statuses, and export the browser project if browser-side edits should replace the repository file.

The CLI and Chrome extension share one accessible, framework-free editor. Users can edit project metadata; create, reorder, and remove groups and rules; convert URLs to exact-match regular expressions; validate, save, cancel unsaved changes; and inspect field-level errors. The responsive workspace provides a Project destination, one destination per group, project-wide group/rule search, a contextual command bar, desktop route rail, and compact mobile navigation. It supports keyboard use, screen readers, narrow layouts, forced colors, and 200% zoom.

Each browser profile can retain up to 64 uniquely named projects and has exactly one active project whenever any exist. Users explicitly create, import or update, switch, edit, export, and remove projects. Merely choosing a project in the selector has no effect until Switch project is selected. Creation, import/update, and browser save leave every group disabled; permission and group activation remain separate visible actions. Switching restores the destination project's saved enablement choices without requesting permission or contacting a local runtime. Conflicts preserve committed state and provide an explicit refresh path, while removal uses a named, cancelable confirmation.

Rules visibly report `active`, `disabled`, `needs permission`, `needs proxy`, `unsupported`, or `error`; the toolbar badge reflects the successfully installed active rules. Redirect, query, and header rules run entirely in the browser. Mocks, response-body, and request-body rules use native messaging through the unified `rogatio runtime` host, started and stopped from the extension's Start/Stop runtime controls. Request-body rules use the trust lifecycle `rogatio runtime install` (a single command that provisions both the native-messaging host and, on capable platforms, the device-local CA), and `rogatio runtime uninstall` to remove the host registration, the device-local CA files, and the CA trust; the native-messaging host itself runs as `rogatio runtime host <path>`. Mock connection state represents the last activation check, not continuous monitoring.

Chrome can place one bounded, redacted, live-only `[Rogatio]` record in the matched website's DevTools Console when Chrome authoritatively reports a current Rogatio DNSR match. It shows the intended action—not proof that the network operation succeeded—and creates no history or management-page feed.

## Architecture and technology

Rogatio is a strict TypeScript 7, ESM/NodeNext monorepo using pnpm 10.32.1 as its package manager:

- **`schema`** owns the version-1 JSON Schema, generated AJV validation, origins, bounds, and forbidden headers.
- **`compiler`** converts validated source into browser-neutral operations and stable diagnostics.
- **`browser-core`** owns versioned project storage, migrations, permissions, enablement, compare-and-swap lifecycle, atomic rule installation and recovery, runtime state, diagnostics, and badge state.
- **`editor`** provides the shared framework-free DOM controller and accessible view.
- The Chrome Manifest V3 package translates neutral rules to WebExtensions and Declarative Net Request APIs. The extension boundary is designed to accommodate additional browser extensions in the future.
- **`cli`** bundles the editor host, file verification, runtime dispatch, and macOS runtime lifecycle.
- **`runtime`** supplies reusable bounded mock, response-body, and request-body transformation/runtime components. The ordinary mock/body server and runtime-owned request-body TLS proxy remain separate processes.

The mock/response server binds only `127.0.0.1`, pairs through a random capability and preset digest, authorizes the exact rule, confines file access, and enforces SSRF, DNS-rebinding, redirects, credentials, method, timeout, and size controls. It is never a general forward proxy or file server. The macOS runtime uses native messaging for control and response-body and request-body transformation routing, along with scoped Chrome PAC or proxy routing, an ephemeral TLS proxy, and a device-local CA. It independently revalidates project, rule, URL, method, initiator, target, permission, and grant authority; observed bodies are never persisted, logged, exported, or transferred through native messaging.

Builds use esbuild. Quality gates use Biome for formatting and linting, strict TypeScript checks, Vitest for unit testing, and Playwright for end-to-end headless browser testing, along with integration tests, browser journeys, and packaged-install tests. GitHub Actions and semantic-release, using the semantic-release plugin, publish the CLI module to npmjs.org and the extension ZIP files as GitHub Releases. The extension and npm module use consistent versioning, with the same version also recorded in the Git tag. The documentation site uses Astro and Starlight.

## Supported platforms, distribution, and boundaries

Supported operating systems are Linux, Windows, and macOS. Chrome is the currently supported browser. The application is designed to support adding additional browser extensions in the future.

The public CLI consists exactly of `edit`, `verify`, `test`, and `runtime`. It is distributed as an npm package from the public npm registry. The Chrome extension is unsigned and manually loaded from a GitHub Release ZIP, with no browser-store installation or automatic updates. Chrome sideloading may require the organization's extension entitlement.

Request-body activation is capability-based, excludes private browsing, and cannot compose with another controlling proxy, PAC, extension, or enterprise policy. The runtime activates only where a trusted device-local CA can be provisioned and Chrome PAC routing does not collide with an existing controlling proxy/PAC/extension/enterprise policy; macOS is the reference supported platform and Linux/Windows may also activate when those capabilities are present. Where the capabilities are absent, activation reports `unsupported`; Linux and Windows can still verify, edit, import, export, and dry-run request-body rules.
