import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { compileProject } from "@rogatio/compiler";
import { validateProjectDetailed } from "@rogatio/schema";

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

interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  json(): Promise<unknown>;
}

function _jsonResponse(status: number, data: unknown): ApiResponse {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    async json() {
      return data;
    },
  };
}

export function generateCsrfToken(): string {
  return randomBytes(16).toString("hex");
}

function validateCsrf(req: IncomingMessage, expectedToken: string): boolean {
  const token = req.headers["x-csrf-token"];
  return token === expectedToken;
}

function getRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
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
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-json",
            message: "Invalid JSON body",
          }),
        );
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
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "invalid-json",
            message: "Invalid JSON body",
          }),
        );
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "not-found", message: "Not found" }));
  };
}
