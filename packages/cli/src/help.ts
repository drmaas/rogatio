export function showEditHelp(): void {
  console.log(`Usage: rogatio edit [options] [path]

Launch browser-based editor for .rogatio.json project file.

Arguments:
  path            Path to .rogatio.json (default: .rogatio.json in current directory)

Options:
  --port <n>      Fixed port for editor server (default: random)
  --help, -h      Show this help

The editor runs in your default browser and communicates with a local server
bound to 127.0.0.1. Changes are saved atomically to the project file.`);
}

export function showVerifyHelp(): void {
  console.log(`Usage: rogatio verify [options] [path]

Validate a .rogatio.json project file using schema and compiler.

Arguments:
  path            Path to .rogatio.json (default: .rogatio.json in current directory)
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
            platforms) provision the device-local CA (requires --extension-id).
            CA trust requires root/admin privileges (Linux: sudo, macOS: keychain
            password, Windows: Administrator).
  uninstall Remove the native-messaging host manifest and device-local CA trust
            (idempotent).
  host [path]  Run the native-messaging runtime host. The browser launches this
               process via the native-messaging manifest to handle rule matching.

The lifecycle of the runtime (start/stop) is driven from the extension's
Start/Stop controls, not the CLI. Run 'rogatio runtime install --extension-id
<id>' once to register the host, then use the extension.

Options:
  --extension-id  Extension ID for native messaging manifest (required for install)
  --root <dir>    Root for confined file mocks (default: project directory)
  --help, -h      Show this help

Exit codes:
  0  Stopped cleanly / success
  1  Invalid project (diagnostics present) or file outside the root
  2  Error (IO or usage)`);
}

export function showTestHelp(): void {
  console.log(`Usage: rogatio test [options] [path] [url...]

Run offline dry-run tests against a .rogatio.json project file.

Arguments:
  path            Path to .rogatio.json (default: .rogatio.json in current directory)
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
