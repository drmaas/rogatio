import { spawnSync } from "node:child_process";

const dryRun = process.env.RELEASE_DRY_RUN === "true";
const args = dryRun ? ["release", "--dry-run"] : ["release"];
const result = spawnSync("pnpm", args, { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
