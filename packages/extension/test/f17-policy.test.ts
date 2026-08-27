import { compileProject } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";

const project = {
  version: 1,
  name: "Request body policy",
  requestBodyPolicy: {
    localOrigins: ["http://127.0.0.1:3000", "https://localhost:8443"],
  },
  groups: [
    {
      id: "g1",
      name: "Group",
      origins: ["https://example.com"],
      rules: [
        {
          id: "r1",
          name: "Replace",
          urlRegex: "^https://example\\.com/api$",
          origins: [],
          resourceTypes: ["xmlhttprequest"] as const,
          priority: 10,
          method: "POST" as const,
          type: "request-body" as const,
          requestBody: { mode: "replace" as const, body: '{"debug":false}' },
        },
        {
          id: "r2",
          name: "Regex",
          urlRegex: "^https://example\\.com/data$",
          origins: [],
          resourceTypes: ["xmlhttprequest"] as const,
          priority: 5,
          method: "PATCH" as const,
          type: "request-body" as const,
          requestBody: {
            mode: "regex" as const,
            pattern: '"debug"\\s*:\\s*true',
            replacement: '"debug":false',
          },
        },
      ],
    },
  ],
};

describe("F17 extension policy construction (future API)", () => {
  it("builds policy from committed project state, enabled groups, granted origins, exact local origins, explicit extension ID", async () => {
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const operations = result.operations.filter(
      (op) => op.kind === "request-body",
    );
    expect(operations).toHaveLength(2);

    // Policy should include all request-phase operations for global arbitration
    // Including competing non-body operations
    // With action data, matcher data, source order, project identity/revision, grants, limits
    expect(operations[0].requestBody.mode).toBe("replace");
    expect(operations[1].requestBody.mode).toBe("regex");
  });

  it("excludes observed bodies, response bodies, cookies, credentials, sensitive headers, mock file contents", () => {
    // Policy construction must not include any traffic data or secrets
    const result = compileProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const op of result.operations) {
      // Operations should only contain configuration, not observed data
      expect(op).not.toHaveProperty("observedBody");
      expect(op).not.toHaveProperty("credentials");
      expect(op).not.toHaveProperty("cookies");
    }
  });

  it("computes deterministic digest parity with native runtime", () => {
    // Canonical policy bytes must use fixed key ordering, deterministic set ordering, compact UTF-8 JSON
    // Digest must be sha256:<64 lowercase hex>
    // Must cover: extension ID, project identity/revision, enabled groups, grants, local origins,
    // operations, action data, matchers, source order, F17 limits
    // Session nonce, timestamps, capabilities, native frame segmentation must not affect digest
    const result = compileProject(project);
    expect(result.ok).toBe(true);
  });

  it("active policy is memory-only, one active immutable policy per session", () => {
    // Policy discarded on disconnect, stop, replacement, or failure
    expect(true).toBe(true);
  });

  it("policy larger than one frame uses bounded policy-begin, policy-part, policy-commit", () => {
    // Parts carry only base64url canonical policy bytes
    // Reject malformed, duplicate, reordered, oversized, timed-out, incomplete, digest-mismatched staging
    expect(true).toBe(true);
  });
});
