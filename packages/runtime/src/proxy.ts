import { failure } from "./errors.js";
import { resolveAndPin, validateTargetUrl } from "./target.js";
import { buildForwardHeaders, validateRequestWire } from "./wire.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type { RuntimeResult } from "./types.js";

const RESERVED_MARKER_PREFIX = "X-Rogatio-Dispatch-";
const MARKER_SEPARATOR = "~";

export interface ProxyContext {
  readonly sessionId: string;
  readonly policyDigest: string;
  readonly extensionId: string;
  readonly pacOrigins: readonly string[];
  readonly localOrigins: readonly string[];
  readonly allowedOrigins: readonly string[];
}

interface PendingAuth {
  readonly requestId: string;
  readonly ruleId: string;
  readonly marker: string;
  readonly expiresAt: number;
}

const pendingAuths = new Map<string, PendingAuth>();

export function createMarker(ruleId: string): string {
  return `${RESERVED_MARKER_PREFIX}${ruleId}${MARKER_SEPARATOR}${crypto.randomUUID()}`;
}

export function verifyMarker(
  headers: Record<string, string>,
): RuntimeResult<string> {
  const markerEntries = Object.entries(headers).filter(([k]) =>
    k.startsWith(RESERVED_MARKER_PREFIX),
  );
  if (markerEntries.length === 0) {
    return failure("runtime.request-body-marker-missing");
  }
  if (markerEntries.length > 1) {
    return failure("runtime.request-body-marker-duplicate");
  }
  const [markerHeader, _markerValue] = markerEntries[0];
  const afterPrefix = markerHeader.slice(RESERVED_MARKER_PREFIX.length);
  const sepIndex = afterPrefix.indexOf(MARKER_SEPARATOR);
  if (sepIndex <= 0) {
    return failure("runtime.request-body-marker-invalid");
  }
  const ruleId = afterPrefix.slice(0, sepIndex);
  const pending = pendingAuths.get(ruleId);
  if (!pending) {
    return failure("runtime.request-body-marker-invalid");
  }
  if (pending.marker !== markerHeader) {
    return failure("runtime.request-body-marker-mismatch");
  }
  if (Date.now() > pending.expiresAt) {
    pendingAuths.delete(ruleId);
    return failure("runtime.request-body-marker-expired");
  }
  return { ok: true, value: ruleId };
}

export function registerPendingAuth(
  ruleId: string,
  requestId: string,
  marker: string,
): void {
  pendingAuths.set(ruleId, {
    requestId,
    ruleId,
    marker,
    expiresAt: Date.now() + 30000,
  });
}

export function consumePendingAuth(ruleId: string): PendingAuth | null {
  const auth = pendingAuths.get(ruleId);
  if (auth) pendingAuths.delete(ruleId);
  return auth || null;
}

export function stripReservedMarkers(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key.startsWith(RESERVED_MARKER_PREFIX)) {
      result[key] = value;
    }
  }
  return result;
}

export interface ProxyRequestResult {
  readonly body: Uint8Array;
  readonly headers: Record<string, string>;
}

export async function proxyRequest(
  context: ProxyContext,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
): Promise<RuntimeResult<ProxyRequestResult>> {
  const targetUrl = url;

  const wireValidation = validateRequestWire(method, headers, body);
  if (!wireValidation.ok) return wireValidation;
  const targetValidation = validateTargetUrl(
    targetUrl,
    context.allowedOrigins,
    context.localOrigins,
  );
  if (!targetValidation.ok) return targetValidation;

  const pinResult = await resolveAndPin(targetUrl);
  if (!pinResult.ok) return pinResult;

  const pinnedAddress = pinResult.value;

  const urlObj = new URL(targetUrl);
  const targetHost = urlObj.hostname;

  const forwardHeaders = buildForwardHeaders(
    headers,
    body.byteLength,
    "application/json",
    targetHost,
  );

  const { connect } = await import("node:net");
  const { TLSSocket } = await import("node:tls");

  const isHttps = targetUrl.startsWith("https:");
  const port = isHttps ? 443 : 80;

  return new Promise((resolve) => {
    const socket = isHttps
      ? new TLSSocket(connect(port, pinnedAddress), {
          rejectUnauthorized: false,
        })
      : connect(port, pinnedAddress);

    socket.setTimeout(RUNTIME_LIMITS.connectTimeoutMs);

    socket.on("error", (_err) => {
      resolve(failure("runtime.request-body-upstream-failed"));
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(failure("runtime.request-body-timeout"));
    });

    socket.on("connect", () => {
      const requestLine = `${method} ${urlObj.pathname}${urlObj.search} HTTP/1.1\r\n`;
      const headerLines = Object.entries(forwardHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      const request = `${requestLine + headerLines}\r\n\r\n`;

      socket.write(request, "utf-8");
      socket.write(body);
      socket.end();

      let responseHeaders = "";
      let responseBody = Buffer.alloc(0);
      let headersComplete = false;
      let contentLength = 0;

      socket.on("data", (chunk: Buffer) => {
        if (!headersComplete) {
          responseHeaders += chunk.toString();
          const headerEnd = responseHeaders.indexOf("\r\n\r\n");
          if (headerEnd >= 0) {
            headersComplete = true;
            const headerBlock = responseHeaders.slice(0, headerEnd);
            const clMatch = headerBlock.match(/content-length:\s*(\d+)/i);
            if (clMatch) contentLength = parseInt(clMatch[1], 10);
            const bodyStart = headerEnd + 4;
            const bodyData = chunk.slice(bodyStart);
            responseBody = Buffer.concat([responseBody, bodyData]);
          }
        } else {
          responseBody = Buffer.concat([responseBody, chunk]);
        }

        if (headersComplete && responseBody.length >= contentLength) {
          socket.destroy();
          resolve({
            ok: true,
            value: {
              body: new Uint8Array(responseBody.slice(0, contentLength)),
              headers: {},
            },
          });
        }
      });

      socket.on("end", () => {
        if (!responseBody.length) {
          resolve(failure("runtime.request-body-upstream-failed"));
        }
      });
    });
  });
}

export function registerPendingAuthForRule(
  ruleId: string,
  requestId: string,
): string {
  const marker = createMarker(ruleId);
  pendingAuths.set(ruleId, {
    requestId,
    ruleId,
    marker,
    expiresAt: Date.now() + 30000,
  });
  return marker;
}
