import { execFileSync } from "node:child_process";

const requested = process.env.NPM_VERSION ?? "11.21.0";

execFileSync("npm", ["install", "-g", `npm@${requested}`], {
  stdio: "inherit",
});

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const nodeOk = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 14);
if (!nodeOk) {
  console.error(`Node ${process.version} is below 22.14`);
  process.exit(1);
}

const npm = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
const [npmMajor, npmMinor, npmPatch] = npm.split(".").map(Number);
const npmOk =
  npmMajor > 11 ||
  (npmMajor === 11 && (npmMinor > 5 || (npmMinor === 5 && npmPatch >= 1)));
if (!npmOk) {
  console.error(`npm ${npm} is below 11.5.1`);
  process.exit(1);
}

if (npm !== requested) {
  console.error(`expected npm ${requested}, found ${npm}`);
  process.exit(1);
}

console.log(`node ${process.version} npm ${npm}`);
