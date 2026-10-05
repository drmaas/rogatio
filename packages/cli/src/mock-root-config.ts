import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Device-local map of canonical project path to mock file root. */
export function mockRootConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = env.ROGATIO_CONFIG_DIR ?? join(homedir(), ".config", "rogatio");
  return join(base, "mock-roots.json");
}

export async function canonicalProjectPath(filePath: string): Promise<string> {
  const absolute = resolve(filePath);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

async function readMap(
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(mockRootConfigPath(env), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const projects = (parsed as { projects?: unknown }).projects;
  if (
    typeof projects !== "object" ||
    projects === null ||
    Array.isArray(projects)
  ) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const key of Object.keys(projects)) {
    const value = (projects as Record<string, unknown>)[key];
    // A relative root would resolve against the process working directory.
    if (typeof value === "string" && isAbsolute(value)) map[key] = value;
  }
  return map;
}

async function writeMap(
  map: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const path = mockRootConfigPath(env);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ projects: map }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, path);
}

export async function readSavedMockRoot(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const key = await canonicalProjectPath(filePath);
  return (await readMap(env))[key];
}

export async function writeSavedMockRoot(
  filePath: string,
  root: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const key = await canonicalProjectPath(filePath);
  const map = await readMap(env);
  if (root === null || root.length === 0) delete map[key];
  else map[key] = root;
  await writeMap(map, env);
}
