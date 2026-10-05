import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openPageCdpSession } from "./cdp-session.js";
import { extensionContext } from "./extension-context.js";
import { expect, testStandalone as test } from "./fixtures.js";
import { extensionSend, withNewTab } from "./sample-basic-helpers.js";

const HOST_NAME = "com.rogatio.runtime";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("trap server did not bind a port");
  }
  return address.port;
}

async function installWorktreeHost(
  profile: string,
  extensionId: string,
): Promise<void> {
  const cli = resolve(process.cwd(), "packages/cli/dist/node/index.js");
  const bin = join(profile, "rogatio-host");
  await writeFile(
    bin,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} runtime host\n`,
  );
  await chmod(bin, 0o755);
  const dir = join(profile, "NativeMessagingHosts");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${HOST_NAME}.json`),
    JSON.stringify(
      {
        name: HOST_NAME,
        description: "Rogatio worktree host for the mock journey",
        path: bin,
        type: "stdio",
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2,
    ),
  );
}

test("serves inline and file mocks, preserves POST, and removes session rules", async ({
  registerDriver,
}) => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method ?? "GET"} ${req.url ?? "/"}`);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("upstream");
  });
  const port = await listen(server);
  const root = await mkdtemp(join(tmpdir(), "rogatio-mock-root-"));
  const payload = Buffer.from("file-bytes\n", "utf8");
  await writeFile(join(root, "payload.bin"), payload);

  const project = {
    version: 2,
    name: "Mock live",
    groups: [
      {
        id: "grp-mock",
        name: "Mocks",
        rules: [
          {
            id: "rule-inline",
            name: "Inline",
            source: {
              key: "url",
              operator: "regex",
              value: `^http://127\\.0\\.0\\.1:${port}/inline$`,
            },
            resourceTypes: ["main_frame", "xmlhttprequest"],
            priority: 40,
            type: "mock",
            mock: {
              status: 201,
              body: "inline-body",
              headers: [
                { name: "Content-Type", value: "text/plain" },
                { name: "Access-Control-Allow-Origin", value: "*" },
              ],
            },
          },
          {
            id: "rule-file",
            name: "File",
            source: {
              key: "url",
              operator: "regex",
              value: `^http://127\\.0\\.0\\.1:${port}/file$`,
            },
            resourceTypes: ["main_frame", "xmlhttprequest"],
            priority: 30,
            type: "mock",
            mock: {
              status: 200,
              file: "payload.bin",
              headers: [
                { name: "Content-Type", value: "text/plain" },
                { name: "Access-Control-Allow-Origin", value: "*" },
              ],
            },
          },
          {
            id: "rule-post",
            name: "Post",
            source: {
              key: "url",
              operator: "regex",
              value: `^http://127\\.0\\.0\\.1:${port}/submit$`,
            },
            resourceTypes: ["main_frame", "xmlhttprequest"],
            priority: 20,
            method: "POST",
            type: "mock",
            mock: {
              status: 200,
              body: "posted",
              headers: [
                { name: "Content-Type", value: "text/plain" },
                { name: "Access-Control-Allow-Origin", value: "*" },
              ],
            },
          },
          {
            id: "rule-broad",
            name: "Broad",
            source: {
              key: "url",
              operator: "regex",
              value: "^http://127\\.0\\.0\\.1:\\d+/",
            },
            resourceTypes: ["main_frame", "xmlhttprequest"],
            priority: 1,
            type: "mock",
            mock: {
              status: 200,
              body: "once",
              headers: [
                { name: "Content-Type", value: "text/plain" },
                { name: "Access-Control-Allow-Origin", value: "*" },
              ],
            },
          },
        ],
      },
    ],
  };

  const context = await extensionContext();
  registerDriver(context.driver, context.close);
  try {
    await installWorktreeHost(context.profile, context.extensionId);
    await context.page.goto(
      `chrome-extension://${context.extensionId}/index.html`,
    );
    const imported = await extensionSend<{
      ok: boolean;
      value?: { id: string };
      diagnostic?: { code?: string };
    }>(context.page, {
      version: 1,
      command: "import-project",
      data: project,
    });
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    const projectId = imported.value?.id;
    expect(projectId).toBeTruthy();
    const enabled = await extensionSend<{ ok: boolean }>(context.page, {
      version: 1,
      command: "set-group-enabled",
      projectId,
      groupId: "grp-mock",
      enabled: true,
    });
    expect(enabled.ok).toBe(true);
    const rooted = await extensionSend<{ ok: boolean; diagnostic?: unknown }>(
      context.page,
      {
        version: 1,
        command: "set-mock-file-root",
        projectId,
        root,
      },
    );
    expect(rooted.ok, JSON.stringify(rooted)).toBe(true);
    const started = await extensionSend<{
      ok: boolean;
      diagnostic?: { code?: string; message?: string };
    }>(context.page, { version: 1, command: "start-native-runtime" });
    expect(started.ok, JSON.stringify(started)).toBe(true);

    const visit = (path: string) =>
      withNewTab(context.driver, async (page) => {
        await page.goto(`http://127.0.0.1:${port}${path}`);
        return page.evaluate(() => document.body?.innerText?.trim() ?? "");
      });
    expect(await visit("/inline")).toBe("inline-body");
    expect(await visit("/file")).toBe("file-bytes");

    const broad = await withNewTab(context.driver, async (page) => {
      const requests: string[] = [];
      const cdp = await openPageCdpSession(page.driver);
      cdp.on("Network.requestWillBeSent", (params) => {
        const request = params as { request?: { url?: string } };
        const url = request.request?.url ?? "";
        if (url.includes("/.rogatio/mock/")) requests.push(url);
      });
      await cdp.send("Network.enable");
      await page.goto(`http://127.0.0.1:${port}/broad`);
      const body = await page.evaluate(
        () => document.body?.innerText?.trim() ?? "",
      );
      await cdp.close();
      return { body, mockRequests: requests.length };
    });
    expect(broad).toEqual({ body: "once", mockRequests: 1 });

    const posted = await context.page.evaluate(async (target: string) => {
      const response = await fetch(target, { method: "POST", body: "secret" });
      return { status: response.status, body: await response.text() };
    }, `http://127.0.0.1:${port}/submit`);
    expect(posted).toEqual({ status: 200, body: "posted" });
    expect(hits).toEqual([]);

    const stopped = await extensionSend<{ ok: boolean }>(context.page, {
      version: 1,
      command: "stop-native-runtime",
    });
    expect(stopped.ok).toBe(true);
    const remaining = await context.page.evaluate(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      return rules
        .map((rule) => rule.id)
        .filter((id) => id >= 5_000_001 && id <= 6_000_000);
    });
    expect(remaining).toEqual([]);
  } finally {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  }
});
