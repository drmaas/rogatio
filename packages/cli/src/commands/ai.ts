import {
  type AIProviderConfig,
  createAIClient,
  deleteProviderConfig,
  getProviderConfigPath,
  readProviderConfig,
  writeProviderConfig,
} from "@rogatio/runtime";
import { showAIHelp } from "../help.js";

async function promptInput(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  for await (const chunk of process.stdin) {
    return chunk.toString().trim();
  }
  return "";
}

async function promptSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  // Disable echo
  process.stdin.setRawMode(true);
  let input = "";
  for await (const chunk of process.stdin) {
    const char = chunk.toString();
    if (char === "\n" || char === "\r") {
      process.stdout.write("\n");
      break;
    } else if (char === "\u0003") {
      process.exit(1);
    } else if (char === "\u007f" || char === "\b") {
      if (input.length > 0) {
        input = input.slice(0, -1);
        process.stdout.write("\b \b");
      }
    } else {
      input += char;
      process.stdout.write("*");
    }
  }
  process.stdin.setRawMode(false);
  return input.trim();
}

export async function aiCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showAIHelp();
    return 0;
  }

  const subcommand = args[0];
  if (!subcommand) {
    console.error("Error: Missing subcommand");
    showAIHelp();
    return 2;
  }

  switch (subcommand) {
    case "setup":
      return await aiSetup();
    case "ls":
      return await aiList();
    case "show":
      return await aiShow();
    case "delete":
      return await aiDelete();
    case "test":
      return await aiTest();
    default:
      console.error(`Error: Unknown ai subcommand: ${subcommand}`);
      showAIHelp();
      return 2;
  }
}

async function aiSetup(): Promise<number> {
  const configPath = getProviderConfigPath();
  console.log(`Configuring AI provider (will write to ${configPath})`);

  const providerUrl = await promptInput(
    "Provider URL (e.g., https://api.openai.com/v1): ",
  );
  if (!providerUrl) {
    console.error("Error: Provider URL is required");
    return 1;
  }

  const model = await promptInput("Model (e.g., gpt-4o-mini): ");
  if (!model) {
    console.error("Error: Model is required");
    return 1;
  }

  const apiKey = await promptSecret("API Key: ");
  if (!apiKey) {
    console.error("Error: API Key is required");
    return 1;
  }

  const config: AIProviderConfig = { providerUrl, model, apiKey };
  try {
    await writeProviderConfig(config);
    console.log("AI provider configured successfully");
    return 0;
  } catch (e) {
    console.error(`Error writing config: ${e}`);
    return 1;
  }
}

async function aiList(): Promise<number> {
  const config = await readProviderConfig();
  if (!config) {
    console.log("No AI provider configured");
    return 0;
  }
  console.log(`Provider: ${config.providerUrl}`);
  console.log(`Model: ${config.model}`);
  console.log(`API Key: ${redactKey(config.apiKey)}`);
  return 0;
}

async function aiShow(): Promise<number> {
  const config = await readProviderConfig();
  if (!config) {
    console.log("No AI provider configured");
    return 0;
  }
  console.log(
    JSON.stringify(
      {
        providerUrl: config.providerUrl,
        model: config.model,
        apiKey: redactKey(config.apiKey),
      },
      null,
      2,
    ),
  );
  return 0;
}

async function aiDelete(): Promise<number> {
  const config = await readProviderConfig();
  if (!config) {
    console.log("No AI provider configured");
    return 0;
  }

  const confirm = await promptInput(
    "Delete AI provider configuration? [y/N]: ",
  );
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled");
    return 0;
  }

  try {
    await deleteProviderConfig();
    console.log("AI provider configuration deleted");
    return 0;
  } catch (e) {
    console.error(`Error deleting config: ${e}`);
    return 1;
  }
}

async function aiTest(): Promise<number> {
  const config = await readProviderConfig();
  if (!config) {
    console.error("No AI provider configured. Run 'rogatio ai setup' first.");
    return 1;
  }

  console.log("Testing connection to AI provider...");
  const client = createAIClient(config);

  try {
    const start = Date.now();
    const result = await client.complete({
      messages: [{ role: "user", content: "Hello" }],
      model: config.model,
      temperature: 0,
    });
    const elapsed = Date.now() - start;
    console.log(`Connection successful (${elapsed}ms)`);
    console.log(
      `Response: ${result.content.slice(0, 100)}${result.content.length > 100 ? "..." : ""}`,
    );
    if (result.usage) {
      console.log(
        `Usage: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion tokens`,
      );
    }
    return 0;
  } catch (e) {
    console.error(`Connection failed: ${e}`);
    return 1;
  }
}

function redactKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}
