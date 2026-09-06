import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/ai-prompt.js";

describe("ai-prompt", () => {
  function createTestProject(): unknown {
    return {
      version: 1,
      name: "Test Project",
      description: "A test project",
      groups: [
        {
          id: "group-1",
          name: "API Rules",
          origins: ["https://api.example.com"],
          rules: [
            {
              id: "rule-1",
              name: "Redirect API",
              urlRegex: "^https://api\\.example\\.com/",
              origins: ["https://api.example.com"],
              resourceTypes: ["main_frame"],
              priority: 100,
              method: "GET",
              action: {
                kind: "redirect",
                destination: "https://mock.example.com/$1",
              },
            },
          ],
        },
      ],
    };
  }

  it("returns non-empty string", () => {
    const prompt = buildSystemPrompt(createTestProject());
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes system role instruction", () => {
    const prompt = buildSystemPrompt(createTestProject());
    expect(prompt).toContain("You are an expert");
    expect(prompt).toContain("Rogatio");
  });

  describe("Schema constraints", () => {
    const prompt = buildSystemPrompt(createTestProject());

    it("includes regex limit (2048 chars)", () => {
      expect(prompt).toContain("2048");
      expect(prompt).toContain("regex");
    });

    it("includes forbidden headers", () => {
      expect(prompt.toLowerCase()).toContain("forbidden");
      expect(prompt.toLowerCase()).toContain("header");
    });

    it("includes origin bounds (http/https only)", () => {
      expect(prompt).toContain("http");
      expect(prompt).toContain("https");
      expect(prompt).toContain("origin");
    });

    it("includes resource types list", () => {
      expect(prompt).toContain("resourceTypes");
      expect(prompt).toContain("main_frame");
      expect(prompt).toContain("xmlhttprequest");
    });

    it("includes HTTP method enum", () => {
      expect(prompt).toContain("GET");
      expect(prompt).toContain("POST");
      expect(prompt).toContain("method");
    });
  });

  describe("Rule types", () => {
    const prompt = buildSystemPrompt(createTestProject());

    it("includes redirect with action schema", () => {
      expect(prompt).toContain("redirect");
      expect(prompt).toContain("destination");
    });

    it("includes query with action schema", () => {
      expect(prompt).toContain("query");
      expect(prompt).toContain("parameters");
    });

    it("includes header with action schema", () => {
      expect(prompt).toContain("header");
      expect(prompt).toContain("direction");
    });

    it("includes mock with action schema", () => {
      expect(prompt).toContain("mock");
      expect(prompt).toContain("status");
    });

    it("includes response-body with action schema", () => {
      expect(prompt).toContain("response-body");
      expect(prompt).toContain("replacement");
    });

    it("includes request-body with action schema", () => {
      expect(prompt).toContain("request-body");
      expect(prompt).toContain("replacement");
    });
  });

  describe("Diagnostic codes", () => {
    const prompt = buildSystemPrompt(createTestProject());

    it("includes compiler diagnostic codes reference", () => {
      expect(prompt.toLowerCase()).toContain("diagnostic");
      expect(prompt.toLowerCase()).toContain("code");
    });
  });

  describe("Output format", () => {
    const prompt = buildSystemPrompt(createTestProject());

    it("specifies JSON output with rules and explanation", () => {
      expect(prompt).toContain("JSON");
      expect(prompt).toContain("rules");
      expect(prompt).toContain("explanation");
    });

    it("specifies RuleProposal structure", () => {
      expect(prompt).toContain("RuleProposal");
      expect(prompt).toContain("kind");
      expect(prompt).toContain("groupId");
      expect(prompt).toContain("name");
      expect(prompt).toContain("urlRegex");
      expect(prompt).toContain("action");
    });
  });

  describe("Instructions", () => {
    const prompt = buildSystemPrompt(createTestProject());

    it("instructs minimal changes", () => {
      expect(prompt.toLowerCase()).toContain("minimal");
    });

    it("instructs dry-run validation", () => {
      expect(prompt).toContain("dry-run");
    });

    it("instructs valid JSON output", () => {
      expect(prompt).toContain("valid JSON");
    });
  });

  describe("Project context", () => {
    it("includes project name and description", () => {
      const project = {
        version: 1,
        name: "My Project",
        description: "Project description",
        groups: [],
      };
      const prompt = buildSystemPrompt(project);
      expect(prompt).toContain("My Project");
      expect(prompt).toContain("Project description");
    });

    it("includes groups and rules", () => {
      const prompt = buildSystemPrompt(createTestProject());
      expect(prompt).toContain("group-1");
      expect(prompt).toContain("API Rules");
      expect(prompt).toContain("rule-1");
      expect(prompt).toContain("Redirect API");
    });

    it("handles empty project", () => {
      const project = { version: 1, name: "", groups: [] };
      const prompt = buildSystemPrompt(project);
      expect(prompt).toContain("name");
    });
  });
});
