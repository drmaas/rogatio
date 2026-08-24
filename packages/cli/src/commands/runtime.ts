import { createNativeRuntimeController } from "@rogatio/runtime";

function showRuntimeHelp(): void {
  console.log(`Usage: rogatio runtime <command> [options]

Native messaging runtime control for response-body and request-body rules.

Commands:
  start     Start the runtime (capability-gated; explicit, no auto-start)
  stop      Stop the runtime (idempotent)
  status    Show the current runtime state

Options:
  --help, -h      Show this help

The runtime activates only where a trusted device-local CA can be provisioned and
Chrome PAC routing does not collide with an existing controlling proxy/PAC/extension
or enterprise policy. On incapable platforms 'start' reports 'unsupported'.`);
}

export async function runtimeCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showRuntimeHelp();
    return 0;
  }

  const subcommand = args[0];
  const controller = createNativeRuntimeController();

  switch (subcommand) {
    case "start": {
      const result = await controller.start();
      if (result.state === "running") {
        console.log("runtime started");
        return 0;
      }
      if (result.state === "unsupported") {
        console.error(
          `runtime unsupported: ${(result.reasons ?? ["unknown"]).join(", ")}`,
        );
        return 0;
      }
      console.error(`runtime start failed: ${result.state}`);
      return 1;
    }
    case "stop": {
      const result = await controller.stop();
      console.log(`runtime ${result.state}`);
      return 0;
    }
    case "status": {
      console.log(`runtime ${controller.status().state}`);
      return 0;
    }
    default: {
      console.error(`Error: unknown runtime subcommand: ${subcommand ?? ""}`);
      showRuntimeHelp();
      return 2;
    }
  }
}
