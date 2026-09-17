import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { BASE_URL } from "./driver.js";

const READY_URL = `${BASE_URL}/browser-fixture.html`;
const READY_TIMEOUT_MS = 30_000;

let server: ChildProcess | undefined;

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(READY_URL);
      if (response.ok) return;
    } catch {
      // Server not up yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Smoke server did not become ready at ${READY_URL}`);
}

export async function setup(): Promise<void> {
  const script = resolve(process.cwd(), "scripts/serve-smoke.ts");
  server = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let stderr = "";
  server.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  server.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`Smoke server exited (${code}/${signal}): ${stderr}`);
    }
  });
  try {
    await waitForReady();
  } catch (error) {
    server.kill("SIGTERM");
    server = undefined;
    throw error;
  }
}

export async function teardown(): Promise<void> {
  if (!server) return;
  const child = server;
  server = undefined;
  child.kill("SIGTERM");
  await new Promise<void>((resolveDone) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveDone();
    }, 2000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolveDone();
    });
  });
}
