import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeServer,
  normalizeRuntimePreset,
  RUNTIME_LIMITS,
  type RuntimeServer,
} from "../src/index.js";
import { descriptorBody, makeGrant, makePresetInput } from "./helpers.js";

const servers: RuntimeServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

async function startServer(clock?: () => number) {
  const result = await createRuntimeServer({
    preset: requirePreset(),
    clock,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected server startup");
  servers.push(result.value);
  return result.value;
}

function requirePreset() {
  const result = normalizeRuntimePreset(makePresetInput());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected preset normalization");
  return result.value;
}

function httpCall(
  server: RuntimeServer,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string | number>;
    body?: string;
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
        method: options.method ?? "POST",
        headers: {
          Connection: "close",
          ...options.headers,
        },
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
    if (options.body !== undefined) req.end(options.body);
    else req.end();
  });
}

function pairingHeaders(server: RuntimeServer) {
  return {
    "Content-Length": 0,
    "X-Rogatio-Capability": server.bootstrap.bootstrapCapability,
    "X-Rogatio-Preset-Digest": server.bootstrap.presetDigest,
  };
}

async function pair(server: RuntimeServer) {
  const response = await httpCall(server, "/v1/pair", {
    headers: pairingHeaders(server),
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as {
    sessionCapability: string;
    expiresInMs: number;
  };
}

describe("F6 loopback protocol", () => {
  it("binds to exact IPv4 loopback and reports an ephemeral port", async () => {
    const server = await startServer();

    expect(server.bootstrap.host).toBe("127.0.0.1");
    expect(server.bootstrap.port).toBeGreaterThan(0);
    expect(server.bootstrap.bootstrapCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(server.bootstrap.presetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("pairs once and authorizes one exact descriptor", async () => {
    const server = await startServer();
    const paired = await pair(server);
    const grant = makeGrant();
    const body = descriptorBody(grant);
    const response = await httpCall(server, "/v1/authorize", {
      headers: {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json",
        "X-Rogatio-Session-Capability": paired.sessionCapability,
        "X-Rogatio-Preset-Digest": server.bootstrap.presetDigest,
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, authorized: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers.server).toBeUndefined();
    expect(response.headers.date).toBeUndefined();

    const secondPair = await httpCall(server, "/v1/pair", {
      headers: pairingHeaders(server),
    });
    expect(secondPair.status).toBe(401);
    expect(secondPair.body).not.toContain(server.bootstrap.bootstrapCapability);
  });

  it("fails closed for wrong credentials, digest, and every tuple mutation", async () => {
    const server = await startServer();
    const paired = await pair(server);
    const baseHeaders = {
      "Content-Type": "application/json",
      "X-Rogatio-Session-Capability": paired.sessionCapability,
      "X-Rogatio-Preset-Digest": server.bootstrap.presetDigest,
    };

    const wrongDigest = await httpCall(server, "/v1/authorize", {
      headers: {
        ...baseHeaders,
        "Content-Length": 2,
        "X-Rogatio-Preset-Digest": `sha256:${"0".repeat(64)}`,
      },
      body: "{}",
    });
    expect(wrongDigest.status).toBe(401);
    expect(wrongDigest.body).toBe(
      JSON.stringify({
        ok: false,
        error: { code: "runtime.authorization-denied" },
      }),
    );

    for (const change of [
      { groupId: "other" },
      { ruleId: "other" },
      { operationId: "other" },
      { kind: "confined-file", target: "approved.txt" },
      { target: "https://example.com/other" },
      { method: "HEAD" },
    ]) {
      const changed = { ...makeGrant(), ...change } as ReturnType<
        typeof makeGrant
      >;
      const body = descriptorBody(changed);
      const response = await httpCall(server, "/v1/authorize", {
        headers: { ...baseHeaders, "Content-Length": Buffer.byteLength(body) },
        body,
      });
      expect(response.status).toBe(403);
      expect(response.body).toBe(
        JSON.stringify({
          ok: false,
          error: { code: "runtime.authorization-denied" },
        }),
      );
    }
  });

  it("expires sessions using the configured clock and invalidates them on stop", async () => {
    let now = 1_000;
    const server = await startServer(() => now);
    const paired = await pair(server);
    now += RUNTIME_LIMITS.sessionLifetimeMs + 1;
    const body = descriptorBody();
    const expired = await httpCall(server, "/v1/authorize", {
      headers: {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json",
        "X-Rogatio-Session-Capability": paired.sessionCapability,
        "X-Rogatio-Preset-Digest": server.bootstrap.presetDigest,
      },
      body,
    });
    expect(expired.status).toBe(401);
    await server.stop();
    await expect(httpCall(server, "/v1/authorize")).rejects.toBeTruthy();
  });

  it("rejects malformed protocol, duplicate keys, oversized bodies, and generic routes", async () => {
    const server = await startServer();
    const malformed = await httpCall(server, "/file/approved.txt", {
      method: "GET",
    });
    expect(malformed.status).toBe(404);

    const duplicate =
      '{"groupId":"group-main","ruleId":"rule-main","ruleId":"evil","operationId":"operation-main","kind":"outbound-http","target":"https://example.com/data","method":"GET"}';
    const paired = await pair(server);
    const duplicateResponse = await httpCall(server, "/v1/authorize", {
      headers: {
        "Content-Type": "application/json",
        "X-Rogatio-Session-Capability": paired.sessionCapability,
        "X-Rogatio-Preset-Digest": server.bootstrap.presetDigest,
        "Content-Length": Buffer.byteLength(duplicate),
      },
      body: duplicate,
    });
    expect(duplicateResponse.status).toBe(400);

    const oversized = await httpCall(server, "/v1/authorize", {
      headers: {
        "Content-Length": RUNTIME_LIMITS.maxControlBodyBytes + 1,
        "Content-Type": "application/json",
        "X-Rogatio-Session-Capability": paired.sessionCapability,
        "X-Rogatio-Preset-Digest": server.bootstrap.presetDigest,
      },
      body: "{}",
    });
    expect(oversized.status).toBe(413);
  });

  it("rejects transfer encoding, absolute-form proxy targets, and non-HTTP/1.1", async () => {
    const server = await startServer();
    const transfer = await httpCall(server, "/v1/pair", {
      headers: {
        ...pairingHeaders(server),
        "Transfer-Encoding": "chunked",
      },
    });
    expect(transfer.status).toBe(400);

    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(server.bootstrap.port, server.bootstrap.host);
      let data = "";
      socket.on("data", (chunk) => (data += chunk.toString("utf8")));
      socket.on("error", reject);
      socket.on("close", () => resolve(data));
      socket.on("connect", () => {
        socket.write(
          `POST http://example.com/v1/pair HTTP/1.1\r\nHost: 127.0.0.1:${server.bootstrap.port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      });
    });
    expect(raw).toContain("400");
  });
});
