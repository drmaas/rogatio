# Sample Rules Project

A minimal `.rogatio.json` that exercises all six Rogatio rule types so you can verify the
schema, compiler, CLI behavior, the Chrome extension, and each rule's live browser effect
end-to-end.

## Rule types covered

| Rule type         | Rule ID             | What it does                              |
| ----------------- | ------------------- | ------------------------------------------ |
| `redirect`        | `rule-redirect`     | Redirects `/old/` to `/new/`               |
| `query`           | `rule-query`        | Adds `ref=rogatio` param                  |
| `header`          | `rule-header-set`   | Sets `X-Rogatio-Sample` request header     |
| `header`          | `rule-header-remove`| Removes `X-Test-Header` response header    |
| `mock`            | `rule-mock`         | Returns mocked JSON with a 100 ms delay    |
| `response-body`   | `rule-response-body`| Replaces `oldValue` with `newValue`        |
| `request-body`    | `rule-request-body` | Replaces the POST body                    |

The shipped sample targets `https://example.com`. `example.com` is a real, publicly
reachable domain, which makes a few rules observable **live in the browser without any
setup** (redirect, query, and mock). The remaining rule types are best validated live
against a target you control — a tiny local server recipe is included below — or
deterministically offline with `rogatio test`.

## Prerequisites

- **Node.js 24+** and **pnpm 10.32.1** (see the repository `README.md` for the exact
  toolchain; `node -v` and `pnpm -v` should report compatible versions).
- **Google Chrome** (the only supported browser).
- The Chrome extension is built locally from source in this repository — there is no
  browser-store install or auto-update.

## 1. Build from source

From the repository root, install dependencies and build every package (the CLI and the
Chrome extension `dist` are both build outputs):

```sh
pnpm install --frozen-lockfile
pnpm build
```

After a successful build:

- The `rogatio` CLI binary is available (run `node packages/cli/dist/node/index.js --help`
  or `pnpm --filter @rogatio/cli ...`), and
- the unpacked extension lives at `packages/extension/dist/` (it contains `manifest.json`,
  `background.js`, `extension-page.js`, `popup.js`, the HTML/JS/CSS entry points, and the
  bundled fonts).

## 2. Install the Chrome extension (load unpacked)

The extension is **unsigned** and manually loaded; you do not download a ZIP when building
from source — you point Chrome directly at the built `dist` directory.

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Choose **Load unpacked**.
4. Select the directory `packages/extension/dist` from this repository.

Chrome registers "Rogatio" and shows it as a loaded extension. Keep Developer mode on so
you can **Update** (reload) the extension after any future rebuild. Chrome sideloading may
require the organization's extension entitlement.

## 3. Import the sample project

1. Click the Rogatio toolbar icon to open the management page (or open
   `chrome-extension://<id>/index.html` directly).
2. In the sidebar, choose **Import project**.
3. Select `samples/basic/.rogatio.json` from this repository.

The project is imported as **disabled** with every group off and **no site access granted**.
Importing never activates anything or requests permissions.

## 4. Grant declared site access

Rogatio requests only the origins the project declares — here `https://example.com`.

1. On the imported project, find the **Grant / needs permission** control for the sample
   group's origin.
2. Approve the permission prompt. Only `https://example.com/*` is requested; no broad host
   permission is granted.

## 5. Activate the group

Group activation is separate from permission grant.

1. Toggle the **Sample Rules Group** enablement switch on.
2. After activation, each rule shows a status in the management page and the toolbar popup:
   `active`, `disabled`, `needs permission`, `needs proxy`, `unsupported`, or `error`.
   Redirect, query, and header rules should read `active` once permission is granted. Mock,
   response-body, and request-body rules read `needs proxy` until the runtime is connected
   (next step).

## 6. Start the runtime (mock, response-body, request-body)

Mock, response-body, and request-body rules need a local runtime. Response-body and
request-body rules additionally use native messaging and (on capable platforms) a
device-local CA.

First, register the native-messaging host once so Chrome can launch it. On macOS and other
capable platforms, this same install command also provisions and trusts the device-local
CA that request-body interception depends on, so Chrome can route eligible POST/PUT/PATCH
bodies through the runtime:

```sh
rogatio runtime install --extension-id <your extension ID>
# <your extension ID> is shown in the extension sidebar
```

Then, in the Rogatio management page, click **Start runtime**. The browser launches the
host via the manifest; mock rules change from `needs proxy` to `active` once connected.
Click **Stop runtime** to stop the session.

If `install` reports `unsupported` on your platform, request-body interception cannot
activate there — you can still verify, edit, import, export, and dry-run the rule.
Stop the runtime from the extension; remove the host and CA trust with
`rogatio runtime uninstall`.

## 7. Validate each rule

There are two complementary paths:

- **Offline matcher check (`rogatio test`)** — deterministic, never touches the network or
  your browser, and confirms every rule's regex/origin/method/resource-type match. Run this
  first.
- **Live browser check** — proves the rule actually changes a request or response in Chrome.
  Redirect, query, and mock are observable against `https://example.com` with no extra
  setup. Header, response-body, and request-body checks use a small local server you control
  (recipe below).

### 7a. Offline validation with `rogatio test`

Run a dry run per rule. The sample rules use different resource types and methods, so pass
the matching `--resource-type` and `--method` for each. `--urls` is a comma-separated batch;
`--json` gives machine-readable diagnostics.

```sh
# redirect (main_frame, GET)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/old/foo" --resource-type main_frame --method GET --json

# query (main_frame, GET)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/page?x=1" --resource-type main_frame --method GET --json

# header — set request (xmlhttprequest, GET)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/api/users" --resource-type xmlhttprequest --method GET --json

# header — remove response (main_frame)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/api/page" --resource-type main_frame --method GET --json

# mock (xmlhttprequest, GET)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/mock/things" --resource-type xmlhttprequest --method GET --json

# response-body (main_frame, GET)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/data.json" --resource-type main_frame --method GET --json

# request-body (xmlhttprequest, POST)
rogatio test samples/basic/.rogatio.json --urls "https://example.com/submit" --resource-type xmlhttprequest --method POST --json
```

Each run should report the corresponding rule as a match. A mismatch (wrong resource type or
method, or a URL that does not satisfy the regex) reports no match for that rule. Use a
`--urls-file` (JSON array) or `-` for stdin when you prefer a file-driven batch.

You can also confirm the whole file compiles and validates:

```sh
rogatio verify samples/basic/.rogatio.json
```

### 7b. Live browser validation

Open DevTools (**F12**) on the tab you test in, keep the **Network** panel open, and, for
header/response-body checks, also watch the **Console** for the bounded `[Rogatio]` record
when Chrome authoritatively reports a match.

**Redirect** (`rule-redirect`) — no setup needed:

1. In Chrome, visit `https://example.com/old/anything`.
2. The address bar changes to `https://example.com/new/anything`. The rule redirected the
   request before it left the browser.

**Query** (`rule-query`) — no setup needed:

1. Visit `https://example.com/page`.
2. The address bar becomes `https://example.com/page?ref=rogatio` (the param is added only
   when missing; an existing `ref` value is replaced).

**Mock** (`rule-mock`) — needs the runtime connected (step 6):

1. With the runtime started and **Check and connect** done, open
   `https://example.com/mock/anything` (or `fetch()` it from any page).
2. The response body is `{"mocked":true}` with `Content-Type: application/json` and a ~100 ms
   delay. The Network panel shows the mock status `200` and headers; no upstream request is
   made.

**Header — set request** (`rule-header-set`), **Header — remove response**
(`rule-header-remove`), **Response-body** (`rule-response-body`), and **Request-body**
(`rule-request-body`) are simplest to verify against a target you control. Use the local
server recipe below, then re-point the sample at `http://localhost:8080` (instructions
follow) and repeat the import/grant/activate steps.

#### Local validation server

Save this as `samples/basic/validate-server.mjs` (Node 24+, no dependencies) and run it with
`node samples/basic/validate-server.mjs`. It serves endpoints that expose the headers,
body, and content the Rogatio rules act on:

```js
import { createServer } from "node:http";

const PORT = 8080;
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "POST" && url.pathname === "/submit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ receivedBody: body }));
    });
    return;
  }
  if (url.pathname === "/api/users") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ seenRequestHeaders: req.headers }));
    return;
  }
  if (url.pathname === "/api/page") {
    res.writeHead(200, { "x-test-header": "should-be-removed" });
    res.end("ok");
    return;
  }
  if (url.pathname === "/data.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ value: "oldValue" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
server.listen(PORT, () => console.log(`validation server on http://localhost:${PORT}`));
```

#### Point the sample at the local server

Edit `samples/basic/.rogatio.json` (or use `rogatio edit`) so the group `origins` is
`["http://localhost:8080"]` and each rule's `urlRegex` targets `localhost:8080` instead of
`example.com`. For example:

- `"origins": ["https://example.com"]` → `"origins": ["http://localhost:8080"]`
- `"^https://example\\.com/old/"` → `"^http://localhost:8080/old/"`
- and so on for `/page\?`, `/api/`, `/mock/`, `/data\.json`, `/submit`.

Re-import the modified file (or **Update** the project in the extension), re-grant
`http://localhost:8080/*`, and re-activate the group. Then:

**Header — set request** (`rule-header-set`):

1. With DevTools open on a `http://localhost:8080` tab, run
   `fetch("http://localhost:8080/api/users")` from the Console.
2. The `/api/users` response JSON includes `"x-rogatio-sample": "enabled"` among
   `seenRequestHeaders` — proving the request header was injected.

**Header — remove response** (`rule-header-remove`):

1. Visit `http://localhost:8080/api/page`.
2. In the Network panel, select the `/api/page` response. The `X-Test-Header` response
   header is absent (the server sent it; Rogatio removed it).

**Response-body** (`rule-response-body`):

1. Visit `http://localhost:8080/data.json`.
2. The displayed JSON is `{"value":"newValue"}` — `oldValue` was rewritten to `newValue` in
   the response body (requires the runtime connected for response-body rules).

**Request-body** (`rule-request-body`):

1. With the runtime installed, trusted, and started (step 6), run from the Console:
   `fetch("http://localhost:8080/submit", { method: "POST", body: '{"original":true}' })`.
2. The `/submit` response JSON reports `"receivedBody": "{\"replaced\":true}"` — the POST
   body was replaced before it reached the server.

## File layout

```
samples/basic/
├── .rogatio.json          # canonical source of truth (all six rule types)
├── README.md              # this file
└── validate-server.mjs    # optional local target for live header/body checks
```

Edit the project with `rogatio edit`, verify with `rogatio verify`, dry-run with
`rogatio test`, and import/export it through the Chrome extension's management page. The
`.rogatio.json` file remains the single source of truth; browser-side edits replace the
repository file only when you explicitly export.
