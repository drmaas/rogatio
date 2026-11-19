import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import { compileProject, type RogatioOperation } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceMatchesWithinDeadline } from "../src/deadline-match.js";
import {
  type InterceptProxyHandle,
  readBoundedBody,
  startBoundedBodyDrain,
  startInterceptProxy,
  upstreamHttp,
} from "../src/intercept-proxy.js";
import { RUNTIME_LIMITS } from "../src/limits.js";
import * as revalidateMod from "../src/revalidate.js";
import type {
  OutboundRequest,
  OutboundResponse,
  OutboundTransport,
  ResolvedAddress,
} from "../src/types.js";

const PROXY_DOCUMENT_CSP =
  "sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'";

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
  _origin: string,
  rules: Array<Record<string, unknown>>,
): RogatioProject {
  return {
    version: 2,
    name: "proxy-test",
    groups: [
      {
        id: "g1",
        name: "group",
        rules: rules.map((rule) => {
          const { urlRegex, origins: _origins, ...rest } = rule;
          return {
            ...rest,
            source: {
              key: "url",
              operator: "regex",
              value: urlRegex as string,
            },
          };
        }) as RogatioProject["groups"][0]["rules"],
      },
    ],
  };
}

function compileOps(project: RogatioProject): readonly RogatioOperation[] {
  const result = compileProject(project);
  if (!result.ok) throw new Error("compile failed");
  return result.operations;
}

const PUBLIC_ADDRESS = "1.2.3.4";
const FIXTURE_ORIGIN = "http://fixture.example";

function publicResolver(address: string = PUBLIC_ADDRESS) {
  return {
    async lookup(): Promise<readonly ResolvedAddress[]> {
      return [{ address, family: 4 }];
    },
  };
}

function dialFixture(port: number) {
  return (_dialPort: number, _address: string): Socket =>
    connect(port, "127.0.0.1");
}

function startDataProxy(
  port: number,
  project: RogatioProject,
): Promise<InterceptProxyHandle> {
  return startInterceptProxy({
    policy: { project, operations: compileOps(project) },
    resolver: publicResolver(),
    dial: dialFixture(port),
  });
}

function parseHttpResponse(buf: Buffer): {
  status: number;
  body: string;
  headers: Record<string, string>;
} {
  const sep = buf.indexOf("\r\n\r\n");
  if (sep < 0) {
    throw new Error("no headers");
  }
  const head = buf.subarray(0, sep).toString("latin1");
  const statusMatch = /^HTTP\/1\.[01] (\d+)/.exec(head);
  if (!statusMatch) {
    throw new Error(`bad status line: ${head.slice(0, 40)}`);
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
  return {
    status,
    body: body.toString("utf8"),
    headers: headerMap,
  };
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
      try {
        resolve(parseHttpResponse(buf));
      } catch (err) {
        reject(err);
      }
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
        urlRegex: `^http://fixture\\.example/data\\.json$`,
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
    proxy = await startDataProxy(up.port, project);

    const result = await proxyFetch(
      proxy.endpoint,
      `${FIXTURE_ORIGIN}/data.json`,
    );
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
        urlRegex: `^http://fixture\\.example/submit$`,
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    proxy = await startDataProxy(up.port, project);

    const result = await proxyFetch(
      proxy.endpoint,
      `${FIXTURE_ORIGIN}/submit`,
      {
        method: "POST",
        body: '{"original":true}',
      },
    );
    expect(result.status).toBe(200);
    expect(seen).toBe('{"replaced":true}');
    expect(JSON.parse(result.body).receivedBody).toBe('{"replaced":true}');
  });

  it("leaves a non-matching nested URL pattern unchanged without blocking", async () => {
    let seen = "";
    const up = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        seen = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-slow",
        name: "slow",
        urlRegex: "^http://example\\.com/(a|aa)+$",
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    proxy = await startDataProxy(up.port, project);
    await sourceMatchesWithinDeadline(
      { key: "url", operator: "regex", value: "^https://example\\.com/$" },
      "https://example.com/",
    );
    const url = `http://example.com/${"a".repeat(60)}!`;
    const start = Date.now();
    const result = await proxyFetch(proxy.endpoint, url, {
      method: "POST",
      body: '{"original":true}',
    });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.status).toBe(200);
    expect(result.body).toContain('"ok":true');
    expect(seen).toBe('{"original":true}');
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
        urlRegex: `^http://fixture\\.example/other$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "oldValue", replacement: "newValue" }],
        },
      },
    ]);
    proxy = await startDataProxy(up.port, project);

    const result = await proxyFetch(
      proxy.endpoint,
      `${FIXTURE_ORIGIN}/data.json`,
    );
    expect(result.body).toBe('{"value":"oldValue"}');
  });

  it("tunnels CONNECT without decrypting TLS to the pinned address", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("tunneled");
    });
    upstream = up.server;
    const dialed: Array<{ port: number; address: string }> = [];
    proxy = await startInterceptProxy({
      policy: null,
      resolver: publicResolver(),
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });

    const endpoint = proxy.endpoint;
    const tunneled = await new Promise<string>((resolve, reject) => {
      const socket = connect(endpoint.port, endpoint.host);
      let buf = "";
      let sentTunneledRequest = false;
      socket.on("error", reject);
      socket.on("connect", () => {
        socket.write(
          "CONNECT fixture.example:443 HTTP/1.1\r\nHost: fixture.example:443\r\n\r\n",
        );
      });
      socket.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        if (!sentTunneledRequest) {
          if (!buf.includes("\r\n\r\n")) return;
          if (!buf.startsWith("HTTP/1.1 200")) {
            reject(new Error(`CONNECT failed: ${buf.slice(0, 80)}`));
            return;
          }
          sentTunneledRequest = true;
          const after = buf.indexOf("\r\n\r\n") + 4;
          buf = buf.slice(after);
          socket.write(
            "GET / HTTP/1.1\r\nHost: fixture.example\r\nConnection: close\r\n\r\n",
          );
          return;
        }
        if (buf.includes("tunneled")) {
          socket.destroy();
          resolve(buf);
        }
      });
    });
    expect(tunneled).toContain("tunneled");
    expect(dialed).toEqual([{ port: 443, address: PUBLIC_ADDRESS }]);
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
        urlRegex: `^http://fixture\\.example/big$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "x", replacement: "y" }],
        },
      },
    ]);
    proxy = await startDataProxy(up.port, project);

    const result = await proxyFetch(proxy.endpoint, `${FIXTURE_ORIGIN}/big`);
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
        urlRegex: `^http://fixture\\.example/data\\.json$`,
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "old", replacement: "new" }],
        },
      },
    ]);
    proxy = await startDataProxy(up.port, project);

    await proxyFetch(proxy.endpoint, `${FIXTURE_ORIGIN}/data.json`);
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[0];
    expect(call?.[2]).toMatchObject({
      groupId: "g1",
      ruleId: "r-resp",
      url: `${FIXTURE_ORIGIN}/data.json`,
    });
    spy.mockRestore();
  });

  it("serves a matched response-body document with a sandbox content policy", async () => {
    const seen: Array<Record<string, string | undefined>> = [];
    const up = await listen((_req, res) => {
      res.writeHead(200, [
        ["Content-Type", "text/html; charset=utf-8"],
        ["Content-Security-Policy", "script-src 'unsafe-inline'"],
        ["Content-Security-Policy-Report-Only", "script-src 'unsafe-inline'"],
        ["Set-Cookie", "a=b"],
        ["Cookie", "c=d"],
        ["Authorization", "Bearer upstream"],
      ]);
      res.end("<html><script>window.__ran = 1</script>oldValue</html>");
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: "^http://fixture\\.example/page$",
        origins: [],
        resourceTypes: ["main_frame", "sub_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "oldValue", replacement: "newValue" }],
        },
      },
    ]);
    const digest = "sha256:abc";
    proxy = await startInterceptProxy({
      policy: {
        project,
        operations: compileOps(project),
        presetDigest: digest,
      },
      resolver: publicResolver(),
      dial: dialFixture(up.port),
      outbound: {
        resolver: publicResolver(),
        transport: recordingTransport(up.port, (headers) => {
          seen.push(headers);
        }),
      },
    });
    expect(proxy.responseBodyToken).toMatch(/^[0-9a-f]{64}$/);
    const spy = vi.spyOn(revalidateMod, "revalidateAuthority");
    const url = `${FIXTURE_ORIGIN}/page`;
    const result = await originGet(
      proxy.endpoint.port,
      listenerPath(proxy.responseBodyToken, "r-resp", digest, url),
      { cookie: "session=1", authorization: "Bearer secret" },
    );
    expect(result.status).toBe(200);
    expect(result.body).toContain("newValue");
    expect(result.body).not.toContain("oldValue");
    expect(result.body).toContain("<script>window.__ran = 1</script>");
    expect(result.headers["content-security-policy"]).toBe(PROXY_DOCUMENT_CSP);
    expect(result.headers["content-security-policy"]).not.toContain(
      "allow-scripts",
    );
    expect(result.headers["content-security-policy"]).not.toContain(
      "allow-same-origin",
    );
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["content-security-policy-report-only"]).toBe(
      undefined,
    );
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers.cookie).toBeUndefined();
    expect(result.headers.authorization).toBeUndefined();
    expect(String(result.headers["content-type"])).toContain("text/html");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.cookie).toBeUndefined();
    expect(seen[0]?.authorization).toBeUndefined();
    const call = spy.mock.calls[0];
    expect(call?.[2]).toMatchObject({
      groupId: "g1",
      ruleId: "r-resp",
      url,
    });
    expect(call?.[2]).not.toHaveProperty("resourceType");
    expect(call?.[2]?.resourceType).not.toBe("main_frame");
    spy.mockRestore();
  });

  it("rejects a response-body request without the token or with the wrong token", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("secret");
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: "^http://fixture\\.example/page$",
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "secret", replacement: "public" }],
        },
      },
    ]);
    const digest = "sha256:abc";
    proxy = await startInterceptProxy({
      policy: {
        project,
        operations: compileOps(project),
        presetDigest: digest,
      },
      resolver: publicResolver(),
      dial: dialFixture(up.port),
      outbound: {
        resolver: publicResolver(),
        transport: recordingTransport(up.port),
      },
    });
    const url = `${FIXTURE_ORIGIN}/page`;
    const missing = await originGet(
      proxy.endpoint.port,
      `/.rogatio/body/r-resp/${encodeURIComponent(digest)}/${url}`,
    );
    expect(missing.status).toBe(400);
    expect(missing.body).toBe("");
    const wrongToken = proxy.responseBodyToken.startsWith("0")
      ? "f".repeat(64)
      : "0".repeat(64);
    const wrong = await originGet(
      proxy.endpoint.port,
      listenerPath(wrongToken, "r-resp", digest, url),
    );
    expect(wrong.status).toBe(403);
    expect(wrong.body).toBe("");
    const otherUrl = await originGet(
      proxy.endpoint.port,
      listenerPath(
        proxy.responseBodyToken,
        "r-resp",
        digest,
        `${FIXTURE_ORIGIN}/other`,
      ),
    );
    expect(otherUrl.status).toBe(404);
  });
});

function listenerPath(
  token: string,
  ruleId: string,
  digest: string,
  url: string,
): string {
  return `/.rogatio/body/${encodeURIComponent(token)}/${encodeURIComponent(ruleId)}/${encodeURIComponent(digest)}/${url}`;
}

function originGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function recordingTransport(
  port: number,
  onHeaders?: (headers: Record<string, string | undefined>) => void,
): OutboundTransport {
  return {
    request(options: OutboundRequest): Promise<OutboundResponse> {
      const flat: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(options.headers)) {
        flat[name.toLowerCase()] = value;
      }
      onHeaders?.(flat);
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path: options.path,
            method: options.method,
            headers: options.headers,
            agent: false,
          },
          (response) => {
            const headerPairs: Array<[string, string]> = [];
            for (
              let index = 0;
              index < response.rawHeaders.length;
              index += 2
            ) {
              const name = response.rawHeaders[index];
              const value = response.rawHeaders[index + 1];
              if (name !== undefined && value !== undefined) {
                headerPairs.push([name, value]);
              }
            }
            resolve({
              status: response.statusCode ?? 0,
              headers: headerPairs,
              body: response,
            });
          },
        );
        req.once("error", reject);
        req.end();
      });
    },
  };
}

describe("intercept-proxy upstream targets", () => {
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

  function connectStatus(authority: string): Promise<number> {
    const endpoint = proxy?.endpoint;
    if (!endpoint) throw new Error("proxy missing");
    return new Promise((resolve, reject) => {
      const socket = connect(endpoint.port, endpoint.host);
      let buf = "";
      socket.setTimeout(2000, () => {
        socket.destroy();
        reject(new Error(`timeout: ${buf.slice(0, 80)}`));
      });
      socket.on("error", reject);
      socket.on("connect", () => {
        socket.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`,
        );
      });
      socket.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        const match = /^HTTP\/1\.[01] (\d+)/.exec(buf);
        if (!match) return;
        socket.destroy();
        resolve(Number(match[1]));
      });
    });
  }

  const blocked = [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "100.64.0.1",
  ] as const;

  it.each(blocked)(
    "does not open a socket for HTTP when the name resolves only to %s",
    async (address) => {
      const dialed: string[] = [];
      proxy = await startInterceptProxy({
        resolver: {
          async lookup() {
            return [{ address, family: 4 }];
          },
        },
        dial: (port, host) => {
          dialed.push(`${host}:${port}`);
          throw new Error("dialed");
        },
      });
      const result = await proxyFetch(
        proxy.endpoint,
        "http://steered.example/secret",
      );
      expect(result.status).toBe(403);
      expect(dialed).toEqual([]);
    },
  );

  it.each(blocked)(
    "does not open a socket for CONNECT when the name resolves only to %s",
    async (address) => {
      const dialed: string[] = [];
      proxy = await startInterceptProxy({
        resolver: {
          async lookup() {
            return [{ address, family: 4 }];
          },
        },
        dial: (port, host) => {
          dialed.push(`${host}:${port}`);
          throw new Error("dialed");
        },
      });
      await expect(connectStatus("steered.example:443")).resolves.toBe(403);
      expect(dialed).toEqual([]);
    },
  );

  it("connects HTTP only to the single pinned public address", async () => {
    let seenHost = "";
    const up = await listen((req, res) => {
      seenHost = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned");
    });
    upstream = up.server;
    const dialed: Array<{ port: number; address: string }> = [];
    const lookedUp: string[] = [];
    proxy = await startInterceptProxy({
      resolver: {
        async lookup(hostname) {
          lookedUp.push(hostname);
          return [{ address: PUBLIC_ADDRESS, family: 4 }];
        },
      },
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });
    const result = await proxyFetch(proxy.endpoint, `${FIXTURE_ORIGIN}/pinned`);
    expect(result.status).toBe(200);
    expect(result.body).toBe("pinned");
    expect(seenHost).toBe("fixture.example");
    expect(lookedUp).toEqual(["fixture.example"]);
    expect(dialed).toEqual([{ port: 80, address: PUBLIC_ADDRESS }]);
  });

  it("rejects CONNECT on 8443 and HTTP on 8080 for a public address", async () => {
    let lookups = 0;
    const dialed: string[] = [];
    proxy = await startInterceptProxy({
      resolver: {
        async lookup() {
          lookups += 1;
          return [{ address: PUBLIC_ADDRESS, family: 4 }];
        },
      },
      dial: (port, address) => {
        dialed.push(`${address}:${port}`);
        throw new Error("dialed");
      },
    });
    await expect(connectStatus("fixture.example:8443")).resolves.toBe(403);
    const http = await proxyFetch(
      proxy.endpoint,
      "http://fixture.example:8080/wide",
    );
    expect(http.status).toBe(403);
    expect(lookups).toBe(0);
    expect(dialed).toEqual([]);
  });

  it("allows one exact local loopback origin on port 80", async () => {
    let seenHost = "";
    const up = await listen((req, res) => {
      seenHost = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("local");
    });
    upstream = up.server;
    const dialed: Array<{ port: number; address: string }> = [];
    proxy = await startInterceptProxy({
      policy: {
        project: {
          version: 2,
          name: "local",
          groups: [],
          requestBodyPolicy: { localOrigins: ["http://127.0.0.1"] },
        },
        operations: [],
        localOrigins: ["http://127.0.0.1"],
      },
      resolver: {
        async lookup(hostname) {
          if (hostname === "127.0.0.1") {
            return [{ address: "127.0.0.1", family: 4 }];
          }
          if (hostname === "127.0.0.2") {
            return [{ address: "127.0.0.2", family: 4 }];
          }
          if (hostname === "other.example") {
            return [{ address: "127.0.0.1", family: 4 }];
          }
          throw new Error(`unexpected lookup ${hostname}`);
        },
      },
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });

    const allowed = await proxyFetch(proxy.endpoint, "http://127.0.0.1/ping");
    expect(allowed.status).toBe(200);
    expect(allowed.body).toBe("local");
    expect(seenHost).toBe("127.0.0.1");
    expect(dialed).toEqual([{ port: 80, address: "127.0.0.1" }]);

    dialed.length = 0;
    const otherPort = await proxyFetch(
      proxy.endpoint,
      "http://127.0.0.1:8080/ping",
    );
    expect(otherPort.status).toBe(403);
    expect(dialed).toEqual([]);

    const otherHost = await proxyFetch(proxy.endpoint, "http://127.0.0.2/ping");
    expect(otherHost.status).toBe(403);
    expect(dialed).toEqual([]);

    const steered = await proxyFetch(
      proxy.endpoint,
      "http://other.example/ping",
    );
    expect(steered.status).toBe(403);
    expect(dialed).toEqual([]);
  });

  it("does not open a socket for an empty or mixed answer", async () => {
    const dialed: string[] = [];
    const answers: readonly (readonly ResolvedAddress[])[] = [
      [],
      [
        { address: PUBLIC_ADDRESS, family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    ];
    for (const answer of answers) {
      proxy = await startInterceptProxy({
        resolver: {
          async lookup() {
            return answer;
          },
        },
        dial: (port, address) => {
          dialed.push(`${address}:${port}`);
          throw new Error("dialed");
        },
      });
      const result = await proxyFetch(proxy.endpoint, `${FIXTURE_ORIGIN}/`);
      expect(result.status).toBe(403);
      await proxy.stop();
      proxy = undefined;
    }
    expect(dialed).toEqual([]);
  });

  it("rejects CR or LF in header names and values before opening a socket", async () => {
    const dialed: string[] = [];
    const result = await upstreamHttp(
      "GET",
      new URL("http://fixture.example/"),
      { host: "fixture.example", "x-test": "a\r\nX-Injected: 1" },
      Buffer.alloc(0),
      {
        resolver: publicResolver(),
        dial: (port, address) => {
          dialed.push(`${address}:${port}`);
          throw new Error("dialed");
        },
        localOrigins: new Set(),
      },
    );
    expect(result).toEqual({ ok: false, status: 403 });
    const lineBreaks = ["a\n", "a\r"];
    for (const value of lineBreaks) {
      const denied = await upstreamHttp(
        "GET",
        new URL("http://fixture.example/"),
        { host: "fixture.example", "x-test": value },
        Buffer.alloc(0),
        {
          resolver: publicResolver(),
          dial: (port, address) => {
            dialed.push(`${address}:${port}`);
            throw new Error("dialed");
          },
          localOrigins: new Set(),
        },
      );
      expect(denied).toEqual({ ok: false, status: 403 });
    }
    const named = await upstreamHttp(
      "GET",
      new URL("http://fixture.example/"),
      { host: "fixture.example", "x-\r\ninjected": "1" },
      Buffer.alloc(0),
      {
        resolver: publicResolver(),
        dial: (port, address) => {
          dialed.push(`${address}:${port}`);
          throw new Error("dialed");
        },
        localOrigins: new Set(),
      },
    );
    expect(named).toEqual({ ok: false, status: 403 });
    expect(dialed).toEqual([]);
  });
});

const MOCK_DIGEST = "sha256:abc";

function mockListenerPath(): string {
  return `/.rogatio/mock/tok/${encodeURIComponent(MOCK_DIGEST)}`;
}

function rawStatus(port: number, raw: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout: ${buf.slice(0, 60)}`));
    }, 2000);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const match = /^HTTP\/1\.[01] (\d+)/.exec(buf);
      if (match === null) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(Number(match[1]));
    });
    socket.on("connect", () => {
      socket.write(raw);
    });
  });
}

function rawFetch(
  port: number,
  raw: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, 2000);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("connect", () => {
      socket.write(raw);
    });
    socket.on("data", (chunk) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buf = Buffer.concat([buf, piece]);
    });
    socket.on("end", () => {
      clearTimeout(timer);
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
      const headerMap: Record<string, string> = {};
      for (const line of head.split("\r\n").slice(1)) {
        const index = line.indexOf(":");
        if (index > 0) {
          headerMap[line.slice(0, index).trim().toLowerCase()] = line
            .slice(index + 1)
            .trim();
        }
      }
      let body = Buffer.from(buf.subarray(sep + 4));
      const encoding = headerMap["transfer-encoding"]?.toLowerCase();
      if (encoding?.includes("chunked")) {
        body = Buffer.from(decodeChunked(body));
      } else if (headerMap["content-length"]) {
        body = body.subarray(0, Number(headerMap["content-length"]));
      }
      resolve({ status: Number(statusMatch[1]), body: body.toString("utf8") });
    });
  });
}

function httpRequestText(startLine: string, host: string): string {
  return `${startLine}\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
}

describe("intercept proxy loopback host", () => {
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

  async function startMockProxy(dialed: string[] = []): Promise<string[]> {
    const served: string[] = [];
    proxy = await startInterceptProxy({
      policy: {
        project: { version: 2, name: "host", groups: [] },
        operations: [],
        presetDigest: MOCK_DIGEST,
      },
      serveMock: async (request) => {
        served.push(request.token);
        return {
          ok: true,
          value: {
            status: 200,
            headers: [["content-type", "text/plain"]],
            bodyBytes: Buffer.from("mock-ok"),
          },
        };
      },
      dial: (port, address) => {
        dialed.push(`${address}:${port}`);
        throw new Error("dialed");
      },
    });
    return served;
  }

  it("rejects a rebound Host on mock, body, and other origin-form paths", async () => {
    const served = await startMockProxy();
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    const host = `evil.example:${port}`;
    const paths = [
      mockListenerPath(),
      "/.rogatio/body/tok/rule/sha256%3Aabc/http://fixture.example/page",
      "/",
    ];
    for (const path of paths) {
      const status = await rawStatus(
        port,
        httpRequestText(`GET ${path} HTTP/1.1`, host),
      );
      expect(status).toBe(403);
    }
    expect(served).toEqual([]);
  });

  it("allows loopback Host values on the mock listener", async () => {
    const served = await startMockProxy();
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    for (const host of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]) {
      const result = await rawFetch(
        port,
        httpRequestText(`GET ${mockListenerPath()} HTTP/1.1`, host),
      );
      expect(result.status).toBe(200);
      expect(result.body).toBe("mock-ok");
    }
    expect(served).toEqual(["tok", "tok", "tok"]);
  });

  it("rejects a rebound Host on the response-body listener and allows loopback Hosts", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("oldValue");
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: "^http://fixture\\.example/page$",
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 10,
        type: "response-body",
        responseBody: {
          replacements: [{ pattern: "oldValue", replacement: "newValue" }],
        },
      },
    ]);
    const fetches: string[] = [];
    proxy = await startInterceptProxy({
      policy: {
        project,
        operations: compileOps(project),
        presetDigest: MOCK_DIGEST,
      },
      resolver: publicResolver(),
      dial: dialFixture(up.port),
      outbound: {
        resolver: publicResolver(),
        transport: recordingTransport(up.port, () => {
          fetches.push("fetched");
        }),
      },
    });
    const port = proxy.endpoint.port;
    const path = listenerPath(
      proxy.responseBodyToken,
      "r-resp",
      MOCK_DIGEST,
      `${FIXTURE_ORIGIN}/page`,
    );
    const rebound = await originGet(port, path, {
      host: `evil.example:${port}`,
    });
    expect(rebound.status).toBe(403);
    expect(rebound.body).toBe("");
    expect(fetches).toEqual([]);

    for (const host of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]) {
      const allowed = await originGet(port, path, { host });
      expect(allowed.status).toBe(200);
      expect(allowed.body).toContain("newValue");
    }
    expect(fetches).toEqual(["fetched", "fetched", "fetched"]);
  });

  it("does not serve internal paths for a rebound absolute-form authority", async () => {
    const dialed: string[] = [];
    const served = await startMockProxy(dialed);
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    const target = `http://evil.example:${port}${mockListenerPath()}`;
    const status = await rawStatus(
      port,
      httpRequestText(`GET ${target} HTTP/1.1`, `evil.example:${port}`),
    );
    expect(status).toBe(403);
    expect(served).toEqual([]);
    expect(dialed).toEqual([]);
  });

  it("does not serve this listener when the absolute-form Host is rebound", async () => {
    const dialed: string[] = [];
    const served = await startMockProxy(dialed);
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    const target = `http://127.0.0.1:${port}${mockListenerPath()}`;
    const status = await rawStatus(
      port,
      httpRequestText(`GET ${target} HTTP/1.1`, `evil.example:${port}`),
    );
    expect(status).toBe(403);
    expect(served).toEqual([]);
    expect(dialed).toEqual([]);
  });

  it("tears down a 403 discard path when the request body goes idle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const dialed: string[] = [];
    await startMockProxy(dialed);
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    const target = `http://127.0.0.1:${port}${mockListenerPath()}`;
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        let saw403 = false;
        let buf = "";
        const failTimer = setTimeout(() => {
          socket.destroy();
          reject(new Error("timed out waiting for idle teardown on 403 path"));
        }, 30_000);
        socket.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          if (!saw403 && buf.includes("403")) {
            saw403 = true;
            void vi.advanceTimersByTimeAsync(RUNTIME_LIMITS.bodyIdleTimeoutMs);
          }
        });
        socket.once("close", () => {
          clearTimeout(failTimer);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(failTimer);
          resolve();
        });
        socket.once("connect", () => {
          const bodyBytes = RUNTIME_LIMITS.maxControlBodyBytes + 4096;
          socket.write(
            `POST ${target} HTTP/1.1\r\n` +
              `Host: evil.example:${port}\r\n` +
              "Connection: close\r\n" +
              "Content-Type: text/plain\r\n" +
              `Content-Length: ${bodyBytes}\r\n\r\n`,
          );
          socket.write("x".repeat(64));
        });
      });
      expect(dialed).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it("closes the client connection after 403 when the body exceeds the drain byte cap", async () => {
    const dialed: string[] = [];
    await startMockProxy(dialed);
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    const target = `http://127.0.0.1:${port}${mockListenerPath()}`;
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let saw403 = false;
      let buf = "";
      const failTimer = setTimeout(() => {
        socket.destroy();
        reject(new Error("timed out waiting for connection close after 403"));
      }, 5_000);
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (!saw403 && buf.includes("403")) {
          saw403 = true;
          expect(buf.toLowerCase()).toContain("connection: close");
          const keepSending = () => {
            if (socket.destroyed) return;
            socket.write("x".repeat(16_384));
            setImmediate(keepSending);
          };
          keepSending();
        }
      });
      socket.once("close", () => {
        clearTimeout(failTimer);
        resolve();
      });
      socket.once("error", () => {
        clearTimeout(failTimer);
        resolve();
      });
      socket.once("connect", () => {
        const bodyBytes = RUNTIME_LIMITS.maxControlBodyBytes + 50_000;
        socket.write(
          `POST ${target} HTTP/1.1\r\n` +
            `Host: evil.example:${port}\r\n` +
            "Connection: close\r\n" +
            "Content-Type: text/plain\r\n" +
            `Content-Length: ${bodyBytes}\r\n\r\n`,
        );
        socket.write("x".repeat(64));
      });
    });
    expect(dialed).toEqual([]);
  }, 10_000);

  it("serves an absolute-form mock path when the Host is loopback", async () => {
    const dialed: string[] = [];
    const served = await startMockProxy(dialed);
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    const target = `http://127.0.0.1:${port}${mockListenerPath()}`;
    const result = await rawFetch(
      port,
      httpRequestText(`GET ${target} HTTP/1.1`, `localhost:${port}`),
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe("mock-ok");
    expect(served).toEqual(["tok"]);
    expect(dialed).toEqual([]);
  });

  it("does not tunnel CONNECT to this listener", async () => {
    const dialed: string[] = [];
    await startMockProxy(dialed);
    const port = proxy?.endpoint.port;
    if (port === undefined) throw new Error("proxy missing");
    for (const authority of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]) {
      const status = await rawStatus(
        port,
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      );
      expect(status).toBe(403);
    }
    expect(dialed).toEqual([]);
  });

  it("still proxies absolute-form HTTP and CONNECT to another authority", async () => {
    const up = await listen((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(req.url === "/" ? "tunneled" : "proxied");
    });
    upstream = up.server;
    const dialed: Array<{ port: number; address: string }> = [];
    proxy = await startInterceptProxy({
      resolver: publicResolver(),
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });
    const port = proxy.endpoint.port;
    const http = await rawFetch(
      port,
      httpRequestText(`GET ${FIXTURE_ORIGIN}/data HTTP/1.1`, "fixture.example"),
    );
    expect(http.status).toBe(200);
    expect(http.body).toBe("proxied");
    const connectStatus = await rawStatus(
      port,
      "CONNECT fixture.example:443 HTTP/1.1\r\nHost: fixture.example:443\r\n\r\n",
    );
    expect(connectStatus).toBe(200);
    expect(dialed).toEqual([
      { port: 80, address: PUBLIC_ADDRESS },
      { port: 443, address: PUBLIC_ADDRESS },
    ]);
  });

  it("does not use Origin or Referer as the request-body initiator", async () => {
    let seen = "";
    const up = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        seen = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-req",
        name: "req",
        urlRegex: "^http://fixture\\.example/submit$",
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    proxy = await startDataProxy(up.port, project);
    const spy = vi.spyOn(revalidateMod, "revalidateAuthority");
    const result = await proxyFetch(
      proxy.endpoint,
      `${FIXTURE_ORIGIN}/submit`,
      {
        method: "POST",
        body: '{"original":true}',
        headers: {
          origin: "https://evil.example",
          referer: "https://evil.example/page",
        },
      },
    );
    expect(result.status).toBe(200);
    expect(seen).toBe('{"replaced":true}');
    expect(spy.mock.calls[0]?.[2]).toMatchObject({
      initiator: FIXTURE_ORIGIN,
      url: `${FIXTURE_ORIGIN}/submit`,
    });
    spy.mockRestore();
  });

  it("does not use Origin or Referer as the response-body initiator", async () => {
    const up = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("oldValue");
    });
    upstream = up.server;
    const project = buildProject(up.origin, [
      {
        id: "r-resp",
        name: "resp",
        urlRegex: "^http://fixture\\.example/page$",
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
      policy: {
        project,
        operations: compileOps(project),
        presetDigest: MOCK_DIGEST,
      },
      resolver: publicResolver(),
      dial: dialFixture(up.port),
      outbound: {
        resolver: publicResolver(),
        transport: recordingTransport(up.port),
      },
    });
    const spy = vi.spyOn(revalidateMod, "revalidateAuthority");
    const result = await originGet(
      proxy.endpoint.port,
      listenerPath(
        proxy.responseBodyToken,
        "r-resp",
        MOCK_DIGEST,
        `${FIXTURE_ORIGIN}/page`,
      ),
      {
        origin: "https://evil.example",
        referer: "https://evil.example/page",
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toContain("newValue");
    expect(spy.mock.calls[0]?.[2]).toMatchObject({
      initiator: FIXTURE_ORIGIN,
      url: `${FIXTURE_ORIGIN}/page`,
    });
    spy.mockRestore();
  });
});

describe("readBoundedBody", () => {
  it("resolves with error when the request stream errors mid-read", async () => {
    const req = new PassThrough() as unknown as IncomingMessage;
    const pending = readBoundedBody(req, RUNTIME_LIMITS.maxRequestBodyBytes);
    req.emit("data", Buffer.from('{"partial":'));
    req.emit("error", new Error("ECONNRESET"));
    await expect(pending).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("resolves oversized without destroying the request socket", async () => {
    const req = new PassThrough() as unknown as IncomingMessage;
    let destroyed = false;
    req.destroy = (() => {
      destroyed = true;
      return req;
    }) as IncomingMessage["destroy"];
    const pending = readBoundedBody(req, 10);
    req.emit("data", Buffer.alloc(11));
    await expect(pending).resolves.toEqual({ ok: false, reason: "oversized" });
    expect(destroyed).toBe(false);
  });

  it("keeps a single data listener when many chunks arrive after the limit", async () => {
    const req = new PassThrough() as unknown as IncomingMessage;
    const pending = readBoundedBody(req, 10);
    req.emit("data", Buffer.alloc(11));
    await expect(pending).resolves.toEqual({ ok: false, reason: "oversized" });
    expect(req.listenerCount("data")).toBe(1);
    for (let i = 0; i < 50; i++) {
      req.emit("data", Buffer.alloc(64));
    }
    expect(req.listenerCount("data")).toBe(1);
  });

  it("destroys a discarded body after the idle cap elapses", async () => {
    vi.useFakeTimers();
    const req = new PassThrough() as unknown as IncomingMessage;
    let destroyed = false;
    req.destroy = (() => {
      destroyed = true;
      return req;
    }) as IncomingMessage["destroy"];
    try {
      startBoundedBodyDrain(req);
      req.emit("data", Buffer.alloc(8));
      expect(destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(RUNTIME_LIMITS.bodyIdleTimeoutMs);
      expect(destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a discarded body when the drain byte cap is exceeded", async () => {
    const req = new PassThrough() as unknown as IncomingMessage;
    let destroyed = false;
    req.destroy = (() => {
      destroyed = true;
      return req;
    }) as IncomingMessage["destroy"];
    startBoundedBodyDrain(req);
    req.emit("data", Buffer.alloc(RUNTIME_LIMITS.maxControlBodyBytes));
    expect(destroyed).toBe(false);
    req.emit("data", Buffer.alloc(1));
    expect(destroyed).toBe(true);
  });

  it("does not dial upstream when the client resets a body mid-read", async () => {
    const dialed: Array<{ port: number; address: string }> = [];
    let upstreamHit = false;
    const up = await listen((req, res) => {
      upstreamHit = true;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(Buffer.concat(chunks));
      });
    });
    const project = buildProject(up.origin, [
      {
        id: "r-req",
        name: "req",
        urlRegex: `^http://fixture\\.example/submit$`,
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    const proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
      resolver: publicResolver(),
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });
    const writeHead = vi.spyOn(ServerResponse.prototype, "writeHead");
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect(proxy.endpoint.port, proxy.endpoint.host);
        socket.on("error", () => resolve());
        socket.on("connect", () => {
          socket.write(
            `POST ${FIXTURE_ORIGIN}/submit HTTP/1.1\r\n` +
              `Host: ${new URL(FIXTURE_ORIGIN).host}\r\n` +
              "Connection: close\r\n" +
              "Content-Type: application/json\r\n" +
              "Content-Length: 1000\r\n\r\n",
          );
          socket.write('{"partial":', () => {
            setTimeout(() => {
              socket.resetAndDestroy();
              resolve();
            }, 50);
          });
        });
        socket.setTimeout(5_000, () => {
          socket.destroy();
          reject(new Error("timed out resetting client"));
        });
      });
      await vi.waitFor(
        () => {
          expect(writeHead.mock.calls.some((args) => args[0] === 400)).toBe(
            true,
          );
        },
        { timeout: 5_000, interval: 20 },
      );
      const failClosed = writeHead.mock.calls.find((args) => args[0] === 400);
      expect(failClosed).toEqual([
        400,
        {
          "cache-control": "no-store",
          "content-length": "0",
          connection: "close",
        },
      ]);
      expect(dialed).toEqual([]);
      expect(upstreamHit).toBe(false);
    } finally {
      writeHead.mockRestore();
      await proxy.stop();
      await closeServer(up.server);
    }
  }, 10_000);

  it("does not dial upstream when the request body exceeds the byte limit", async () => {
    const dialed: Array<{ port: number; address: string }> = [];
    let upstreamHit = false;
    const up = await listen((req, res) => {
      upstreamHit = true;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(Buffer.concat(chunks));
      });
    });
    const project = buildProject(up.origin, [
      {
        id: "r-req",
        name: "req",
        urlRegex: `^http://fixture\\.example/submit$`,
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    const proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
      resolver: publicResolver(),
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });
    try {
      const oversizedBody = "x".repeat(RUNTIME_LIMITS.maxRequestBodyBytes + 1);
      const result = await proxyFetch(
        proxy.endpoint,
        `${FIXTURE_ORIGIN}/submit`,
        {
          method: "POST",
          body: oversizedBody,
        },
      );
      expect(result.status).toBe(413);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.headers["content-length"]).toBe("0");
      expect(result.headers.connection).toBe("close");
      expect(result.body).toBe("");
      expect(dialed).toEqual([]);
      expect(upstreamHit).toBe(false);
    } finally {
      await proxy.stop();
      await closeServer(up.server);
    }
  });

  it("closes the client connection after a 413 even when the body keeps arriving", async () => {
    const dialed: Array<{ port: number; address: string }> = [];
    const up = await listen(() => {});
    const project = buildProject(up.origin, [
      {
        id: "r-req",
        name: "req",
        urlRegex: `^http://fixture\\.example/submit$`,
        origins: [],
        resourceTypes: ["xmlhttprequest"],
        priority: 10,
        method: "POST",
        type: "request-body",
        requestBody: { mode: "replace", body: '{"replaced":true}' },
      },
    ]);
    const proxy = await startInterceptProxy({
      policy: { project, operations: compileOps(project) },
      resolver: publicResolver(),
      dial: (port, address) => {
        dialed.push({ port, address });
        return connect(up.port, "127.0.0.1");
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect(proxy.endpoint.port, proxy.endpoint.host);
        let saw413 = false;
        let buf = "";
        const failTimer = setTimeout(() => {
          socket.destroy();
          reject(new Error("timed out waiting for connection close after 413"));
        }, 5_000);
        socket.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          if (!saw413 && buf.includes("413")) {
            saw413 = true;
            const keepSending = () => {
              if (socket.destroyed) return;
              socket.write("x".repeat(16_384));
              setImmediate(keepSending);
            };
            keepSending();
          }
        });
        socket.once("close", () => {
          clearTimeout(failTimer);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(failTimer);
          resolve();
        });
        socket.once("connect", () => {
          const declared = RUNTIME_LIMITS.maxRequestBodyBytes + 50_000;
          socket.write(
            `POST ${FIXTURE_ORIGIN}/submit HTTP/1.1\r\n` +
              `Host: ${new URL(FIXTURE_ORIGIN).host}\r\n` +
              "Connection: close\r\n" +
              "Content-Type: text/plain\r\n" +
              `Content-Length: ${declared}\r\n\r\n`,
          );
          socket.write("x".repeat(RUNTIME_LIMITS.maxRequestBodyBytes + 1));
        });
      });
      expect(dialed).toEqual([]);
    } finally {
      await proxy.stop();
      await closeServer(up.server);
    }
  });
});
