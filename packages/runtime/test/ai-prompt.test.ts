import { diagnosticMessages } from "@rogatio/compiler";
import {
  FORBIDDEN_REQUEST_HEADERS,
  FORBIDDEN_REQUEST_PREFIXES,
  FORBIDDEN_RESPONSE_HEADERS,
  HTTP_METHODS,
  LIMITS,
  RESOURCE_TYPES,
} from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/ai-prompt.js";

describe("ai-prompt", () => {
  function createTestProject(): unknown {
    return {
      version: 2,
      name: "Test Project",
      description: "A test project",
      groups: [
        {
          id: "group-1",
          name: "API Rules",
          rules: [
            {
              id: "rule-1",
              name: "Redirect API",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://api\\.example\\.com/",
              },
              resourceTypes: ["main_frame"],
              priority: 100,
              method: "GET",
              type: "redirect",
              redirect: {
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

    it("lists schema forbidden headers and request prefixes", () => {
      const section = prompt.slice(
        prompt.indexOf("### Forbidden Headers"),
        prompt.indexOf("### Resource Types"),
      );
      for (const header of FORBIDDEN_REQUEST_HEADERS) {
        expect(section).toContain(`request: ${header}`);
      }
      for (const header of FORBIDDEN_RESPONSE_HEADERS) {
        expect(section).toContain(`response: ${header}`);
      }
      for (const prefix of FORBIDDEN_REQUEST_PREFIXES) {
        expect(section).toContain(`request prefix: ${prefix}`);
      }
      expect(section).not.toContain("referer");
    });

    it("includes source condition docs", () => {
      expect(prompt).toContain("source");
      expect(prompt).toContain('"url"');
      expect(prompt).toContain('"host"');
    });

    it("includes resource types list", () => {
      expect(prompt).toContain("resourceTypes");
      expect(prompt).toContain("main_frame");
      expect(prompt).toContain("xmlhttprequest");
    });

    it("lists schema resource types without fetch or manifest", () => {
      const line = [...RESOURCE_TYPES].join(", ");
      expect(prompt).toContain(`### Resource Types\n${line}\n`);
      expect(line.split(", ")).not.toContain("fetch");
      expect(line.split(", ")).not.toContain("manifest");
    });

    it("includes HTTP method enum", () => {
      expect(prompt).toContain("GET");
      expect(prompt).toContain("POST");
      expect(prompt).toContain("method");
      expect(prompt).toContain(
        `### HTTP Methods\n${[...HTTP_METHODS].join(", ")}\n`,
      );
    });

    it("uses schema group and rule bounds", () => {
      expect(prompt).toContain(
        [
          "- Max 64 projects per profile",
          `- Max ${LIMITS.maxGroups} groups per project`,
          `- Max ${LIMITS.maxRulesPerGroup} rules per group`,
          `- Max ${LIMITS.maxRulesPerProject} rules per project`,
        ].join("\n"),
      );
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

    it("lists every compiler diagnostic code", () => {
      // A code the compiler can never emit teaches the model nothing, and a code
      // it can emit but the prompt omits leaves the model unable to repair it.
      const codes = Object.keys(diagnosticMessages);
      expect(codes).toEqual(
        expect.arrayContaining([
          "compiler.mock-body-source",
          "compiler.mock-forbidden-header",
        ]),
      );
      for (const [code, message] of Object.entries(diagnosticMessages)) {
        expect(prompt).toContain(`${code} - ${message}`);
      }
    });

    it("does not list codes the compiler cannot emit", () => {
      for (const invented of [
        "schema.invalid-regex",
        "schema.invalid-resource-type",
        "schema.invalid-method",
        "schema.regex-too-long",
        "compiler.unsupported-operation",
      ]) {
        expect(prompt).not.toContain(invented);
      }
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
      expect(prompt).toContain("source");
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
        version: 2,
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
      const project = { version: 2, name: "", groups: [] };
      const prompt = buildSystemPrompt(project);
      expect(prompt).toContain("name");
    });
  });
});
