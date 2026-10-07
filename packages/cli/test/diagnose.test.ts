import { describe, expect, it } from "vitest";
import { diagnoseProject } from "../src/commands/diagnose.js";

const validProject = {
  version: 2,
  name: "Test Project",
  groups: [
    {
      id: "group1",
      name: "Group 1",
      rules: [
        {
          id: "rule1",
          name: "Match Rule",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
        },
      ],
    },
  ],
};

describe("diagnoseProject", () => {
  it("maps schema failures for a missing name and an unknown property", () => {
    const diagnosis = diagnoseProject({
      version: 2,
      groups: [],
      extra: true,
    });

    expect(diagnosis.stage).toBe("schema");
    expect(diagnosis.project).toBeUndefined();
    expect(diagnosis.operations).toBeUndefined();
    expect(diagnosis.diagnostics).toEqual([
      {
        code: "schema.required",
        severity: "error",
        path: "/name",
        message: "must have required property 'name'",
        params: { missingProperty: "name" },
      },
      {
        code: "schema.additionalProperties",
        severity: "error",
        path: "/",
        message: "must NOT have additional properties",
        params: { additionalProperty: "extra" },
      },
    ]);
  });

  it("never reports the compiler stage for schema-invalid input", () => {
    const projects = [
      {},
      { version: 2, groups: [] },
      { version: 2, name: "Named", groups: [], unexpected: 1 },
      { version: 2, name: "", groups: [] },
      { version: 3, name: "Wrong version", groups: [] },
      null,
      [],
      "not-a-project",
    ];

    for (const project of projects) {
      const diagnosis = diagnoseProject(project);
      expect(diagnosis.stage).toBe("schema");
      expect(diagnosis.project).toBeUndefined();
      expect(diagnosis.operations).toBeUndefined();
      expect(diagnosis.diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnosis.diagnostics) {
        expect(diagnostic.code.startsWith("schema.")).toBe(true);
        expect(diagnostic.severity).toBe("error");
        expect(diagnostic.path.length).toBeGreaterThan(0);
        expect(typeof diagnostic.message).toBe("string");
        expect(diagnostic.params).toEqual(expect.any(Object));
      }
    }
  });

  it("returns the validated project and compiled operations", () => {
    const diagnosis = diagnoseProject(validProject);

    expect(diagnosis.stage).toBeUndefined();
    expect(diagnosis.diagnostics).toEqual([]);
    expect(diagnosis.project).toBe(validProject);
    expect(diagnosis.operations).toEqual([
      {
        kind: "matcher",
        groupId: "group1",
        ruleId: "rule1",
        name: "Match Rule",
        redactSensitiveInLogs: false,
        matcher: {
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
        },
      },
    ]);
  });

  it("copies compiler diagnostics when compilation fails after schema validation", () => {
    // Schema validation snapshots `groups` once. The compiler snapshots it
    // again; a later read is not an array, so compilation fails after schema
    // success and the compiler diagnostic is copied through unchanged.
    let groupReads = 0;
    const project = new Proxy(
      { version: 2, name: "Shifts after validation", groups: [] },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property !== "groups") {
            return Reflect.getOwnPropertyDescriptor(target, property);
          }
          groupReads += 1;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: groupReads === 1 ? [] : "not-an-array",
          };
        },
      },
    );

    const diagnosis = diagnoseProject(project);

    expect(diagnosis.stage).toBe("compiler");
    expect(diagnosis.project).toBeUndefined();
    expect(diagnosis.operations).toBeUndefined();
    expect(diagnosis.diagnostics).toEqual([
      {
        code: "schema.invalid-type",
        severity: "error",
        path: "/groups",
        message: "The project contains a value with an invalid type.",
        params: { type: "array" },
      },
    ]);
  });
});
