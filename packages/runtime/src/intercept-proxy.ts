import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type {
  RequestBodyOperation,
  ResponseBodyOperation,
  RogatioOperation,
} from "@rogatio/compiler";
import { sourceMatches } from "@rogatio/compiler";
import { RUNTIME_LIMITS } from "./limits.js";
import { rewriteRequestBody } from "./request-body.js";
import { rewriteResponseBody } from "./response-body.js";
import { revalidateAuthority } from "./revalidate.js";

export interface ProxyEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface InterceptProxyPolicy {
  readonly project: unknown;
  readonly operations: readonly RogatioOperation[];
}

export interface InterceptProxyOptions {
  readonly policy?: InterceptProxyPolicy | null;
}

export interface InterceptProxyHandle {
  readonly endpoint: ProxyEndpoint;
  setPolicy(policy: InterceptProxyPolicy | null): void;
  stop(): Promise<void>;
}

type BodyOperation = RequestBodyOperation | ResponseBodyOperation;

function isBodyOp(op: RogatioOperation): op is BodyOperation {
  return op.kind === "request-body" || op.kind === "response-body";
}

function matcherMatches(
  op: BodyOperation,
  url: string,
  method: string,
): boolean {
  if (!sourceMatches(op.matcher.source, url)) return false;
  if (
    op.matcher.method !== undefined &&
    op.matcher.method !== method.toUpperCase()
  ) {
    return false;
  }
  return true;
}

function pickHighest(
  operations: readonly RogatioOperation[],
  kind: BodyOperation["kind"],
  url: string,
  method: string,
): BodyOperation | null {
  let best: BodyOperation | null = null;
  for (const op of operations) {
    if (!isBodyOp(op) || op.kind !== kind) continue;
    if (!matcherMatches(op, url, method)) continue;
    if (
      best === null ||
      op.matcher.priority > best.matcher.priority ||
      (op.matcher.priority === best.matcher.priority &&
        op.ruleId.localeCompare(best.ruleId) < 0)
    ) {
      best = op;
    }
  }
  return best;
}

function headerValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function readBoundedBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; body: Buffer } | { ok: false; reason: "oversized" }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (
      result: { ok: true; body: Buffer } | { ok: false; reason: "oversized" },
    ) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        req.destroy();
        finish({ ok: false, reason: "oversized" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      finish({ ok: true, body: Buffer.concat(chunks) });
    });
    req.on("error", () => {
      finish({ ok: true, body: Buffer.concat(chunks) });
    });
  });
}

function hopByHop(): Set<string> {
  return new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
  ]);
}

function forwardRequestHeaders(
  headers: IncomingMessage["headers"],
  host: string,
  contentLength: number,
): Record<string, string> {
  const skip = hopByHop();
  const out: Record<string, string> = {
    host,
    "content-length": String(contentLength),
    connection: "close",
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (skip.has(lower) || lower.startsWith("proxy-")) continue;
    if (lower.startsWith("x-rogatio-dispatch-")) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function pipeSockets(a: Socket, b: Socket): void {
  a.pipe(b);
  b.pipe(a);
  const closeBoth = () => {
    a.destroy();
    b.destroy();
  };
  a.on("error", closeBoth);
  b.on("error", closeBoth);
  a.on("close", () => b.destroy());
  b.on("close", () => a.destroy());
}

async function upstreamHttp(
  method: string,
  target: URL,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
}> {
  const port = target.port ? Number(target.port) : 80;
  const path = `${target.pathname}${target.search}`;
  return new Promise((resolve, reject) => {
    const socket = connect(port, target.hostname);
    let buf = Buffer.alloc(0);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(RUNTIME_LIMITS.operationTimeoutMs);
    socket.on("timeout", () => fail(new Error("upstream timeout")));
    socket.on("error", (err) => fail(err));
    socket.on("connect", () => {
      const lines = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      socket.write(`${method} ${path} HTTP/1.1\r\n${lines}\r\n\r\n`);
      if (body.byteLength > 0) socket.write(body);
    });
    socket.on("data", (chunk) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buf = Buffer.concat([buf, piece]);
      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const head = buf.subarray(0, sep).toString("latin1");
      const statusMatch = /^HTTP\/1\.[01] (\d+)(?: (.*))?/.exec(
        head.split("\r\n")[0] ?? "",
      );
      if (!statusMatch) {
        fail(new Error("bad upstream status"));
        return;
      }
      const status = Number(statusMatch[1]);
      const statusMessage = statusMatch[2]?.trim() ?? "";
      const headerMap: Record<string, string | string[]> = {};
      for (const line of head.split("\r\n").slice(1)) {
        const i = line.indexOf(":");
        if (i <= 0) continue;
        const name = line.slice(0, i).trim().toLowerCase();
        const value = line.slice(i + 1).trim();
        const existing = headerMap[name];
        if (existing === undefined) headerMap[name] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else headerMap[name] = [existing, value];
      }
      const clRaw = headerMap["content-length"];
      const hasContentLength = clRaw !== undefined;
      const cl =
        typeof clRaw === "string"
          ? Number(clRaw)
          : Array.isArray(clRaw)
            ? Number(clRaw[0])
            : Number.NaN;
      const bodyStart = sep + 4;
      if (hasContentLength && Number.isFinite(cl) && cl >= 0) {
        if (buf.length - bodyStart < cl) return;
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          status,
          statusMessage,
          headers: headerMap,
          body: buf.subarray(bodyStart, bodyStart + cl),
        });
        return;
      }
      // No content-length: wait for close (possibly chunked).
    });
    socket.on("end", () => {
      if (settled) return;
      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) {
        fail(new Error("upstream closed early"));
        return;
      }
      const head = buf.subarray(0, sep).toString("latin1");
      const statusMatch = /^HTTP\/1\.[01] (\d+)(?: (.*))?/.exec(
        head.split("\r\n")[0] ?? "",
      );
      if (!statusMatch) {
        fail(new Error("bad upstream status"));
        return;
      }
      const headerMap: Record<string, string | string[]> = {};
      for (const line of head.split("\r\n").slice(1)) {
        const i = line.indexOf(":");
        if (i <= 0) continue;
        headerMap[line.slice(0, i).trim().toLowerCase()] = line
          .slice(i + 1)
          .trim();
      }
      let body: Buffer = Buffer.from(buf.subarray(sep + 4));
      const te = headerMap["transfer-encoding"];
      const teValue = Array.isArray(te) ? te[0] : te;
      if (
        typeof teValue === "string" &&
        teValue.toLowerCase().includes("chunked")
      ) {
        body = Buffer.from(decodeChunkedBody(body));
        delete headerMap["transfer-encoding"];
        headerMap["content-length"] = String(body.byteLength);
      }
      settled = true;
      resolve({
        status: Number(statusMatch[1]),
        statusMessage: statusMatch[2]?.trim() ?? "",
        headers: headerMap,
        body,
      });
    });
  });
}

function decodeChunkedBody(buf: Buffer): Buffer {
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

function writeResponse(
  res: ServerResponse,
  status: number,
  statusMessage: string,
  headers: Record<string, string | string[]>,
  body: Buffer,
): void {
  const skip = hopByHop();
  const out: Record<string, string | number | string[]> = {
    "content-length": body.byteLength,
  };
  for (const [key, value] of Object.entries(headers)) {
    if (skip.has(key) || key.startsWith("proxy-")) continue;
    out[key] = value;
  }
  res.writeHead(status, statusMessage, out);
  res.end(body);
}

function initiatorFromHeaders(
  headers: IncomingMessage["headers"],
  targetUrl: string,
): string | undefined {
  const origin = headerValue(headers, "origin");
  if (typeof origin === "string" && /^https?:\/\//i.test(origin)) {
    return origin.endsWith("/") ? origin.slice(0, -1) : origin;
  }
  const referer = headerValue(headers, "referer");
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin;
    } catch {
      // ignore malformed referer
    }
  }
  try {
    return new URL(targetUrl).origin;
  } catch {
    return undefined;
  }
}

function authorizeOp(
  policy: InterceptProxyPolicy,
  op: BodyOperation,
  url: string,
  method: string,
  headers: IncomingMessage["headers"],
): boolean {
  const resourceType = op.matcher.resourceTypes[0];
  const initiator = initiatorFromHeaders(headers, url);
  const decision = revalidateAuthority(policy.project, policy.operations, {
    groupId: op.groupId,
    ruleId: op.ruleId,
    url,
    method,
    ...(initiator !== undefined ? { initiator } : {}),
    ...(resourceType !== undefined ? { resourceType } : {}),
  });
  return decision.allowed;
}

/**
 * Loopback HTTP forward proxy for body-rule rewrite (F23 REQ-5..11).
 * Absolute-form HTTP is matched and optionally rewritten; CONNECT is a blind tunnel.
 */
export async function startInterceptProxy(
  options: InterceptProxyOptions = {},
): Promise<InterceptProxyHandle> {
  let policy: InterceptProxyPolicy | null = options.policy ?? null;

  const server = createServer((req, res) => {
    void handleHttp(req, res);
  });

  server.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket as Socket, head);
  });

  async function handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const targetUrl = req.url ?? "";
      if (!/^https?:\/\//i.test(targetUrl)) {
        res.writeHead(400);
        res.end();
        return;
      }
      let target: URL;
      try {
        target = new URL(targetUrl);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (target.protocol !== "http:") {
        res.writeHead(501);
        res.end();
        return;
      }

      const method = (req.method ?? "GET").toUpperCase();
      const active = policy;
      const requestOp =
        active === null
          ? null
          : (pickHighest(
              active.operations,
              "request-body",
              targetUrl,
              method,
            ) as RequestBodyOperation | null);
      const responseOp =
        active === null
          ? null
          : (pickHighest(
              active.operations,
              "response-body",
              targetUrl,
              method,
            ) as ResponseBodyOperation | null);

      const needsRequestBody = requestOp !== null;
      const bodyResult = await readBoundedBody(
        req,
        RUNTIME_LIMITS.maxRequestBodyBytes,
      );
      if (!bodyResult.ok) {
        // Oversized: pass through is impossible once destroyed; fail closed.
        if (!res.headersSent) {
          res.writeHead(413);
          res.end();
        }
        return;
      }
      let requestBody = bodyResult.body;

      if (needsRequestBody && requestOp !== null && active !== null) {
        if (!authorizeOp(active, requestOp, targetUrl, method, req.headers)) {
          // Denied: pass through original body.
        } else {
          const rewritten = await rewriteRequestBody(
            {
              contentType: headerValue(req.headers, "content-type"),
              contentEncoding:
                headerValue(req.headers, "content-encoding") ?? "identity",
              body: new Uint8Array(requestBody),
            },
            requestOp.requestBody,
            {
              url: targetUrl,
              urlRegex: requestOp.matcher.source.value,
            },
          );
          if (rewritten.ok) {
            requestBody = Buffer.from(rewritten.value.body);
          }
          // Transform failure → pass through untouched (unsupported).
        }
      }

      const forwardHeaders = forwardRequestHeaders(
        req.headers,
        target.host,
        requestBody.byteLength,
      );
      const upstream = await upstreamHttp(
        method,
        target,
        forwardHeaders,
        requestBody,
      );

      let responseBody = upstream.body;
      if (responseOp !== null && active !== null) {
        if (responseBody.byteLength > RUNTIME_LIMITS.maxResponseBodyBytes) {
          // Oversized: pass through untouched.
        } else if (
          !authorizeOp(active, responseOp, targetUrl, method, req.headers)
        ) {
          // Denied: pass through.
        } else {
          const action = responseOp.responseBody;
          const isReplace = "mode" in action && action.mode === "replace";
          const rewritten = await rewriteResponseBody(
            {
              contentType:
                typeof upstream.headers["content-type"] === "string"
                  ? upstream.headers["content-type"]
                  : Array.isArray(upstream.headers["content-type"])
                    ? upstream.headers["content-type"][0]
                    : undefined,
              contentEncoding:
                typeof upstream.headers["content-encoding"] === "string"
                  ? upstream.headers["content-encoding"]
                  : "identity",
              body: new Uint8Array(responseBody),
            },
            "replacements" in action && Array.isArray(action.replacements)
              ? action.replacements
              : [],
            isReplace ? action : undefined,
            {
              url: targetUrl,
              urlRegex: responseOp.matcher.source.value,
            },
          );
          if (rewritten.ok) {
            responseBody = Buffer.from(rewritten.value.body);
          }
        }
      }

      writeResponse(
        res,
        upstream.status,
        upstream.statusMessage,
        upstream.headers,
        responseBody,
      );
    } catch {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end();
      }
    }
  }

  function handleConnect(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
  ): void {
    const authority = req.url ?? "";
    const [host, portText] = authority.split(":");
    const port = Number(portText);
    if (!host || !Number.isInteger(port) || port <= 0) {
      clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      clientSocket.destroy();
      return;
    }
    const upstream = connect(port, host);
    upstream.on("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.byteLength > 0) upstream.write(head);
      pipeSockets(clientSocket, upstream);
    });
    upstream.on("error", () => {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.destroy();
    });
    clientSocket.on("error", () => upstream.destroy());
  }

  const endpoint = await new Promise<ProxyEndpoint>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("intercept-proxy bind failed"));
        return;
      }
      resolve({ host: "127.0.0.1", port: addr.port });
    });
  });

  return {
    endpoint,
    setPolicy(next) {
      policy = next;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
