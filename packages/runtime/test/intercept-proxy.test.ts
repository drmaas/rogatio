import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect } from "node:net";
import { compileProject, type RogatioOperation } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type InterceptProxyHandle,
  startInterceptProxy,
} from "../src/intercept-proxy.js";
import { RUNTIME_LIMITS } from "../src/limits.js";
import * as revalidateMod from "../src/revalidate.js";

function listen(
  handler: (
    req: IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<{ server: Server; origin: string; port: number }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({
        server,
        port: addr.port,
        origin: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function buildProject(
  origin: string,
  rules: RogatioProject["groups"][0]["rules"],
): RogatioProject {
  return {
    version: 1,
    name: "proxy-test",
    groups: [
      {
        id: "g1",
        name: "group",
        origins: [origin],
        rules,
      },
    ],
  };
}

function compileOps(project: RogatioProject): readonly RogatioOperation[] {
  const result = compileProject(project);
  if (!result.ok) throw new Error("compile failed");
  return result.operations;
}

async function proxyFetch(
  proxy: { host: string; port: number },
  absoluteUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const method = init.method ?? "GET";
  const bodyBytes = init.body ? Buffer.from(init.body, "utf8") : null;
  const headers = { ...(init.headers ?? {}) };
  if (bodyBytes) {
    headers["content-length"] = String(bodyBytes.byteLength);
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  }
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  const request = `${method} ${absoluteUrl} HTTP/1.1\r\nHost: ${new URL(absoluteUrl).host}\r\nConnection: close\r\n${headerLines ? `${headerLines}\r\n` : ""}\r\n`;

  return new Promise((resolve, reject) => {
    const socket = connect(proxy.port, proxy.host);
    let buf = Buffer.alloc(0);
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(request);
      if (bodyBytes) socket.write(bodyBytes);
    });
    socket.on("data", (chunk) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buf = Buffer.concat([buf, piece]);
    });
    socket.on("end", () => {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) {
        reject(new Error("no headers"));
        return;
      }
      const head = buf.subarray(0, sep).toString("latin1");
      const statusMatch = /^HTTP\/1\.[01] (\d+)/.exec(head);
      if (!statusMatch) {
        reject(new Error(`bad status line: ${head.slice(0, 40)}`));
        return;
      }
      const status = Number(statusMatch[1]);
      const headerMap: Record<string, string> = {};
      for (const line of head.split("\r\n").slice(1)) {
        const i = line.indexOf(":");
        if (i > 0)
          headerMap[line.slice(0, i).trim().toLowerCase()] = line
            .slice(i + 1)
            .trim();
      }
      let body: Buffer = Buffer.from(buf.subarray(sep + 4));
      const te = headerMap["transfer-encoding"]?.toLowerCase();
      if (te?.includes("chunked")) {
        body = Buffer.from(decodeChunked(body));
      } else if (headerMap["content-length"]) {
        const cl = Number(headerMap["content-length"]);
        body = body.subarray(0, cl);
      }
      resolve({
        status,
        body: body.toString("utf8"),
        headers: headerMap,
      });
    });
  });
}

function decodeChunked(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const lineEnd = buf.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const size = Number.parseInt(
      buf.subarray(offset, lineEnd).toString("ascii"),
      16,
    );
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    parts.push(buf.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.from(Buffer.concat(parts));
}

describe("intercept-proxy data path", () => {
  let upstream: Server | undefined;
  let proxy: InterceptProxyHandle | undefined;

  afterEach(async () => {
    if (proxy) {
      await proxy.stop();
      proxy = undefined;
    }
    if (upstream) {
      await closeServer(upstream);
      upstream = undefined;
    }
  });

  it("rewrites a matching response-body", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"value":"oldValue"}');
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: `^${up.origin.replace(/\./g, "\\.")}/data\\.json$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          mode: "regex",
          replacements: [{ pattern: "oldValue", replacement: "newValue" }],
        },
      },
    ]);
    const operations = compileOps(project);
    proxy = await startInterceptProxy({
      policy: { project, operations },
    });

    const result = await proxyFetch(proxy.endpoint, `${up.origin}/data.json`);
    expect(result.status).toBe(200);
    expect(result.body).toContain("newValue");
    expect(result.body).not.toContain("oldValue");
  });

  it("rewrites a matching request-body before upstream", async () => {
    let seen = "";
    const up = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ receivedBody: seen }));
      });
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-req",
        name: "req",
        urlRegex: `^${up.origin.replace(/\./g, "\\.")}/submit$`,
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
    });

    const result = await proxyFetch(proxy.endpoint, `${up.origin}/submit`, {
      method: "POST",
      body: '{"original":true}',
    });
    expect(result.status).toBe(200);
    expect(seen).toBe('{"replaced":true}');
    expect(JSON.parse(result.body).receivedBody).toBe('{"replaced":true}');
  });

  it("passes non-matching traffic through untouched", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"value":"oldValue"}');
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: `^${up.origin.replace(/\./g, "\\.")}/other$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "oldValue", replacement: "newValue" }],
        },
      },
    ]);
    proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
    });

    const result = await proxyFetch(proxy.endpoint, `${up.origin}/data.json`);
    expect(result.body).toBe('{"value":"oldValue"}');
  });

  it("tunnels CONNECT as a blind TCP pipe", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("tunneled");
    });
    upstream = up.server;
    proxy = await startInterceptProxy({ policy: null });

    const endpoint = proxy?.endpoint;
    expect(endpoint).toBeDefined();
    if (endpoint === undefined) throw new Error("expected proxy endpoint");

    const tunneled = await new Promise<string>((resolve, reject) => {
      const socket = connect(endpoint.port, endpoint.host);
      let buf = "";
      socket.on("error", reject);
      socket.on("connect", () => {
        socket.write(
          `CONNECT 127.0.0.1:${up.port} HTTP/1.1\r\nHost: 127.0.0.1:${up.port}\r\n\r\n`,
        );
      });
      socket.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        if (!buf.startsWith("HTTP/1.1 200")) {
          reject(new Error(`CONNECT failed: ${buf.slice(0, 80)}`));
          return;
        }
        // After 200, send a plain HTTP request through the tunnel.
        const after = buf.indexOf("\r\n\r\n") + 4;
        buf = buf.slice(after);
        socket.write(
          `GET / HTTP/1.1\r\nHost: 127.0.0.1:${up.port}\r\nConnection: close\r\n\r\n`,
        );
        socket.on("data", (more) => {
          buf += more.toString("latin1");
          if (buf.includes("tunneled")) {
            socket.destroy();
            resolve(buf);
          }
        });
      });
    });
    expect(tunneled).toContain("tunneled");
  });

  it("falls back to pass-through when the body exceeds the bound", async () => {
    const huge = "x".repeat(RUNTIME_LIMITS.maxResponseBodyBytes + 1);
    const up = await listen((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(huge)),
      });
      res.end(huge);
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: `^${up.origin.replace(/\./g, "\\.")}/big$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "x", replacement: "y" }],
        },
      },
    ]);
    proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
    });

    const result = await proxyFetch(proxy.endpoint, `${up.origin}/big`);
    expect(result.status).toBe(200);
    expect(result.body.startsWith("x")).toBe(true);
    expect(result.body).not.toContain("y");
  });

  it("revalidates authority before reading bodies", async () => {
    const spy = vi.spyOn(revalidateMod, "revalidateAuthority");
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"value":"old"}');
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: `^${up.origin.replace(/\./g, "\\.")}/data\\.json$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "old", replacement: "new" }],
        },
      },
    ]);
    proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
    });

    await proxyFetch(proxy.endpoint, `${up.origin}/data.json`);
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[0];
    expect(call?.[2]).toMatchObject({
      groupId: "g1",
      ruleId: "r-resp",
      url: `${up.origin}/data.json`,
    });
    spy.mockRestore();
  });
});
