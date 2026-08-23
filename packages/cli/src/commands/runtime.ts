export async function runtimeCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: rogatio runtime [options]

Native messaging runtime for response-body and request-body rules.

Options:
  --help, -h      Show this help

Note: This command is not yet implemented.`);
    return 0;
  }

  console.error("Error: rogatio runtime is not yet implemented");
  return 1;
}
