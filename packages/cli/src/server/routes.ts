import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MatcherOperation, RogatioOperation } from "@rogatio/compiler";
import { compileProject } from "@rogatio/compiler";
import type { DryRunOptions, DryRunTestCase } from "@rogatio/dry-run";
import { dryRunProject } from "@rogatio/dry-run";
import { validateProjectDetailed } from "@rogatio/schema";
import { createMockPreviewAction } from "../utils/mock-preview.js";

export interface RouteContext {
  project: unknown;
  filePath: string;
  csrfToken: string;
  writeProject: (path: string, data: unknown) => Promise<void>;
  shutdown: () => void;
  /** HTML document served at GET /editor.html. */
  editorHtml: string;
  /** Absolute path to the @rogatio/editor browser bundle served at GET /vendor/editor.js. */
  editorBundlePath: string;
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

function toMatcherOperations(
  operations: readonly RogatioOperation[],
): readonly MatcherOperation[] {
  return operations.map(({ groupId, ruleId, matcher }) => ({
    kind: "matcher",
    groupId,
    ruleId,
    matcher,
  }));
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

function parseDiagnostics(
  result: ReturnType<typeof validateProjectDetailed>,
): unknown[] {
  if (!result.valid) {
    return result.errors.map((e) => ({
      code: `schema.${e.keyword}`,
      severity: "error",
      path: e.instancePath || "/",
      message: e.message,
      params: e.params,
    }));
  }
  return [];
}

function parseCompilerDiagnostics(
  result: ReturnType<typeof compileProject>,
): unknown[] {
  if (!result.ok) {
    return result.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      path: d.path,
      message: d.message,
      params: d.params,
    }));
  }
  return [];
}

export function createRoutes(context: RouteContext) {
  return async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { pathname } = parseUrl(req);
    const method = req.method || "GET";

    // CORS headers for local development
    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://127.0.0.1:*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    };

    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // GET /editor.html — the browser editor page
    if (pathname === "/editor.html" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders,
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
          ...corsHeaders,
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

      const schemaResult = validateProjectDetailed(body);
      const diagnostics = [...parseDiagnostics(schemaResult)];

      if (schemaResult.valid) {
        const compileResult = compileProject(schemaResult.data);
        diagnostics.push(...parseCompilerDiagnostics(compileResult));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ diagnostics }));
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

      const schemaResult = validateProjectDetailed(body);
      if (!schemaResult.valid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "validation-failed",
            message: "Project validation failed",
            diagnostics: parseDiagnostics(schemaResult),
          }),
        );
        return;
      }

      const compileResult = compileProject(schemaResult.data);
      if (!compileResult.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "compilation-failed",
            message: "Project compilation failed",
            diagnostics: parseCompilerDiagnostics(compileResult),
          }),
        );
        return;
      }

      try {
        await context.writeProject(context.filePath, body);
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

      const schemaResult = validateProjectDetailed(body.project);
      if (!schemaResult.valid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "validation-failed",
            message: "Project validation failed",
            diagnostics: parseDiagnostics(schemaResult),
          }),
        );
        return;
      }

      const compileResult = compileProject(schemaResult.data);
      if (!compileResult.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "compilation-failed",
            message: "Project compilation failed",
            diagnostics: parseCompilerDiagnostics(compileResult),
          }),
        );
        return;
      }

      const result = dryRunProject(
        toMatcherOperations(compileResult.operations),
        body.cases as DryRunTestCase[],
        {
          ...((body.options as DryRunOptions | undefined) ?? {}),
          previewAction: createMockPreviewAction(compileResult.operations),
        },
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "not-found", message: "Not found" }));
  };
}
