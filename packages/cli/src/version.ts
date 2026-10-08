import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDistBuild } from "./utils/asset-paths.js";

/** Package version of the CLI that is running, or "" when it cannot be read. */
export function readCliVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = resolve(
    here,
    isDistBuild(here) ? "../../package.json" : "../package.json",
  );
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return "";
    }
    const version = Object.hasOwn(parsed, "version")
      ? (parsed as { version?: unknown }).version
      : undefined;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}
