import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeServer,
  normalizeRuntimePreset,
  type RuntimeMockConfig,
  type RuntimeServer,
} from "../src/index.js";
import { makeMatcher, makePresetInput } from "./helpers.js";

const servers: RuntimeServer[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function mockConfig(
  overrides: Partial<RuntimeMockConfig> = {},
): RuntimeMockConfig {
  return {
    ruleId: "rule-mock",
    status: 200,
    body: "hello",
    ...overrides,
  };
}

function requirePreset(overrides: Parameters<typeof makePresetInput>[0] = {}) {
  const result = normalizeRuntimePreset(
    makePresetInput({
      matchers: [makeMatcher("rule-mock")],
      grants: [],
      mocks: [mockConfig()],
      ...overrides,
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected preset normalization");
  return result.value;
}

async function startServer(
  options: {
    overrides?: Parameters<typeof makePresetInput>[0];
    fileRoot?: string;
    port?: number;
  } = {},
) {
  const result = await createRuntimeServer({
    preset: requirePreset(options.overrides),
    ...(options.fileRoot !== undefined ? { fileRoot: options.fileRoot } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected server startup");
  servers.push(result.value);
  return result.value;
}

function httpCall(
  server: RuntimeServer,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string | number>;
  } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: server.bootstrap.host,
        port: server.bootstrap.port,
        path,
        method: options.method ?? "GET",
        headers: { Connection: "close", ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function connectionInfo(server: RuntimeServer) {
  const response = await httpCall(server, "/v1/connection");
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as {
    protocol: string;
    port: number;
    presetDigest: string;
    mocks: Array<{ ruleId: string; token: string }>;
  };
}

describe(" mock serving", () => {
  it("serves a configured inline-body response with status, headers, and CORS", async () => {
    const server = await startServer({
      overrides: {
        mocks: [
          mockConfig({
            status: 201,
            headers: [{ name: "x-test", value: "1" }],
            body: "hello",
          }),
        ],
      },
    });
    const info = await connectionInfo(server);
    const token = info.mocks[0]?.token;
    expect(token).toBeDefined();
    expect(info.mocks[0]?.ruleId).toBe("rule-mock");
    expect(info.protocol).toBe("v1");
    expect(info.port).toBe(server.bootstrap.port);

    const response = await httpCall(server, `/mock/${token}`);
    expect(response.status).toBe(201);
    expect(response.body).toBe("hello");
    expect(response.headers["x-test"]).toBe("1");
    expect(response.headers["content-type"]).toBe("text/plain; charset=UTF-8");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("serves a live UTF-8 file snapshot re-read per request on every platform", async () => {
    const root = await mkdtemp(join(tmpdir(), "rogatio-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "data.json"), '{"v":1}', "utf8");
    const server = await startServer({
      fileRoot: root,
      overrides: {
        matchers: [makeMatcher("rule-mock")],
        grants: [],
        mocks: [
          mockConfig({ status: 200, body: undefined, file: "data.json" }),
        ],
      },
    });
    const info = await connectionInfo(server);
    const token = info.mocks[0]?.token;

    const first = await httpCall(server, `/mock/${token}`);
    expect(first.status).toBe(200);
    expect(first.body).toBe('{"v":1}');

    await writeFile(join(root, "data.json"), '{"v":2}', "utf8");
    const second = await httpCall(server, `/mock/${token}`);
    expect(second.body).toBe('{"v":2}');
  });

  it("returns a stable redacted error for an invalid UTF-8 file snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "rogatio-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "bad.bin"), new Uint8Array([0xff, 0xfe, 0x00]));
    const server = await startServer({
      fileRoot: root,
      overrides: {
        matchers: [makeMatcher("rule-mock")],
        grants: [],
        mocks: [mockConfig({ status: 200, body: undefined, file: "bad.bin" })],
      },
    });
    const info = await connectionInfo(server);
    const token = info.mocks[0]?.token;

    const response = await httpCall(server, `/mock/${token}`);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.body).not.toContain(root);
    expect(response.body).not.toContain("bad.bin");
  });

  it("rejects unknown tokens and unsupported methods without leaking tokens", async () => {
    const server = await startServer();
    const info = await connectionInfo(server);
    const token = info.mocks[0]?.token;

    const unknown = await httpCall(server, "/mock/deadbeef");
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toContain(token);

    const missing = await httpCall(server, "/mock/");
    expect(missing.status).toBe(404);

    const post = await httpCall(server, `/mock/${token}`, { method: "POST" });
    expect(post.status).toBe(405);
  });

  it("honors delayMs and cancels on server stop", async () => {
    const server = await startServer({
      overrides: {
        mocks: [mockConfig({ status: 200, body: "slow", delayMs: 150 })],
      },
    });
    const info = await connectionInfo(server);
    const token = info.mocks[0]?.token;

    const started = Date.now();
    const response = await httpCall(server, `/mock/${token}`);
    const elapsed = Date.now() - started;
    expect(response.body).toBe("slow");
    expect(elapsed).toBeGreaterThanOrEqual(120);

    await server.stop();
    await expect(httpCall(server, `/mock/${token}`)).rejects.toBeTruthy();
  });

  it("does not emit CORS on the F6 control protocol but does on the mock connection route", async () => {
    const server = await startServer();
    const connection = await httpCall(server, "/v1/connection");
    expect(connection.headers["access-control-allow-origin"]).toBe("*");

    const pair = await httpCall(server, "/v1/pair", {
      method: "POST",
      headers: { "Content-Length": 0 },
    });
    expect(pair.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps the digest stable across starts while minting fresh tokens", async () => {
    const first = await startServer();
    const firstInfo = await connectionInfo(first);
    const second = await startServer();
    const secondInfo = await connectionInfo(second);

    expect(secondInfo.presetDigest).toBe(firstInfo.presetDigest);
    expect(secondInfo.mocks[0]?.token).not.toBe(firstInfo.mocks[0]?.token);
  });

  it("changes the digest when mock config changes but not when only tokens change", async () => {
    const base = requirePreset();
    const changed = requirePreset({
      mocks: [mockConfig({ status: 202 })],
    });
    expect(changed.digest).not.toBe(base.digest);

    const noMocks = requirePreset({ mocks: [] });
    expect(noMocks.digest).not.toBe(base.digest);
  });

  it("binds to a fixed port when requested and rejects an occupied one", async () => {
    const first = await startServer({ port: 8890 });
    expect(first.bootstrap.port).toBe(8890);

    const conflict = await createRuntimeServer({
      preset: requirePreset(),
      port: 8890,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("runtime.local-bind-denied");
    }
  });
});
