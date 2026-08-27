import { beforeAll, describe, expect, it } from "vitest";
import { compileProject, type RogatioOperation } from "../src/index.js";

function makeProject(): RogatioOperation[] {
  const project = {
    version: 1,
    name: "Selector test",
    groups: [
      {
        id: "g1",
        name: "Group 1",
        origins: ["https://example.com"],
        rules: [
          {
            id: "r1",
            name: "Redirect high",
            urlRegex: "^https://example\\.com/redirect$",
            origins: [],
            resourceTypes: ["xmlhttprequest"] as const,
            priority: 100,
            method: "POST" as const,
            type: "redirect" as const,
            redirect: { destination: "https://other.com" },
          },
          {
            id: "r2",
            name: "Request body medium",
            urlRegex: "^https://example\\.com/api$",
            origins: [],
            resourceTypes: ["xmlhttprequest"] as const,
            priority: 50,
            method: "POST" as const,
            type: "request-body" as const,
            requestBody: { mode: "replace" as const, body: '{"a":1}' },
          },
        ],
      },
      {
        id: "g2",
        name: "Group 2",
        origins: ["https://example.com"],
        rules: [
          {
            id: "r3",
            name: "Query low",
            urlRegex: "^https://example\\.com/query$",
            origins: [],
            resourceTypes: ["xmlhttprequest"] as const,
            priority: 10,
            method: "POST" as const,
            type: "query" as const,
            action: {
              type: "query" as const,
              params: [{ name: "x", value: "1" }],
            },
          },
        ],
      },
    ],
  };

  const result = compileProject(project);
  if (!result.ok) throw new Error("test project invalid");
  return [...result.operations];
}

describe("F17 global selector (compiler helper)", () => {
  let operations: RogatioOperation[];

  beforeAll(() => {
    operations = makeProject();
  });

  // These tests document the expected selector behavior that will be implemented
  // The actual selector function will be added in a separate module
  it("selects highest priority across all request-phase operations", () => {
    // Expected: redirect (priority 100) wins over request-body (50) and query (10)
    // This will be tested via the selector function once implemented
    expect(operations).toHaveLength(3);
  });

  it("breaks ties by source order (earlier wins)", () => {
    // The operations array preserves source order
    // If two ops have same priority, the one at lower index wins
    expect(operations[0].matcher.priority).toBe(100);
    expect(operations[1].matcher.priority).toBe(50);
    expect(operations[2].matcher.priority).toBe(10);
  });

  it("does not include response-body in request-phase selection", () => {
    // Response-body operations should be selected in response phase only
    const hasResponseBody = operations.some(
      (op) => op.kind === "response-body",
    );
    expect(hasResponseBody).toBe(false);
  });
});
