import { validateProjectDetailed } from "@rogatio/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AIAssistRequest,
  type AIProposal,
  type DryRunResult,
  type EditorDiagnostic,
  mergeProposalIntoProject,
  repairProposalIntoProject,
  repairTargetsFromDiagnostics,
  runAIAssist,
} from "../src/ai-assist.js";
import type { AIClient, AIProviderConfig } from "../src/ai-client.js";
import { buildSystemPrompt } from "../src/ai-prompt.js";

describe("ai-assist", () => {
  const mockConfig: AIProviderConfig = {
    providerUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-test123",
  };

  let mockClient: AIClient;
  let validateMock = vi
    .fn<(value: unknown) => readonly EditorDiagnostic[]>()
    .mockReturnValue([]);
  let dryRunMock =
    vi.fn<(project: unknown, cases: readonly unknown[]) => DryRunResult>();

  beforeEach(() => {
    validateMock = vi
      .fn<(value: unknown) => readonly EditorDiagnostic[]>()
      .mockReturnValue([]);
    dryRunMock =
      vi.fn<(project: unknown, cases: readonly unknown[]) => DryRunResult>();

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
          action: { destination: "https://mock.example.com/" },
        },
      ],
      explanation: "Redirects API calls to mock server",
      ...overrides,
    };
  }

  function createValidProject(): { groups?: unknown[] } & Record<
    string,
    unknown
  > {
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
      validateMock = vi.fn().mockReturnValue([]);

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
      validateMock = vi.fn().mockReturnValue([]);

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
      expect(mockClient.stream).toHaveBeenCalledOnce();
      expect(validateMock).toHaveBeenCalledOnce();
    });

    it("retries with fix when validation fails", async () => {
      const invalidProposal = createMockProposal({
        rules: [{ ...createMockProposal().rules[0], urlRegex: "[invalid" }],
      });
      const fixedProposal = createMockProposal();

      mockClient.complete = vi
        .fn()
        .mockResolvedValueOnce({ content: JSON.stringify(invalidProposal) })
        .mockResolvedValueOnce({ content: JSON.stringify(fixedProposal) });

      let validateCallCount = 0;
      validateMock = vi.fn((_value: unknown) => {
        validateCallCount++;
        if (validateCallCount === 1) {
          return [
            {
              code: "schema.invalid-regex",
              severity: "error" as const,
              path: "/groups/0/rules/0/urlRegex",
              message: "Invalid regex",
            } as EditorDiagnostic,
          ];
        }
        return [];
      });

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

      expect(result).toEqual(fixedProposal);
      expect(mockClient.complete).toHaveBeenCalled();
      expect(validateMock).toHaveBeenCalled();
    });

    it("fails after max fix attempts", async () => {
      const invalidProposal = createMockProposal({
        rules: [{ ...createMockProposal().rules[0], urlRegex: "[invalid" }],
      });

      mockClient.complete = vi.fn().mockResolvedValue({
        content: JSON.stringify(invalidProposal),
      });
      validateMock = vi.fn().mockReturnValue([
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
        runAIAssist(request, mockConfig, validateMock, dryRunMock, mockClient),
      ).rejects.toThrow(/max fix attempts/i);

      expect(mockClient.complete).toHaveBeenCalled();
      expect(validateMock).toHaveBeenCalled();
    });

    it("passes diagnostics to fix request", async () => {
      const invalidProposal = createMockProposal({
        rules: [{ ...createMockProposal().rules[0], urlRegex: "[invalid" }],
      });
      const fixedProposal = createMockProposal();

      mockClient.complete = vi
        .fn()
        .mockResolvedValueOnce({ content: JSON.stringify(invalidProposal) })
        .mockResolvedValueOnce({ content: JSON.stringify(fixedProposal) });

      let validateCallCount = 0;
      validateMock = vi.fn((_value: unknown) => {
        validateCallCount++;
        if (validateCallCount === 1) {
          return [
            {
              code: "schema.invalid-regex",
              severity: "error" as const,
              path: "/groups/0/rules/0/urlRegex",
              message: "Invalid regex",
            } as EditorDiagnostic,
          ];
        }
        return [];
      });

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock,
        mockClient,
      );

      expect(mockClient.complete).toHaveBeenCalled();
    });

    it("handles fix request kind", async () => {
      const fixedProposal = createMockProposal();
      mockClient.complete = vi.fn().mockResolvedValue({
        content: JSON.stringify(fixedProposal),
      });
      validateMock = vi.fn().mockReturnValue([]);

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
        dryRunMock,
        mockClient,
      );

      expect(result).toEqual(fixedProposal);
      expect(mockClient.complete).toHaveBeenCalled();
    });

    it("passes real schema validation after merge (AC-001)", async () => {
      const proposal = createMockProposal();
      mockClient.stream = vi.fn().mockImplementation(async function* () {
        yield { delta: JSON.stringify(proposal), done: true };
      });

      const schemaValidate = (value: unknown): readonly EditorDiagnostic[] => {
        const result = validateProjectDetailed(value);
        if (result.valid) return [];
        return result.errors.map((error) => ({
          code: `schema.${error.keyword}`,
          severity: "error" as const,
          path: error.instancePath,
          message: error.message ?? "invalid",
        }));
      };

      const request: AIAssistRequest = {
        kind: "generate",
        prompt: "Create a redirect rule",
        context: { project: createValidProject() },
      };

      const result = await runAIAssist(
        request,
        mockConfig,
        schemaValidate,
        undefined,
        mockClient,
      );

      expect(result).toEqual(proposal);
      const merged = mergeProposalIntoProject(createValidProject(), proposal);
      expect(validateProjectDetailed(merged).valid).toBe(true);
    });
  });

  describe("repairProposalIntoProject", () => {
    function brokenProject(): { groups?: unknown[] } & Record<string, unknown> {
      return {
        version: 1,
        name: "Broken project",
        groups: [
          {
            id: "group-1",
            name: "API Rules",
            origins: ["https://api.example.com"],
            rules: [
              {
                id: "rule-broken",
                name: "Broken",
                urlRegex: "[",
                origins: [],
                resourceTypes: ["main_frame"],
                priority: 100,
                type: "redirect",
                redirect: { destination: "https://mock.example.com/" },
              },
            ],
          },
        ],
      };
    }

    const fixDiagnostics: EditorDiagnostic[] = [
      {
        code: "schema.invalid-regex",
        severity: "error",
        path: "/groups/0/rules/0/urlRegex",
        message: "Invalid regex",
      },
    ];

    function rulesOf(
      project: Record<string, unknown>,
    ): Record<string, unknown>[] {
      return (project.groups as Record<string, unknown>[])[0].rules as Record<
        string,
        unknown
      >[];
    }

    it("extracts de-duplicated rule targets in stable order", () => {
      expect(
        repairTargetsFromDiagnostics([
          { path: "/groups/1/rules/0/name" },
          { path: "/groups/0/rules/2/urlRegex" },
          { path: "/groups/0/rules/2/action" },
          { path: "/groups/0" },
          { path: "/name" },
          { path: 42 },
          null,
        ]),
      ).toEqual([
        { groupIndex: 0, ruleIndex: 2 },
        { groupIndex: 1, ruleIndex: 0 },
      ]);
    });

    it("replaces the offending rule in place, keeping its id", () => {
      const proposal = createMockProposal();
      const repaired = repairProposalIntoProject(
        brokenProject(),
        fixDiagnostics,
        proposal,
      );
      const rules = rulesOf(repaired);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("rule-broken");
      expect(rules[0].urlRegex).toBe("^https://api\\.example\\.com/");
      expect(rules[0].type).toBe("redirect");
      expect(validateProjectDetailed(repaired).valid).toBe(true);
    });

    it("maps proposals group-scoped FIFO and appends surplus rules", () => {
      const project = brokenProject();
      const group = (project.groups as Record<string, unknown>[])[0];
      (group.rules as unknown[]).push({
        id: "rule-broken-2",
        name: "Broken 2",
        urlRegex: "(",
        origins: [],
        resourceTypes: ["main_frame"],
        priority: 100,
        type: "redirect",
        redirect: { destination: "https://mock.example.com/" },
      });
      const proposal: AIProposal = {
        rules: [
          createMockProposal().rules[0],
          createMockProposal().rules[0],
          { ...createMockProposal().rules[0], name: "Surplus" },
        ],
        explanation: "fixes",
      };
      const repaired = repairProposalIntoProject(
        project,
        [
          { path: "/groups/0/rules/1/urlRegex" },
          { path: "/groups/0/rules/0/urlRegex" },
        ],
        proposal,
      );
      const rules = rulesOf(repaired);
      expect(rules).toHaveLength(3);
      expect(rules[0].id).toBe("rule-broken");
      expect(rules[1].id).toBe("rule-broken-2");
      expect(rules[0].name).toBe("Redirect API");
      expect(rules[2].name).toBe("Surplus");
      expect(String(rules[2].id)).toMatch(/^ai-/);
    });

    it("appends like the merge when no repair target exists", () => {
      const repaired = repairProposalIntoProject(
        createValidProject(),
        [{ path: "/groups/0/rules/5/urlRegex" }],
        createMockProposal(),
      );
      const rules = rulesOf(repaired);
      expect(rules).toHaveLength(1);
      expect(String(rules[0].id)).toMatch(/^ai-/);
    });

    it("skips malformed proposal rules defensively", () => {
      const proposal = {
        rules: [
          null,
          42,
          { kind: "redirect" },
          { ...createMockProposal().rules[0], origins: 7 },
        ],
        explanation: "junk",
      } as unknown as AIProposal;
      const repaired = repairProposalIntoProject(
        brokenProject(),
        fixDiagnostics,
        proposal,
      );
      const rules = rulesOf(repaired);
      // The last rule is structurally valid; it repairs the broken rule and
      // drops the malformed origins value.
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("rule-broken");
      expect(rules[0].origins).toEqual([]);
    });

    it("runAIAssist validates the repaired project for fix requests (AC-004)", async () => {
      const fixedProposal = createMockProposal();
      mockClient.complete = vi
        .fn()
        .mockResolvedValue({ content: JSON.stringify(fixedProposal) });
      validateMock = vi.fn().mockReturnValue([]);

      const request: AIAssistRequest = {
        kind: "fix",
        prompt: "Fix the regex",
        context: { project: brokenProject(), diagnostics: fixDiagnostics },
      };

      const result = await runAIAssist(
        request,
        mockConfig,
        validateMock,
        dryRunMock,
        mockClient,
      );

      expect(result).toEqual(fixedProposal);
      expect(validateMock).toHaveBeenCalledOnce();
      const validated = validateMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const rules = rulesOf(validated);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("rule-broken");
      expect(rules[0].urlRegex).toBe("^https://api\\.example\\.com/");
    });
  });

  describe("mergeProposalIntoProject", () => {
    it("maps kind to type and inserts into the target group", () => {
      const proposal = createMockProposal();
      const merged = mergeProposalIntoProject(createValidProject(), proposal);
      const group = (merged.groups as Record<string, unknown>[])[0];
      const rules = group.rules as Record<string, unknown>[];
      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe("redirect");
      expect(rules[0].redirect).toEqual({
        destination: "https://mock.example.com/",
      });
      expect(Object.hasOwn(rules[0], "kind")).toBe(false);
      expect(validateProjectDetailed(merged).valid).toBe(true);
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
