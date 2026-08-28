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
import { mintToken, parseMockToken, serveMock } from "./mock.js";
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
  NormalizedRuntimePreset,
  RuntimeMockConfig,
  RuntimeResult,
  RuntimeServer,
  RuntimeServerOptions,
} from "./types.js";

const PAIR_PATH = "/v1/pair";
const AUTHORIZE_PATH = "/v1/authorize";
const CONNECTION_PATH = "/v1/connection";
const MOCK_PROTOCOL = "v1";

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

function hasFileMock(preset: NormalizedRuntimePreset): boolean {
  return (preset.mocks ?? []).some((mock) => mock.file !== undefined);
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
    ...(options.preset.mocks !== undefined
      ? { mocks: options.preset.mocks }
      : {}),
  };
  const normalized = normalizeRuntimePreset(input);
  if (!normalized.ok) return normalized;
  if (
    (hasFileGrant(normalized.value) || hasFileMock(normalized.value)) &&
    !isTrustedRoot(options.fileRoot)
  ) {
    return failure("runtime.invalid-preset");
  }

  const mockTokens = new Map<string, RuntimeMockConfig>();
  const mockRuleTokens = new Map<string, string>();
  const mockGroupIds = new Map<string, string>();
  for (const mock of normalized.value.mocks ?? []) {
    const token = mintToken();
    mockTokens.set(token, mock);
    mockRuleTokens.set(mock.ruleId, token);
  }
  for (const matcher of normalized.value.matchers) {
    mockGroupIds.set(matcher.ruleId, matcher.groupId);
  }
  const mockStopController = new AbortController();

  const clock = options.clock ?? Date.now;
  let state: ReturnType<typeof createCapabilityState>;
  try {
    state = createCapabilityState(normalized.value, clock());
  } catch {
    return failure("runtime.internal");
  }

  const sockets = new Set<Socket>();
  let activeMockCount = 0;
  let boundPort = 0;
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

      if (path === CONNECTION_PATH) {
        if (
          request.method !== "GET" ||
          request.socket.remoteAddress !== "127.0.0.1"
        ) {
          request.resume();
          sendError(response, 404, "runtime.request-malformed");
          return;
        }
        response.setHeader("Access-Control-Allow-Origin", "*");
        sendJson(response, 200, {
          protocol: MOCK_PROTOCOL,
          port: boundPort,
          presetDigest: normalized.value.digest,
          mocks: [...mockRuleTokens.entries()].map(([ruleId, token]) => ({
            ruleId,
            token,
          })),
        });
        return;
      }

      const mockToken = parseMockToken(path);
      if (mockToken !== null) {
        if (request.socket.remoteAddress !== "127.0.0.1") {
          request.resume();
          sendError(response, 404, "runtime.request-malformed");
          return;
        }
        const mock = mockTokens.get(mockToken);
        if (mock === undefined) {
          request.resume();
          sendError(response, 404, "runtime.request-malformed");
          return;
        }
        if (activeMockCount >= RUNTIME_LIMITS.maxConcurrentOperations) {
          request.resume();
          sendError(response, 429, "runtime.overloaded");
          return;
        }
        activeMockCount += 1;
        const controller = new AbortController();
        const onClose = () => controller.abort();
        request.on("close", onClose);
        const signal = AbortSignal.any([
          controller.signal,
          mockStopController.signal,
        ]);
        try {
          await serveMock({
            request,
            response,
            mock,
            fileRoot: options.fileRoot,
            presetDigest: normalized.value.digest,
            groupId: mockGroupIds.get(mock.ruleId) ?? "",
            signal,
          });
        } finally {
          activeMockCount -= 1;
          request.off("close", onClose);
        }
        return;
      }

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
          protocol: "v1",
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
      server.listen({ host: "127.0.0.1", port: options.port ?? 0 }, () =>
        resolveListen(),
      );
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("invalid address");
    const info = address as AddressInfo;
    boundPort = info.port;
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
      mockStopController.abort();
      mockTokens.clear();
      mockRuleTokens.clear();
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
