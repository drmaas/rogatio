import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowDir = join(root, ".github/workflows");

const elevatedPermissions = [
  "contents: write",
  "pages: write",
  "id-token: write",
] as const;

async function workflowFiles(): Promise<string[]> {
  const files = (await readdir(workflowDir)).filter((name) =>
    name.endsWith(".yml"),
  );
  expect(files.length).toBeGreaterThan(0);
  return files;
}

/** Unindented `permissions:` block. Job permissions are indented and excluded. */
function workflowPermissionsBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^permissions:/.test(line));
  if (start === -1) return "";
  const block = [lines[start] ?? ""];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || (!line.startsWith(" ") && !line.startsWith("\t")))
      break;
    block.push(line);
  }
  return block.join("\n");
}

/** Lines that belong to the checkout step after its `uses:` line. */
function checkoutStepTail(lines: string[], usesIndex: number): string {
  const usesIndent = (lines[usesIndex] ?? "").search(/\S/);
  const collected: string[] = [];
  for (let index = usesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") break;
    const indent = line.search(/\S/);
    if (indent < usesIndent) break;
    collected.push(line);
  }
  return collected.join("\n");
}

function jobBlocks(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const jobsIndex = lines.indexOf("jobs:");
  const jobs = new Map<string, string>();
  if (jobsIndex === -1) return jobs;
  let current: string | null = null;
  let bucket: string[] = [];
  const flush = (): void => {
    if (current !== null) jobs.set(current, bucket.join("\n"));
  };
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    const name = job?.[1];
    if (name) {
      flush();
      current = name;
      bucket = [line];
      continue;
    }
    if (current !== null) bucket.push(line);
  }
  flush();
  return jobs;
}

describe("workflow permissions", () => {
  it("sets persist-credentials: false on every actions/checkout step", async () => {
    const files = await workflowFiles();
    let checkouts = 0;
    for (const file of files) {
      const text = await readFile(join(workflowDir, file), "utf8");
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!/uses:\s*actions\/checkout@/.test(lines[index] ?? "")) continue;
        checkouts += 1;
        const tail = checkoutStepTail(lines, index);
        const label = `${file}:${index + 1}`;
        const withAt = tail.search(/^\s*with:\s*$/m);
        const persistAt = tail.search(/^\s*persist-credentials:\s*false\s*$/m);
        expect(withAt, label).toBeGreaterThanOrEqual(0);
        expect(persistAt, label).toBeGreaterThan(withAt);
      }
    }
    expect(checkouts).toBeGreaterThan(0);
  });

  it("does not grant contents, pages, or id-token write at workflow scope", async () => {
    const files = await workflowFiles();
    for (const file of files) {
      const text = await readFile(join(workflowDir, file), "utf8");
      const block = workflowPermissionsBlock(text);
      expect(block.length, file).toBeGreaterThan(0);
      for (const permission of elevatedPermissions) {
        expect(block, `${file} ${permission}`).not.toContain(permission);
      }
    }
  });

  it("grants the release workflow nothing until the release job", async () => {
    const text = await readFile(join(workflowDir, "release.yml"), "utf8");
    const block = workflowPermissionsBlock(text);
    expect(block.replace(/\s/g, "")).toBe("permissions:{}");

    const jobs = jobBlocks(text);
    expect(jobs.get("release")).toContain("contents: write");
    const contentsWrites = text.match(/contents: write/g) ?? [];
    expect(contentsWrites).toEqual(["contents: write"]);
    for (const [name, body] of jobs) {
      if (name === "release") continue;
      expect(body, name).not.toContain("contents: write");
    }
  });

  it("grants Pages and OIDC writes only inside the deploy job", async () => {
    const text = await readFile(join(workflowDir, "deploy-site.yml"), "utf8");
    const jobs = jobBlocks(text);
    const deploy = jobs.get("deploy");
    expect(deploy).toBeDefined();
    expect(deploy).toContain("pages: write");
    expect(deploy).toContain("id-token: write");
    expect(text.match(/pages: write/g)).toEqual(["pages: write"]);
    expect(text.match(/id-token: write/g)).toEqual(["id-token: write"]);
    for (const [name, body] of jobs) {
      if (name === "deploy") continue;
      expect(body, name).not.toContain("pages: write");
      expect(body, name).not.toContain("id-token: write");
    }
  });

  it("watches npm and github-actions", async () => {
    const text = await readFile(join(root, ".github/dependabot.yml"), "utf8");
    expect(text).toMatch(/package-ecosystem:\s*"npm"/);
    expect(text).toMatch(/package-ecosystem:\s*"github-actions"/);
  });
});
