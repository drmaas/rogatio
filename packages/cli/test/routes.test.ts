import { rm, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoutes,
  generateCsrfToken,
  type RouteContext,
} from "../src/server/routes.js";

describe("API routes", () => {
  let context: RouteContext;
  let handler: ReturnType<typeof createRoutes>;
  let writeProjectMock: ReturnType<typeof vi.fn>;

  const validProject = {
    version: 1,
    name: "Test Project",
    description: "A test project",
    groups: [
      {
        id: "group1",
        name: "Group 1",
        origins: ["https://example.com"],
        rules: [
          {
            id: "rule1",
            name: "Redirect Rule",
            urlRegex: "^https://example\\.com/old/(.*)$",
            origins: [],
            resourceTypes: ["main_frame"],
            priority: 1,
            method: "GET",
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    const csrfToken = "test-csrf-token";
    writeProjectMock = vi.fn().mockResolvedValue(undefined);
    context = {
      project: { ...validProject },
      filePath: "/test/.rogatio.json",
      csrfToken,
      writeProject: writeProjectMock as (
        path: string,
        data: unknown,
      ) => Promise<void>,
      shutdown: vi.fn(),
      editorHtml: "<!DOCTYPE html><html></html>",
      editorBundlePath: "/dev/null",
      editorCssPath: "/dev/null",
      editorFontsPath: "/dev/null",
    };
    handler = createRoutes(context);
  });

  function createMockReq(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body: string = "",
  ): IncomingMessage {
    const req = new IncomingMessage(new (require("node:stream").PassThrough)());
    Object.defineProperty(req, "method", { value: method, writable: true });
    Object.defineProperty(req, "url", { value: path, writable: true });
    req.headers = headers;
    req.push(body);
    req.push(null);
    return req;
  }

  function createMockRes(): ServerResponse {
    const res = new ServerResponse(new (require("node:stream").PassThrough)());
    res.statusCode = 200;
    res.statusMessage = "OK";
    res.writeHead = vi.fn().mockReturnThis();
    res.end = vi.fn();
    res.getHeader = vi.fn();
    return res as unknown as ServerResponse;
  }

  describe("GET /api/project", () => {
    it("returns current project", async () => {
      const req = createMockReq("GET", "/api/project");
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify(validProject));
    });
  });

  describe("POST /api/validate", () => {
    it("returns validation diagnostics for valid project", async () => {
      const req = createMockReq(
        "POST",
        "/api/validate",
        { "x-csrf-token": "test-csrf-token" },
        JSON.stringify(validProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      const endCall = vi.mocked(res.end).mock.calls[0][0];
      const data = JSON.parse(endCall);
      expect(data.diagnostics).toBeDefined();
      expect(Array.isArray(data.diagnostics)).toBe(true);
    });

    it("returns schema errors for invalid project", async () => {
      const invalidProject = { ...validProject, version: 2 };
      const req = createMockReq(
        "POST",
        "/api/validate",
        { "x-csrf-token": "test-csrf-token" },
        JSON.stringify(invalidProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      const endCall = vi.mocked(res.end).mock.calls[0][0];
      const data = JSON.parse(endCall);
      expect(data.diagnostics.length).toBeGreaterThan(0);
      expect(data.diagnostics[0].severity).toBe("error");
    });

    it("requires CSRF token", async () => {
      const req = createMockReq(
        "POST",
        "/api/validate",
        {},
        JSON.stringify(validProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(403, {
        "Content-Type": "application/json",
      });
      const endCall = vi.mocked(res.end).mock.calls[0][0];
      const data = JSON.parse(endCall);
      expect(data.code).toBe("csrf-invalid");
    });

    it("rejects invalid CSRF token", async () => {
      const req = createMockReq(
        "POST",
        "/api/validate",
        { "x-csrf-token": "wrong-token" },
        JSON.stringify(validProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(403, {
        "Content-Type": "application/json",
      });
    });
  });

  describe("POST /api/save", () => {
    it("saves project and returns success", async () => {
      const req = createMockReq(
        "POST",
        "/api/save",
        { "x-csrf-token": "test-csrf-token" },
        JSON.stringify(validProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      expect(writeProjectMock).toHaveBeenCalledWith(
        "/test/.rogatio.json",
        validProject,
      );
      const endCall = vi.mocked(res.end).mock.calls[0][0];
      const data = JSON.parse(endCall);
      expect(data.ok).toBe(true);
    });

    it("requires CSRF token", async () => {
      const req = createMockReq(
        "POST",
        "/api/save",
        {},
        JSON.stringify(validProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(403, {
        "Content-Type": "application/json",
      });
    });

    it("returns error on write failure", async () => {
      writeProjectMock.mockRejectedValueOnce(new Error("Permission denied"));
      const req = createMockReq(
        "POST",
        "/api/save",
        { "x-csrf-token": "test-csrf-token" },
        JSON.stringify(validProject),
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(500, {
        "Content-Type": "application/json",
      });
      const endCall = vi.mocked(res.end).mock.calls[0][0];
      const data = JSON.parse(endCall);
      expect(data.code).toBe("write-failed");
    });
  });

  describe("POST /api/cancel", () => {
    it("triggers shutdown and returns success", async () => {
      const req = createMockReq(
        "POST",
        "/api/cancel",
        { "x-csrf-token": "test-csrf-token" },
        "{}",
      );
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      expect(context.shutdown).toHaveBeenCalled();
      const endCall = vi.mocked(res.end).mock.calls[0][0];
      const data = JSON.parse(endCall);
      expect(data.ok).toBe(true);
    });

    it("requires CSRF token", async () => {
      const req = createMockReq("POST", "/api/cancel", {}, "{}");
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(403, {
        "Content-Type": "application/json",
      });
    });
  });

  describe("404 for unknown routes", () => {
    it("returns 404 for unknown path", async () => {
      const req = createMockReq("GET", "/api/unknown");
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(404, {
        "Content-Type": "application/json",
      });
    });
  });

  describe("CSRF token generation", () => {
    it("generates random token", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(20);
    });
  });

  describe("static editor assets", () => {
    const bundlePath = join(tmpdir(), "rogatio-editor-bundle.test.js");
    const bundleContents = "export function createEditor() {}";

    beforeEach(async () => {
      await writeFile(bundlePath, bundleContents, "utf-8");
      context.editorHtml = "<!DOCTYPE html><html>editor</html>";
      context.editorBundlePath = bundlePath;
    });

    afterEach(async () => {
      await rm(bundlePath, { force: true });
    });

    it("serves /editor.html with the editor document", async () => {
      const req = createMockReq("GET", "/editor.html");
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          "Content-Type": "text/html; charset=utf-8",
        }),
      );
      expect(res.end).toHaveBeenCalledWith(
        "<!DOCTYPE html><html>editor</html>",
      );
    });

    it("serves /vendor/editor.js with the bundle", async () => {
      const req = createMockReq("GET", "/vendor/editor.js");
      const res = createMockRes();
      await handler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          "Content-Type": "text/javascript; charset=utf-8",
        }),
      );
      expect(res.end).toHaveBeenCalledWith(bundleContents);
    });
  });
});
