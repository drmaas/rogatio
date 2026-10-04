import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import { previewRuleAction } from "../src/index.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageSrc = resolve(testDir, "../src");

const mockSource = {
  key: "url" as const,
  operator: "regex" as const,
  value: "^https://example\\.com/mock/(.*)$",
};

function mockProject(mock: Record<string, unknown>) {
  return {
    version: 2 as const,
    name: "Mock preview",
    groups: [
      {
        id: "grp",
        name: "Group",
        rules: [
          {
            id: "rule-mock",
            name: "Mock",
            source: mockSource,
            resourceTypes: ["main_frame"],
            priority: 1,
            type: "mock",
            mock,
          },
        ],
      },
    ],
  };
}

function mockOperation(mock: Record<string, unknown>) {
  const compiled = compileProject(mockProject(mock));
  if (!compiled.ok) {
    throw new Error(
      compiled.diagnostics.map((item) => item.message).join("; "),
    );
  }
  const op = compiled.operations[0];
  if (op?.kind !== "mock") throw new Error("expected mock operation");
  return op;
}

const matchedUrl = "https://example.com/mock/case";

describe("previewRuleAction mock", () => {
  it("summarizes an inline mock with status and body source only", () => {
    expect(
      previewRuleAction(
        mockOperation({ status: 200, body: "hello" }),
        matchedUrl,
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (inline body)",
    });
  });

  it("summarizes a file-backed mock without disclosing the path", () => {
    const preview = previewRuleAction(
      mockOperation({
        status: 404,
        file: "nested/secret-response.bin",
      }),
      matchedUrl,
    );
    expect(preview).toEqual({
      kind: "mock",
      summary: "Mock 404 (file-backed body)",
    });
    expect(preview?.summary).not.toContain("nested");
    expect(preview?.summary).not.toContain("secret");
    expect(preview?.summary).not.toContain(".bin");
    expect(preview?.summary).not.toContain("/");
  });

  it("includes delay when delayMs is set", () => {
    expect(
      previewRuleAction(
        mockOperation({ status: 200, body: "x", delayMs: 500 }),
        matchedUrl,
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (inline body, 500 ms delay)",
    });
  });

  it("omits delay when delayMs is absent", () => {
    expect(
      previewRuleAction(mockOperation({ status: 200, body: "x" }), matchedUrl),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (inline body)",
    });
  });

  it("includes header count when headers are non-zero", () => {
    expect(
      previewRuleAction(
        mockOperation({
          status: 200,
          body: "x",
          headers: [
            { name: "X-One", value: "1" },
            { name: "X-Two", value: "2" },
            { name: "X-Three", value: "3" },
          ],
        }),
        matchedUrl,
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (inline body, 3 headers)",
    });
  });

  it("uses singular header label for one header", () => {
    expect(
      previewRuleAction(
        mockOperation({
          status: 200,
          body: "x",
          headers: [{ name: "X-Test", value: "v" }],
        }),
        matchedUrl,
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (inline body, 1 header)",
    });
  });

  it("omits headers when the list is empty or absent", () => {
    expect(
      previewRuleAction(
        mockOperation({ status: 200, body: "x", headers: [] }),
        matchedUrl,
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 200 (inline body)",
    });
  });

  it("combines body source, headers, and delay in a stable order", () => {
    expect(
      previewRuleAction(
        mockOperation({
          status: 201,
          body: "payload",
          delayMs: 50,
          headers: [
            { name: "A", value: "1" },
            { name: "B", value: "2" },
            { name: "C", value: "3" },
          ],
        }),
        matchedUrl,
      ),
    ).toEqual({
      kind: "mock",
      summary: "Mock 201 (inline body, 3 headers, 50 ms delay)",
    });
  });

  it("returns null when the source pattern does not match", () => {
    expect(
      previewRuleAction(
        mockOperation({ status: 200, body: "x" }),
        "https://other.example/not-matched",
      ),
    ).toBeNull();
  });
});

describe("@rogatio/dry-run package boundary", () => {
  it("does not import filesystem, runtime, or permission modules from src", () => {
    // Any module specifier form: static, side-effect, dynamic, or require.
    const forbidden =
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](?:node:|(?:fs|path|net|http|https|tls|dns|child_process|worker_threads)(?:\/|["'])|@rogatio\/(?:runtime|cli|extension|browser-core)(?:\/|["']))|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/;
    const files = readdirSync(packageSrc).filter((name) =>
      name.endsWith(".ts"),
    );
    for (const file of files) {
      const source = readFileSync(join(packageSrc, file), "utf8");
      expect(
        forbidden.test(source),
        `${file} must stay free of I/O imports`,
      ).toBe(false);
    }
  });
});
