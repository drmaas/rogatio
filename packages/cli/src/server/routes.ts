import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";
import type { DryRunOptions, DryRunTestCase } from "@rogatio/dry-run";
import { dryRunProject, previewRuleAction } from "@rogatio/dry-run";
import type {
  AIClient,
  AICompletionOptions,
  AIProviderConfig,
} from "@rogatio/runtime";
import { runAIAssist } from "@rogatio/runtime";
import { diagnoseProject } from "../commands/diagnose.js";
import { readSavedMockRoot, writeSavedMockRoot } from "../mock-root-config.js";
import type { ProjectStorage } from "../utils/file.js";
export interface RouteContext {
  project: unknown;
  filePath: string;
  csrfToken: string;
  storage: ProjectStorage;
  shutdown: () => void;
  /** Bound loopback port after `server.start()`; used for Host/Origin checks. */
  boundPort: number;
  /** HTML document served at GET /editor.html. */
  editorHtml: string;
  /** Absolute path to the editor browser bundle shipped with the cli, served at GET /vendor/editor.js. */
  editorBundlePath: string;
  /** Absolute path to the editor stylesheet shipped with the cli, served at GET /vendor/editor.css. */
  editorCssPath: string;
  /** Absolute path to the directory of editor fonts shipped with the cli, served at GET /vendor/fonts/<file>. */
  editorFontsPath: string;
  /** AI client for completions (optional, when AI is configured). */
  aiClient?: AIClient;
  /** Provider config (model/url/key) when AI is configured. */
  aiProviderConfig?: AIProviderConfig;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) &&
    value.length === 1 &&
    typeof value[0] === "string"
  ) {
    return value[0];
  }
  return undefined;
}

/** Exact Host allowlist for the loopback editor server. */
export function isAllowedEditorHost(
  host: string | undefined,
  boundPort: number,
): boolean {
  if (host === undefined || !Number.isInteger(boundPort) || boundPort <= 0) {
    return false;
  }
  const expected = String(boundPort);
  return host === `127.0.0.1:${expected}` || host === `localhost:${expected}`;
}

/** Exact Origin allowlist when Origin is present on a state-changing request. */
export function isAllowedEditorOrigin(
  origin: string | undefined,
  boundPort: number,
): boolean {
  if (origin === undefined) return true;
  if (!Number.isInteger(boundPort) || boundPort <= 0) return false;
  const expected = String(boundPort);
  return (
    origin === `http://127.0.0.1:${expected}` ||
    origin === `http://localhost:${expected}`
  );
}

export function generateCsrfToken(): string {
  return randomBytes(16).toString("hex");
}

function validateCsrf(req: IncomingMessage, expectedToken: string): boolean {
  const token = req.headers["x-csrf-token"];
  return token === expectedToken;
}

const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

class RequestBodyError extends Error {
  readonly code = "request-body-too-large";
}

function getRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    const contentLength = req.headers["content-length"];
    const declaredLength = Array.isArray(contentLength)
      ? Number(contentLength[0])
      : Number(contentLength);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_REQUEST_BODY_BYTES
    ) {
      reject(new RequestBodyError());
      return;
    }
    req.on("data", (chunk) => {
      if (settled) return;
      try {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        bytes += Buffer.byteLength(text);
        if (bytes > MAX_REQUEST_BODY_BYTES) {
          settled = true;
          reject(new RequestBodyError());
          req.resume();
          return;
        }
        body += text;
      } catch (error) {
        settled = true;
        reject(error);
      }
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(body);
      }
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function bodyErrorResponse(error: unknown): {
  status: number;
  body: { code: string; message: string };
} {
  if (error instanceof RequestBodyError) {
    return {
      status: 413,
      body: {
        code: error.code,
        message: "Request body exceeds the maximum size",
      },
    };
  }
  return {
    status: 400,
    body: { code: "invalid-json", message: "Invalid JSON body" },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUrl(req: IncomingMessage): {
  pathname: string;
  searchParams: URLSearchParams;
} {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  return { pathname: url.pathname, searchParams: url.searchParams };
}

function schemaDiagnosticsForAssist(value: unknown): readonly {
  readonly code: string;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}[] {
  const diagnosis = diagnoseProject(value);
  if (diagnosis.stage !== "schema") return [];
  return diagnosis.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: "error" as const,
    path: diagnostic.path,
    message: diagnostic.message,
  }));
}

function isAIAssistRequestBody(body: unknown): body is {
  kind: "generate" | "fix" | "explain";
  prompt: string;
  context: {
    project: { groups?: unknown[] } & Record<string, unknown>;
    activeGroupId?: string;
    focusedRuleId?: string;
    diagnostics?: readonly {
      code: string;
      severity: "error";
      path: string;
      message: string;
    }[];
    dryRunCases?: readonly {
      url: string;
      method?: string;
      resourceType?: string;
    }[];
  };
} {
  if (!isRecord(body)) return false;
  if (
    body.kind !== "generate" &&
    body.kind !== "fix" &&
    body.kind !== "explain"
  ) {
    return false;
  }
  if (typeof body.prompt !== "string") return false;
  if (!isRecord(body.context) || !isRecord(body.context.project)) return false;
  return true;
}

export function createRoutes(context: RouteContext) {
  return async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const host = headerValue(req.headers.host);
    if (!isAllowedEditorHost(host, context.boundPort)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          code: "host-invalid",
          message: "Invalid Host header",
        }),
      );
      return;
    }

    const { pathname } = parseUrl(req);
    const method = req.method || "GET";

    if (method === "POST") {
      const origin = headerValue(req.headers.origin);
      if (!isAllowedEditorOrigin(origin, context.boundPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "origin-invalid",
            message: "Invalid Origin header",
          }),
        );
        return;
      }
    }

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /editor.html — the browser editor page
    if (pathname === "/editor.html" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(context.editorHtml);
      return;
    }

    // GET /vendor/editor.js — the @rogatio/editor browser bundle
    if (pathname === "/vendor/editor.js" && method === "GET") {
      try {
        const bundle = await readFile(context.editorBundlePath, "utf-8");
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
        });
        res.end(bundle);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "bundle-load-failed",
            message:
              e instanceof Error ? e.message : "Failed to load editor bundle",
          }),
        );
      }
      return;
    }

    // GET /vendor/editor.css — the @rogatio/editor browser stylesheet
    if (pathname === "/vendor/editor.css" && method === "GET") {
      try {
        const css = await readFile(context.editorCssPath, "utf-8");
        res.writeHead(200, {
          "Content-Type": "text/css; charset=utf-8",
        });
        res.end(css);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "css-load-failed",
            message:
              e instanceof Error
                ? e.message
                : "Failed to load editor stylesheet",
          }),
        );
      }
      return;
    }

    // GET /vendor/fonts/<file> — bundled editor fonts (confined to the font dir)
    if (pathname.startsWith("/vendor/fonts/") && method === "GET") {
      const fileName = pathname.slice("/vendor/fonts/".length);
      if (
        !fileName ||
        fileName.includes("..") ||
        fileName.includes("/") ||
        fileName.includes("\\")
      ) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "not-found", message: "Not found" }));
        return;
      }
      try {
        const font = await readFile(resolve(context.editorFontsPath, fileName));
        res.writeHead(200, {
          "Content-Type": "font/woff2",
        });
        res.end(font);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "not-found", message: "Not found" }));
      }
      return;
    }

    // GET /api/project
    if (pathname === "/api/project" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(context.project));
      return;
    }

    // POST /api/validate
    if (pathname === "/api/validate" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      let body: unknown;
      try {
        const bodyText = await getRequestBody(req);
        body = JSON.parse(bodyText);
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }

      const diagnosis = diagnoseProject(body);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ diagnostics: diagnosis.diagnostics }));
      return;
    }

    if (pathname === "/api/mock-root" && method === "GET") {
      const saved = await readSavedMockRoot(context.filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          root: saved ?? dirname(context.filePath),
          saved: saved !== undefined,
        }),
      );
      return;
    }

    if (pathname === "/api/mock-root" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(await getRequestBody(req));
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }
      const root =
        typeof body === "object" && body !== null && "root" in body
          ? (body as { root?: unknown }).root
          : undefined;
      if (
        root !== null &&
        (typeof root !== "string" || (root !== "" && !isAbsolute(root)))
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-root",
            message: "Mock file root must be an absolute path or null",
          }),
        );
        return;
      }
      await writeSavedMockRoot(context.filePath, root);
      const saved = await readSavedMockRoot(context.filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          root: saved ?? dirname(context.filePath),
          saved: saved !== undefined,
        }),
      );
      return;
    }

    // POST /api/save
    if (pathname === "/api/save" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      let body: unknown;
      try {
        const bodyText = await getRequestBody(req);
        body = JSON.parse(bodyText);
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }

      const diagnosis = diagnoseProject(body);
      if (diagnosis.stage === "schema") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "validation-failed",
            message: "Project validation failed",
            diagnostics: diagnosis.diagnostics,
          }),
        );
        return;
      }
      if (diagnosis.stage === "compiler") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "compilation-failed",
            message: "Project compilation failed",
            diagnostics: diagnosis.diagnostics,
          }),
        );
        return;
      }

      try {
        await context.storage.update(context.filePath, body);
        context.project = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "write-failed",
            message: e instanceof Error ? e.message : "Failed to write file",
          }),
        );
        return;
      }
    }

    // POST /api/cancel
    if (pathname === "/api/cancel" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      context.shutdown();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /api/dry-run
    if (pathname === "/api/dry-run" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      let body: unknown;
      try {
        const bodyText = await getRequestBody(req);
        body = JSON.parse(bodyText);
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }

      if (!isRecord(body) || !isRecord(body.project)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-project",
            message: "Missing or invalid project",
          }),
        );
        return;
      }

      if (!Array.isArray(body.cases)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-cases",
            message: "Cases must be an array",
          }),
        );
        return;
      }

      const diagnosis = diagnoseProject(body.project);
      if (diagnosis.stage === "schema") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "validation-failed",
            message: "Project validation failed",
            diagnostics: diagnosis.diagnostics,
          }),
        );
        return;
      }
      if (diagnosis.stage === "compiler") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "compilation-failed",
            message: "Project compilation failed",
            diagnostics: diagnosis.diagnostics,
          }),
        );
        return;
      }
      if (diagnosis.operations === undefined) {
        throw new Error("Valid project diagnosis is missing operations");
      }

      const requested =
        isRecord(body.options) &&
        typeof body.options.maxCases === "number" &&
        Number.isSafeInteger(body.options.maxCases) &&
        body.options.maxCases > 0
          ? body.options.maxCases
          : undefined;
      const options: DryRunOptions = { previewAction: previewRuleAction };
      if (requested !== undefined) options.maxCases = requested;
      const result = dryRunProject(
        diagnosis.operations,
        body.cases as DryRunTestCase[],
        options,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/ai/complete — non-streaming AI completion
    if (pathname === "/api/ai/complete" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      if (!context.aiClient) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "ai-not-configured",
            message: "AI provider not configured",
          }),
        );
        return;
      }

      let body: unknown;
      try {
        const bodyText = await getRequestBody(req);
        body = JSON.parse(bodyText);
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }

      if (!isRecord(body) || !Array.isArray(body.messages)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-request",
            message: "Missing or invalid messages array",
          }),
        );
        return;
      }

      try {
        const options: AICompletionOptions = {
          messages: body.messages as AICompletionOptions["messages"],
          model: typeof body.model === "string" ? body.model : "",
          temperature:
            typeof body.temperature === "number" ? body.temperature : undefined,
          stream: false,
          responseFormat:
            body.responseFormat as AICompletionOptions["responseFormat"],
        };
        const result = await context.aiClient?.complete(options);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "ai-error",
            message: e instanceof Error ? e.message : "AI completion failed",
          }),
        );
      }
      return;
    }

    // POST /api/ai/stream — streaming AI completion (SSE)
    if (pathname === "/api/ai/stream" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      if (!context.aiClient) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "ai-not-configured",
            message: "AI provider not configured",
          }),
        );
        return;
      }

      let body: unknown;
      try {
        const bodyText = await getRequestBody(req);
        body = JSON.parse(bodyText);
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }

      if (!isRecord(body) || !Array.isArray(body.messages)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-request",
            message: "Missing or invalid messages array",
          }),
        );
        return;
      }

      try {
        const options: AICompletionOptions = {
          messages: body.messages as AICompletionOptions["messages"],
          model: typeof body.model === "string" ? body.model : "",
          temperature:
            typeof body.temperature === "number" ? body.temperature : undefined,
          stream: true,
          responseFormat:
            body.responseFormat as AICompletionOptions["responseFormat"],
        };

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const stream = context.aiClient?.stream(options);
        for await (const chunk of stream) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          res.write(data);
        }
        res.end();
      } catch (e) {
        const errorData = `data: ${JSON.stringify({
          type: "error",
          error: e instanceof Error ? e.message : "AI streaming failed",
        })}\n\n`;
        res.write(errorData);
        res.end();
      }
      return;
    }

    // POST /api/ai/assist — validated Assist proposal (editor contract)
    if (pathname === "/api/ai/assist" && method === "POST") {
      if (!validateCsrf(req, context.csrfToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "csrf-invalid",
            message: "Invalid CSRF token",
          }),
        );
        return;
      }

      if (!context.aiClient || !context.aiProviderConfig) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "ai-not-configured",
            message: "AI provider not configured",
          }),
        );
        return;
      }

      let body: unknown;
      try {
        const bodyText = await getRequestBody(req);
        body = JSON.parse(bodyText);
      } catch (error) {
        const failure = bodyErrorResponse(error);
        res.writeHead(failure.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(failure.body));
        return;
      }

      if (!isAIAssistRequestBody(body)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-request",
            message: "Missing or invalid AI Assist request",
          }),
        );
        return;
      }

      try {
        const proposal = await runAIAssist(
          body,
          context.aiProviderConfig,
          schemaDiagnosticsForAssist,
          undefined,
          context.aiClient,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ proposal }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "ai-error",
            message: e instanceof Error ? e.message : "AI Assist failed",
          }),
        );
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "not-found", message: "Not found" }));
  };
}
