import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_NODE_MAJOR = 26;
const MIN_NODE_MINOR = 13;
const MIN_NODE_PATCH = 0;
const MIN_NPM_MAJOR = 11;
const MIN_NPM_MINOR = 5;
const MIN_NPM_PATCH = 1;

const [nodeMajor, nodeMinor, nodePatch] = process.versions.node
  .split(".")
  .map(Number);
const nodeOk =
  nodeMajor > MIN_NODE_MAJOR ||
  (nodeMajor === MIN_NODE_MAJOR &&
    (nodeMinor > MIN_NODE_MINOR ||
      (nodeMinor === MIN_NODE_MINOR && nodePatch >= MIN_NODE_PATCH)));
if (!nodeOk) {
  console.error(
    `Node ${process.version} is below ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.${MIN_NODE_PATCH}`,
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const semanticReleaseRoot = path.dirname(
  require.resolve("semantic-release", { paths: [repoRoot] }),
);
const npmPluginRoot = path.dirname(
  require.resolve("@semantic-release/npm", { paths: [semanticReleaseRoot] }),
);
const execaPath = require.resolve("execa", { paths: [npmPluginRoot] });
const { execaSync } = await import(pathToFileURL(execaPath).href);

const { stdout } = execaSync("npm", ["--version"], {
  cwd: repoRoot,
  preferLocal: true,
});
const npm = stdout.trim();

const [npmMajor, npmMinor, npmPatch] = npm.split(".").map(Number);
const npmOk =
  npmMajor > MIN_NPM_MAJOR ||
  (npmMajor === MIN_NPM_MAJOR &&
    (npmMinor > MIN_NPM_MINOR ||
      (npmMinor === MIN_NPM_MINOR && npmPatch >= MIN_NPM_PATCH)));
if (!npmOk) {
  console.error(
    `npm publish CLI ${npm} is below ${MIN_NPM_MAJOR}.${MIN_NPM_MINOR}.${MIN_NPM_PATCH}`,
  );
  process.exit(1);
}

console.log(
  `node ${process.version} publish npm ${npm} (preferLocal from repo root)`,
);
