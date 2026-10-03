export function showEditHelp(): void {
  console.log(`Usage: rogatio edit [options] [path]

Launch browser-based editor for a Rogatio project file.

Arguments:
  path            Project file (any filename; default: .rogatio.json in the current directory)

Options:
  --port <n>      Fixed port for editor server (default: random)
  --no-open       Start the editor server without opening a browser
  --help, -h      Show this help

The editor runs in your default browser and communicates with a local server
bound to 127.0.0.1. Changes are saved atomically to the file that was opened.
When path is omitted, the CLI looks for .rogatio.json in the current directory.`);
}

export function showVerifyHelp(): void {
  console.log(`Usage: rogatio verify [options] [path]

Validate a Rogatio project file using schema and compiler.

Arguments:
  path            Project file (any filename; default: .rogatio.json in the current directory)
                  Use '-' to read from stdin

Options:
  --json          Output diagnostics as JSON
  --help, -h      Show this help

Exit codes:
  0  Valid (no diagnostics)
  1  Invalid (diagnostics present)
  2  Error (IO, parse, or unexpected failure)`);
}

export function showRuntimeHelp(): void {
  console.log(`Usage: rogatio runtime <command> [options]
       rogatio runtime host [path]

Native messaging runtime control for response-body and request-body rules.

Commands:
  install   Install the native-messaging host manifest and (on capable
            platforms) provision the device-local CA. Uses the pinned release
            extension ID. Release users never pass --extension-id. That flag is
            only for development (a local unpacked build without the release
            key) and for forks.
            CA trust requires root/admin privileges (Linux: sudo, macOS: keychain
            password, Windows: Administrator). Transactional: when CA trust is
            unavailable the manifest is rolled back and the command exits 1.
  uninstall Remove the native-messaging host manifest and device-local CA trust
            (idempotent).
  verify    Check that the manifest, runtime-host wrapper, allowed origins, and
            device-local CA trust are all present and valid. Fails when
            allowed_origins does not include the release ID. Release users
            never pass --extension-id. That flag is only for development (a
            local unpacked build without the release key) and for forks.
  host [path]  Run the native-messaging runtime host. The browser launches this
               process via the native-messaging manifest to handle rule matching.

The lifecycle of the runtime (start/stop) is driven from the extension's
Start/Stop controls, not the CLI. Run 'rogatio runtime install' once to
register the host for a release build, then use the extension.

Options:
  --extension-id  Extension ID for the native messaging manifest. Release users
                  never need this. It is only for development (a local unpacked
                  build without the release key) and for forks.
  --root <dir>    Root for confined runtime file access (host only; default: project directory)
  --mock-port <n> Bind the loopback mock-response faucet to this port (host only, 1-65535)
  --help, -h      Show this help

Exit codes:
  0  Stopped cleanly / success
  1  Invalid project (diagnostics present), file outside the root, or a failed
     trust / verification check
  2  Error (IO or usage)`);
}

export function showTestHelp(): void {
  console.log(`Usage: rogatio test [options] [path] [url...]

Run offline dry-run tests against a Rogatio project file.

Arguments:
  path            Project file (any filename; default: .rogatio.json in the current directory)
                   Use '-' to read project JSON from stdin
  url...          URLs to test; when path is omitted, first URL is detected automatically

Options:
  --urls <list>        Comma-separated list of URLs to test
  --urls-file <path>   Path to JSON file containing array of test cases
                        Each case: { "url": "...", "method"?: "...", "resourceType"?: "..." }
                        Use '-' to read from stdin
  --method <m>         Default HTTP method for all test cases (GET, POST, etc.)
  --resource-type <t>  Default resource type for all test cases
  --max-cases <n>      Maximum number of test cases (default: 256)
  --json               Output results as JSON
  --help, -h           Show this help

Test case format (JSON):
  [
    { "url": "https://example.com/", "method": "GET", "resourceType": "main_frame" },
    { "url": "https://example.com/script.js" }
  ]

Exit codes:
  0  Success (all valid, results may include non-matches)
  1  Validation/compile/test errors
  2  Usage error (invalid arguments, missing input)`);
}

export function showImportHelp(): void {
  console.log(`Usage: rogatio import requestly <export.json> [options]

Migrate a Requestly rule export into a Rogatio project file.

Arguments:
  export.json     Requestly export (a JSON array of rules and groups, a single
                  rule, or an object with a rules array)

Options:
  --out <path>    Project file to write (any filename; default: .rogatio.json in the current directory)
  --merge         Append imported groups onto an existing version-2 project
  --json          Print the import report as JSON
  --help, -h      Show this help

The command validates the mapped project with the schema and compiler before
writing. An existing --out file is left untouched unless --merge is set.
Skipped and changed rules are listed; nothing is dropped silently.

Exit codes:
  0  The project was written (skipped rules do not fail the command)
  1  The mapped or merged project failed validation. Nothing is written.
  2  Usage, unreadable input, an export that is not Requestly data, or a refusal to overwrite`);
}

export function showAIHelp(): void {
  console.log(`Usage: rogatio ai <command> [options]

AI provider configuration commands.

Commands:
  setup      Interactively configure AI provider (URL, model, API key)
  ls         List configured AI provider
  show       Show current AI provider configuration (key redacted)
  delete     Delete AI provider configuration
  test       Test connection to AI provider

Options:
  --help, -h  Show this help`);
}
