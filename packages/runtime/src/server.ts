import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { isAbsolute } from "node:path";
import { authorizeExact } from "./authorization.js";
import {
  acquireOperation,
  closeCapabilityState,
  createCapabilityState,
  findSession,
  pairCapability,
} from "./capability.js";
import { failure } from "./errors.js";
import { RUNTIME_LIMITS } from "./limits.js";
import { normalizeRuntimePreset } from "./preset.js";
import {
  CAPABILITY_HEADER,
  header,
  PRESET_DIGEST_HEADER,
  parseCanonicalDescriptor,
  readBody,
  SESSION_CAPABILITY_HEADER,
  sendError,
  sendJson,
  statusForError,
  validateRequest,
} from "./protocol.js";
import type {
  RuntimeResult,
  RuntimeServer,
  RuntimeServerOptions,
} from "./types.js";

const PAIR_PATH = "/v1/pair";
const AUTHORIZE_PATH = "/v1/authorize";

function isTrustedRoot(value: unknown): value is string {
  if (typeof value !== "string" || !isAbsolute(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 0x1f || value.charCodeAt(index) === 0x7f)
      return false;
  }
  return true;
}

function hasFileGrant(
  preset: ReturnType<typeof normalizeRuntimePreset> extends RuntimeResult<
    infer T
  >
    ? T
    : never,
): boolean {
  return preset.grants.some((grant) => grant.kind === "confined-file");
}

function badRoute(path: string | undefined): boolean {
  return path?.includes("://") === true || path === "*";
}

export async function createRuntimeServer(
  options: RuntimeServerOptions,
): Promise<RuntimeResult<RuntimeServer>> {
  const input = {
    version: options.preset.version,
    limits: options.preset.limits,
    matchers: options.preset.matchers,
    grants: options.preset.grants,
  };
  const normalized = normalizeRuntimePreset(input);
  if (!normalized.ok) return normalized;
  if (hasFileGrant(normalized.value) && !isTrustedRoot(options.fileRoot)) {
    return failure("runtime.invalid-preset");
  }

  const clock = options.clock ?? Date.now;
  let state: ReturnType<typeof createCapabilityState>;
  try {
    state = createCapabilityState(normalized.value, clock());
  } catch {
    return failure("runtime.internal");
  }

  const sockets = new Set<Socket>();
  const server = createServer(
    {
      maxHeaderSize: RUNTIME_LIMITS.maxRequestHeaderBytes,
      headersTimeout: RUNTIME_LIMITS.responseHeaderTimeoutMs,
      requestTimeout: RUNTIME_LIMITS.operationTimeoutMs,
      keepAliveTimeout: RUNTIME_LIMITS.bodyIdleTimeoutMs,
      requireHostHeader: true,
    },
    async (request, response) => {
      if (state.closed) {
        sendError(response, 401, "runtime.authorization-denied");
        return;
      }

      const path = request.url;
      if (path !== PAIR_PATH && path !== AUTHORIZE_PATH) {
        request.resume();
        sendError(
          response,
          badRoute(path) ? 400 : 404,
          "runtime.request-malformed",
        );
        return;
      }

      const validation = validateRequest(request, path);
      if (!validation.ok) {
        request.resume();
        sendError(response, statusForError(validation.code), validation.code);
        return;
      }

      if (path === PAIR_PATH) {
        if (validation.contentLength !== 0) {
          request.resume();
          sendError(response, 400, "runtime.request-malformed");
          return;
        }
        const result = pairCapability(
          state,
          header(request, CAPABILITY_HEADER),
          header(request, PRESET_DIGEST_HEADER),
          clock(),
        );
        if (!result.ok) {
          sendError(
            response,
            statusForError(result.error.code),
            result.error.code,
          );
          return;
        }
        sendJson(response, 200, {
          ok: true,
          protocol: "f6-v1",
          sessionCapability: result.value.sessionCapability,
          expiresInMs: result.value.expiresInMs,
        });
        return;
      }

      const contentType = header(request, "content-type");
      if (
        contentType === undefined ||
        contentType.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
      ) {
        request.resume();
        sendError(response, 400, "runtime.request-malformed");
        return;
      }
      const session = findSession(
        state,
        header(request, SESSION_CAPABILITY_HEADER),
        header(request, PRESET_DIGEST_HEADER),
        clock(),
      );
      if (session === null) {
        request.resume();
        sendError(response, 401, "runtime.authorization-denied");
        return;
      }
      const body = await readBody(
        request,
        validation.contentLength,
        RUNTIME_LIMITS.maxControlBodyBytes,
      );
      if (!body.ok) {
        sendError(response, statusForError(body.error.code), body.error.code);
        return;
      }
      const descriptor = parseCanonicalDescriptor(body.value);
      if (!descriptor.ok) {
        sendError(response, 400, descriptor.error.code);
        return;
      }
      const authorization = authorizeExact(normalized.value, descriptor.value);
      if (!authorization.ok) {
        sendError(response, 403, authorization.error.code);
        return;
      }
      const admission = acquireOperation(state, session);
      if (!admission.ok) {
        sendError(
          response,
          statusForError(admission.error.code),
          admission.error.code,
        );
        return;
      }
      try {
        sendJson(response, 200, { ok: true, authorized: true });
      } finally {
        admission.value();
      }
    },
  );

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen({ host: "127.0.0.1", port: 0 }, () => resolveListen());
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("invalid address");
    const info = address as AddressInfo;
    const bootstrap = Object.freeze({
      host: "127.0.0.1" as const,
      port: info.port,
      presetDigest: normalized.value.digest,
      bootstrapCapability: state.bootstrap,
    });
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      closeCapabilityState(state);
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
    };
    return {
      ok: true,
      value: Object.freeze({ bootstrap, stop }),
    };
  } catch {
    closeCapabilityState(state);
    for (const socket of sockets) socket.destroy();
    if (server.listening) server.close();
    return failure("runtime.local-bind-denied");
  }
}
