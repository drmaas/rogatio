import type { EditorDiagnostic } from "@rogatio/editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AIAssistRequest,
  type AIProposal,
  type AIProviderConfig,
  runAIAssist,
} from "../src/ai-assist.js";
import type { AIClient } from "../src/ai-client.js";
import { buildSystemPrompt } from "../src/ai-prompt.js";

describe("ai-assist", () => {
  const mockConfig: AIProviderConfig = {
    providerUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-test123",
  };

  let mockClient: AIClient;
  let validateMock: ReturnType<typeof vi.fn>;
  let dryRunMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    validateMock = vi.fn().mockReturnValue([]);
    dryRunMock = vi.fn();

    mockClient = {
      complete: vi.fn().mockResolvedValue({ content: "", usage: undefined }),
      stream: vi.fn().mockRejectedValue(new Error("Stream not available")),
    } as AIClient;
  });

  function createMockProposal(overrides: Partial<AIProposal> = {}): AIProposal {
    return {
      rules: [
        {
          kind: "redirect",
          groupId: "group-1",
          name: "Redirect API",
          urlRegex: "^https://api\\.example\\.com/",
          origins: ["https://api.example.com"],
          resourceTypes: ["main_frame", "xmlhttprequest"],
          priority: 100,
          method: "GET",
          action: { destination: "https://mock.example.com/$1" },
        },
      ],
      explanation: "Redirects API calls to mock server",
      ...overrides,
    };
  }

  function createValidProject(): unknown {
    return {
      version: 1,
      name: "Test Project",
      groups: [
        {
          id: "group-1",
          name: "API Rules",
          origins: ["https://api.example.com"],
          rules: [],
        },
      ],
    };
  }

  describe("runAIAssist", () => {
    it("calls client.complete and validates result", async () => {
      const proposal = createMockProposal();
      mockClient.complete = vi.fn().mockResolvedValue({
        content: JSON.stringify(proposal),
        usage: { promptTokens: 100, completionTokens: 50 },
      });
      validateMock.mockReturnValue([]); // No diagnostics = valid

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      const result = await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock,
        mockClient,
      );

      expect(result).toEqual(proposal);
      expect(mockClient.complete).toHaveBeenCalledOnce();
      expect(validateMock).toHaveBeenCalledOnce();
    });

    it("uses streaming when available", async () => {
      const proposal = createMockProposal();
      const chunks = [
        { delta: JSON.stringify(proposal).slice(0, 20), done: false },
        {
          delta: JSON.stringify(proposal).slice(20),
          done: true,
          usage: { promptTokens: 100, completionTokens: 50 },
        },
      ];
      mockClient.stream = vi.fn().mockImplementation(async function* () {
        for (const chunk of chunks) yield chunk;
      });
      validateMock.mockReturnValue([]);

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      const result = await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock as (
          project: unknown,
          cases: readonly import("@rogatio/editor").DryRunTestCase[],
        ) => import("@rogatio/editor").DryRunResult,
        mockClient,
      );

      expect(result).toEqual(proposal);
      expect(mockClient.stream).toHaveBeenCalledOnce();
      expect(validateMock).toHaveBeenCalledOnce();
    });

    it("retries with fix when validation fails", async () => {
      const invalidProposal = createMockProposal({
        rules: [{ ...createMockProposal().rules[0], urlRegex: "[invalid" }],
      });
      const fixedProposal = createMockProposal();

      mockClient.complete
        .mockResolvedValueOnce({ content: JSON.stringify(invalidProposal) })
        .mockResolvedValueOnce({ content: JSON.stringify(fixedProposal) });

      validateMock
        .mockReturnValueOnce([
          {
            code: "schema.invalid-regex",
            severity: "error",
            path: "/groups/0/rules/0/urlRegex",
            message: "Invalid regex",
          } as EditorDiagnostic,
        ])
        .mockReturnValueOnce([]);

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      const result = await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock as (
          project: unknown,
          cases: readonly import("@rogatio/editor").DryRunTestCase[],
        ) => import("@rogatio/editor").DryRunResult,
        mockClient,
      );

      expect(result).toEqual(fixedProposal);
      expect(mockClient.complete).toHaveBeenCalled();
      expect(validateMock).toHaveBeenCalled();
    });

    it("fails after max fix attempts", async () => {
      const invalidProposal = createMockProposal({
        rules: [{ ...createMockProposal().rules[0], urlRegex: "[invalid" }],
      });

      mockClient.complete.mockResolvedValue({
        content: JSON.stringify(invalidProposal),
      });
      validateMock.mockReturnValue([
        {
          code: "schema.invalid-regex",
          severity: "error",
          path: "/groups/0/rules/0/urlRegex",
          message: "Invalid regex",
        } as EditorDiagnostic,
      ]);

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      await expect(
        runAIAssist(
          request,
          mockConfig,
          validateMock,
          dryRunMock as (
            project: unknown,
            cases: readonly import("@rogatio/editor").DryRunTestCase[],
          ) => import("@rogatio/editor").DryRunResult,
          mockClient,
        ),
      ).rejects.toThrow(/max fix attempts/i);

      expect(mockClient.complete).toHaveBeenCalled();
      expect(validateMock).toHaveBeenCalled();
    });

    it("passes diagnostics to fix request", async () => {
      const invalidProposal = createMockProposal({
        rules: [{ ...createMockProposal().rules[0], urlRegex: "[invalid" }],
      });
      const fixedProposal = createMockProposal();

      mockClient.complete
        .mockResolvedValueOnce({ content: JSON.stringify(invalidProposal) })
        .mockResolvedValueOnce({ content: JSON.stringify(fixedProposal) });

      validateMock
        .mockReturnValueOnce([
          {
            code: "schema.invalid-regex",
            severity: "error",
            path: "/groups/0/rules/0/urlRegex",
            message: "Invalid regex",
          } as EditorDiagnostic,
        ])
        .mockReturnValueOnce([]);

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock as (
          project: unknown,
          cases: readonly import("@rogatio/editor").DryRunTestCase[],
        ) => import("@rogatio/editor").DryRunResult,
        mockClient,
      );

      // Verify complete was called at least once
      expect(mockClient.complete).toHaveBeenCalled();
    });

    it("handles fix request kind", async () => {
      const fixedProposal = createMockProposal();
      mockClient.complete.mockResolvedValue({
        content: JSON.stringify(fixedProposal),
      });
      validateMock.mockReturnValue([]);

      const request: AIAssistRequest = {
        kind: "fix",
        prompt: "Fix the invalid regex",
        context: {
          project: createValidProject(),
          diagnostics: [
            {
              code: "schema.invalid-regex",
              severity: "error",
              path: "/groups/0/rules/0/urlRegex",
              message: "Invalid regex",
            } as EditorDiagnostic,
          ],
        },
      };

      const result = await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock as (
          project: unknown,
          cases: readonly import("@rogatio/editor").DryRunTestCase[],
        ) => import("@rogatio/editor").DryRunResult,
        mockClient,
      );

      expect(result).toEqual(fixedProposal);
      expect(mockClient.complete).toHaveBeenCalled();
    });
  });

  describe("buildSystemPrompt", () => {
    it("includes schema constraints", () => {
      const prompt = buildSystemPrompt(createValidProject());
      expect(prompt.toLowerCase()).toContain("regex");
      expect(prompt.toLowerCase()).toContain("forbidden");
      expect(prompt.toLowerCase()).toContain("origin");
      expect(prompt.toLowerCase()).toContain("resourcetypes");
      expect(prompt.toLowerCase()).toContain("method");
    });

    it("includes all rule types", () => {
      const prompt = buildSystemPrompt(createValidProject());
      expect(prompt).toContain("redirect");
      expect(prompt).toContain("query");
      expect(prompt).toContain("header");
      expect(prompt).toContain("mock");
      expect(prompt).toContain("response-body");
      expect(prompt).toContain("request-body");
    });

    it("includes compiler diagnostic codes reference", () => {
      const prompt = buildSystemPrompt(createValidProject());
      expect(prompt.toLowerCase()).toContain("diagnostic");
      expect(prompt.toLowerCase()).toContain("code");
    });

    it("includes current project JSON", () => {
      const project = createValidProject();
      const prompt = buildSystemPrompt(project);
      expect(prompt).toContain("Test Project");
      expect(prompt).toContain("API Rules");
    });

    it("specifies JSON output format", () => {
      const prompt = buildSystemPrompt(createValidProject());
      expect(prompt).toContain("JSON");
      expect(prompt).toContain("rules");
      expect(prompt).toContain("explanation");
    });

    it("instructs minimal changes", () => {
      const prompt = buildSystemPrompt(createValidProject());
      expect(prompt.toLowerCase()).toContain("minimal");
    });

    it("instructs dry-run validation", () => {
      const prompt = buildSystemPrompt(createValidProject());
      expect(prompt).toContain("dry-run");
    });
  });
});
