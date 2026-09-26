import { compileProject } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { revalidateAuthority } from "../src/revalidate.js";

function buildProject(overrides: Partial<RogatioProject> = {}): RogatioProject {
  return {
    version: 2,
    name: "test-project",
    groups: [
      {
        id: "g1",
        name: "group-one",
        rules: [
          {
            id: "r1",
            name: "rule-one",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/.*",
            },
            resourceTypes: ["main_frame"],
            priority: 1,
            method: "GET",
          },
        ],
      },
    ],
    ...overrides,
  } as RogatioProject;
}

function buildBodyProject(): RogatioProject {
  return {
    version: 2,
    name: "body-project",
    groups: [
      {
        id: "g1",
        name: "group-one",
        rules: [
          {
            id: "r1",
            name: "body-rule",
            source: {
              key: "url",
              operator: "regex",
              value: "^https://example\\.com/.*",
            },
            resourceTypes: ["xmlhttprequest"],
            priority: 1,
            method: "POST",
            type: "request-body",
            requestBody: { mode: "replace", body: "ok" },
          },
        ],
      },
    ],
  } as RogatioProject;
}

function compile(project: RogatioProject) {
  const result = compileProject(project);
  if (!result.ok) throw new Error("compile failed");
  return result.operations;
}

const baseRequest = {
  groupId: "g1",
  ruleId: "r1",
  url: "https://example.com/page",
  method: "GET",
  resourceType: "main_frame",
  initiator: "https://example.com",
};

describe("revalidateAuthority", () => {
  it("allows a matching request derived from the canonical project", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      baseRequest,
    );
    expect(decision).toEqual({
      allowed: true,
      groupId: "g1",
      ruleId: "r1",
      operation: expect.anything(),
    });
  });

  it("denies when the url does not match the rule regex", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      { ...baseRequest, url: "https://other.com/x" },
    );
    expect(decision).toEqual({ allowed: false, reason: "url-mismatch" });
  });

  it("denies when the target origin is not same-origin", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      { ...baseRequest, target: "https://evil.com" },
    );
    expect(decision).toEqual({ allowed: false, reason: "target-unauthorized" });
  });

  it("allows absent target when the URL matches source", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      { ...baseRequest, target: undefined },
    );
    expect(decision.allowed).toBe(true);
  });

  it("denies missing initiator for a body operation", () => {
    const decision = revalidateAuthority(
      buildBodyProject(),
      compile(buildBodyProject()),
      {
        groupId: "g1",
        ruleId: "r1",
        url: "https://example.com/page",
        method: "POST",
        resourceType: "xmlhttprequest",
      },
    );
    expect(decision).toEqual({
      allowed: false,
      reason: "initiator-unauthorized",
    });
  });

  it("denies body transforms when the URL no longer matches source", () => {
    const decision = revalidateAuthority(
      buildBodyProject(),
      compile(buildBodyProject()),
      {
        groupId: "g1",
        ruleId: "r1",
        url: "https://other.example/stale",
        method: "POST",
        resourceType: "xmlhttprequest",
        initiator: "https://example.com",
      },
    );
    expect(decision).toEqual({ allowed: false, reason: "url-mismatch" });
  });

  it("allows http(s) initiator for body ops without an origins list", () => {
    const decision = revalidateAuthority(
      buildBodyProject(),
      compile(buildBodyProject()),
      {
        groupId: "g1",
        ruleId: "r1",
        url: "https://example.com/page",
        method: "POST",
        resourceType: "xmlhttprequest",
        initiator: "https://other.example",
      },
    );
    expect(decision.allowed).toBe(true);
  });

  it("denies when the method does not match", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      { ...baseRequest, method: "POST" },
    );
    expect(decision).toEqual({ allowed: false, reason: "method-mismatch" });
  });

  it("denies when the resource type is not authorized", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      { ...baseRequest, resourceType: "script" },
    );
    expect(decision).toEqual({
      allowed: false,
      reason: "resource-type-unauthorized",
    });
  });

  it("denies an unknown operation", () => {
    const decision = revalidateAuthority(
      buildProject(),
      compile(buildProject()),
      {
        ...baseRequest,
        groupId: "missing",
      },
    );
    expect(decision).toEqual({ allowed: false, reason: "operation-unknown" });
  });

  it("denies when the project is inconsistent with the operations", () => {
    const operations = compile(buildProject());
    const stripped = buildProject({
      groups: [{ id: "g1", name: "g", rules: [] }],
    });
    const decision = revalidateAuthority(stripped, operations, baseRequest);
    expect(decision).toEqual({
      allowed: false,
      reason: "project-inconsistent",
    });
  });

  it("rejects hostile project shapes (cycle) as project-invalid", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const decision = revalidateAuthority(
      cycle,
      compile(buildProject()),
      baseRequest,
    );
    expect(decision).toEqual({ allowed: false, reason: "project-invalid" });
  });

  it("rejects symbol-keyed project shapes as project-invalid", () => {
    const hostile = Object.create(null);
    Object.defineProperty(hostile, Symbol("x"), { value: 1, enumerable: true });
    const decision = revalidateAuthority(
      hostile,
      compile(buildProject()),
      baseRequest,
    );
    expect(decision).toEqual({ allowed: false, reason: "project-invalid" });
  });
});
