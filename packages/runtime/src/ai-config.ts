import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface AIProviderConfig {
  providerUrl: string;
  model: string;
  apiKey: string;
}

function getConfigDir(): string {
  const platform = process.platform;

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      return path.join(localAppData, "rogatio");
    }
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      return path.join(userProfile, "AppData", "Local", "rogatio");
    }
    throw new Error("Unable to determine Windows config directory");
  }

  if (platform === "darwin") {
    const home = process.env.HOME;
    if (!home) throw new Error("HOME not set");
    return path.join(home, "Library", "Application Support", "rogatio");
  }

  // Linux and others
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "rogatio");
  }
  const home = process.env.HOME;
  if (!home) throw new Error("HOME not set");
  return path.join(home, ".config", "rogatio");
}

export function getProviderConfigPath(): string {
  return path.join(getConfigDir(), "provider.json");
}

export async function readProviderConfig(): Promise<AIProviderConfig | null> {
  const configPath = getProviderConfigPath();
  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as AIProviderConfig;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export async function writeProviderConfig(
  config: AIProviderConfig,
): Promise<void> {
  const configPath = getProviderConfigPath();
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true });
  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath, content, { mode: 0o600 });
}

export async function deleteProviderConfig(): Promise<void> {
  const configPath = getProviderConfigPath();
  try {
    await fs.unlink(configPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }
}
