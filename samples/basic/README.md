# Sample Rules Project

A minimal `.rogatio.json` that exercises all six Rogatio rule types so you can verify the schema, compiler, and CLI behavior end-to-end.

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

## Install

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
```

## Verify the sample file

After `pnpm build`, validate `.rogatio.json` against the schema package:

```sh
node -e "
import { validateProjectDetailed } from './packages/schema/dist/node/index.js';
import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('samples/sample-rules/.rogatio.json', 'utf8'));
const r = validateProjectDetailed(data);
console.log('valid?', r.valid);
if (!r.valid) console.error(r.errors);
"
```

## Run tests

Run the full repository test suite to confirm nothing is broken by the new sample:

```sh
pnpm test
```

To run only schema-level validation quickly:

```sh
pnpm --filter @rogatio/schema test
```

## File layout

```
samples/sample-rules/
├── .rogatio.json
└── README.md
```

The `.rogatio.json` file is the canonical source of truth. Edit it with `rogatio edit`, verify with `rogatio verify`, and import it into Chrome using the extension's import flow.
