import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { validateResolvedAddresses } from "./address-policy.js";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import type {
  AuthorizedOperation,
  OutboundOptions,
  OutboundRequest,
  OutboundResolver,
  OutboundResponse,
  OutboundTransport,
  ResolvedAddress,
  RuntimeResult,
} from "./types.js";
import { canonicalizeOutboundTarget } from "./url.js";

const defaultResolver: OutboundResolver = {
  async lookup(hostname, signal) {
    if (signal?.aborted) throw new Error("aborted");
    const addresses = await dnsLookup(hostname, { all: true });
    return addresses.map((address) => ({
      address: address.address,
      family: address.family as 4 | 6,
    }));
  },
};

function responseHeaders(
  response: import("node:http").IncomingMessage,
): [string, string][] {
  const headers: [string, string][] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined)
      headers.push([name.toLowerCase(), value]);
  }
  return headers;
}

const defaultTransport: OutboundTransport = {
  request(options: OutboundRequest): Promise<OutboundResponse> {
    return new Promise((resolve, reject) => {
      const lookup: LookupFunction = (_hostname, _options, callback) => {
        callback(null, options.address, options.address.includes(":") ? 6 : 4);
      };
      const requestOptions = {
        hostname: options.hostname,
        port: options.port,
        path: options.path,
        method: options.method,
        headers: options.headers,
        agent: false,
        lookup,
        signal: options.signal,
        setHost: false,
        autoSelectFamily: false,
      };
      const request =
        options.protocol === "https:"
          ? httpsRequest(
              { ...requestOptions, servername: options.servername },
              (response) => {
                resolve({
                  status: response.statusCode ?? 0,
                  headers: responseHeaders(response),
                  body: response as AsyncIterable<Uint8Array>,
                });
              },
            )
          : httpRequest(requestOptions, (response) => {
              resolve({
                status: response.statusCode ?? 0,
                headers: responseHeaders(response),
                body: response as AsyncIterable<Uint8Array>,
              });
            });
      request.once("error", reject);
      request.end();
    });
  },
};

function headerValue(
  headers: readonly (readonly [string, string])[],
  name: string,
): string | undefined {
  return headers.find(([headerName]) => headerName.toLowerCase() === name)?.[1];
}

function responseHeaderBytes(
  headers: readonly (readonly [string, string])[],
): number {
  let bytes = 0;
  for (const [name, value] of headers)
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
  return bytes;
}

function combineSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export async function fetchAuthorized(
  operation: AuthorizedOperation,
  options: OutboundOptions = {},
): Promise<
  RuntimeResult<{
    status: number;
    headers: readonly (readonly [string, string])[];
    body: Uint8Array;
  }>
> {
  if (
    operation.kind !== "outbound-http" ||
    (operation.method !== "GET" && operation.method !== "HEAD")
  )
    return failure("runtime.unsupported-method");
  const target = canonicalizeOutboundTarget(operation.target);
  if (target === null || target !== operation.target)
    return failure("runtime.invalid-target");
  const url = new URL(target);
  const protocol = url.protocol === "https:" ? "https:" : "http:";
  const port = protocol === "https:" ? 443 : 80;
  const timeoutMs =
    options.operationTimeoutMs ?? RUNTIME_LIMITS.operationTimeoutMs;
  const combined = combineSignals(
    options.signal,
    Math.max(1, Math.min(timeoutMs, RUNTIME_LIMITS.operationTimeoutMs)),
  );
  try {
    const resolver = options.resolver ?? defaultResolver;
    const resolved = await resolver.lookup(url.hostname, combined.signal);
    const addresses = validateResolvedAddresses(
      resolved,
      RUNTIME_LIMITS.maxDnsAddresses,
    );
    if (addresses === null || addresses.length === 0)
      return failure("runtime.address-denied");
    const selected: ResolvedAddress = addresses[0];
    const transport = options.transport ?? defaultTransport;
    let response: OutboundResponse;
    try {
      response = await transport.request({
        protocol,
        hostname: url.hostname,
        address: selected.address,
        port,
        path: `${url.pathname}${url.search}`,
        method: operation.method,
        headers: { host: url.host, "accept-encoding": "identity" },
        ...(protocol === "https:" ? { servername: url.hostname } : {}),
        signal: combined.signal,
      });
    } catch {
      return combined.signal.aborted
        ? failure("runtime.timeout")
        : failure("runtime.internal");
    }
    if (combined.signal.aborted) return failure("runtime.timeout");
    if (response.status >= 300 && response.status <= 399)
      return failure("runtime.redirect-rejected");
    if (
      responseHeaderBytes(response.headers) >
      RUNTIME_LIMITS.maxResponseHeaderBytes
    )
      return failure("runtime.size-limit");
    const encoding = headerValue(response.headers, "content-encoding");
    if (encoding !== undefined && encoding.toLowerCase() !== "identity")
      return failure("runtime.size-limit");

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        if (combined.signal.aborted) return failure("runtime.timeout");
        const bytes =
          chunk instanceof Uint8Array
            ? Uint8Array.from(chunk)
            : Uint8Array.from(chunk as Uint8Array);
        total += bytes.byteLength;
        if (total > RUNTIME_LIMITS.maxResponseBodyBytes)
          return failure("runtime.size-limit");
        chunks.push(bytes);
      }
    } catch {
      return combined.signal.aborted
        ? failure("runtime.timeout")
        : failure("runtime.internal");
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      value: { status: response.status, headers: response.headers, body },
    };
  } catch {
    return combined.signal.aborted
      ? failure("runtime.timeout")
      : failure("runtime.dns-failed");
  } finally {
    combined.dispose();
  }
}
