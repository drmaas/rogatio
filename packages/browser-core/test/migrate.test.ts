import { describe, expect, it } from "vitest";
import { createEmptyEnvelope, migrateEnvelope } from "../src/index.js";

function makeProjectDataV1(): Record<string, unknown> {
  return {
    version: 1,
    name: "Project A",
    groups: [
      {
        id: "group-a",
        name: "Group A",
        origins: ["https://example.com"],
        rules: [
          {
            id: "rule-a",
            name: "Rule A",
            urlRegex: "^https://example\\.com/",
            origins: [],
            resourceTypes: ["main_frame"],
            priority: 100,
          },
        ],
      },
    ],
  };
}

interface ProjectFixture {
  id: string;
  name: string;
  data: Record<string, unknown>;
  revision: number;
  createdAt: number;
  updatedAt: number;
  enabledGroupIds: string[];
  grantedOrigins?: string[];
}

interface EnvelopeFixture {
  version: number;
  projects: Record<string, ProjectFixture>;
  activeProjectId: string | null;
}

function makeEnvelope(version = 2): EnvelopeFixture {
  const data =
    version === 2
      ? {
          version: 2,
          name: "Project A",
          groups: [
            {
              id: "group-a",
              name: "Group A",
              rules: [
                {
                  id: "rule-a",
                  name: "Rule A",
                  source: {
                    key: "url",
                    operator: "regex",
                    value: "^https://example\\.com/",
                  },
                  resourceTypes: ["main_frame"],
                  priority: 100,
                },
              ],
            },
          ],
        }
      : makeProjectDataV1();
  return {
    version,
    projects: {
      p1: {
        id: "p1",
        name: "Project A",
        data,
        revision: 3,
        createdAt: 1,
        updatedAt: 2,
        enabledGroupIds: ["group-a"],
        ...(version === 1 ? { grantedOrigins: ["https://example.com"] } : {}),
      },
    },
    activeProjectId: "p1",
  };
}

describe("migrateEnvelope", () => {
  it("turns an empty storage value into a fresh empty v2 envelope", () => {
    const result = migrateEnvelope(undefined);

    expect(result).toEqual({ ok: true, envelope: createEmptyEnvelope() });
    if (result.ok) {
      expect(result.envelope).toEqual({
        version: 2,
        projects: {},
        activeProjectId: null,
      });
    }
  });

  it("accepts a valid version-2 envelope", () => {
    const result = migrateEnvelope(structuredClone(makeEnvelope(2)));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.version).toBe(2);
      expect(result.envelope.projects.p1?.data.version).toBe(2);
      expect(result.envelope.projects.p1).not.toHaveProperty("grantedOrigins");
    }
  });

  it("migrates a version-1 envelope to v2 project data with notices", () => {
    const result = migrateEnvelope(structuredClone(makeEnvelope(1)));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.version).toBe(2);
      const stored = result.envelope.projects.p1;
      expect(stored?.data.version).toBe(2);
      expect(stored?.data.groups[0]?.rules[0]).toMatchObject({
        source: {
          key: "url",
          operator: "regex",
          value: "^https://example\\.com/",
        },
      });
      expect(result.envelope.migrationNotices?.p1?.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown envelope versions", () => {
    for (const version of [0, -1, 3, "2"]) {
      const result = migrateEnvelope({
        ...makeEnvelope(2),
        version,
      });
      expect(result.ok).toBe(false);
    }
  });
});
