import { describe, expect, it } from "vitest";
import { createEmptyEnvelope, migrateEnvelope } from "../src/index.js";

function makeProjectData(): Record<string, unknown> {
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
  grantedOrigins: string[];
}

interface EnvelopeFixture {
  version: number;
  projects: Record<string, ProjectFixture>;
  activeProjectId: string | null;
}

function makeEnvelope(): EnvelopeFixture {
  return {
    version: 1,
    projects: {
      p1: {
        id: "p1",
        name: "Project A",
        data: makeProjectData(),
        revision: 3,
        createdAt: 1,
        updatedAt: 2,
        enabledGroupIds: ["group-a"],
        grantedOrigins: ["https://example.com"],
      },
    },
    activeProjectId: "p1",
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("migrateEnvelope", () => {
  it("turns an empty storage value into a fresh empty envelope", () => {
    const result = migrateEnvelope(undefined);

    expect(result).toEqual({ ok: true, envelope: createEmptyEnvelope() });
    if (result.ok) {
      expect(result.envelope).toEqual({
        version: 1,
        projects: {},
        activeProjectId: null,
      });
      expect(result.envelope).not.toBe(createEmptyEnvelope());
    }
  });

  it("accepts a valid version-1 envelope and returns detached data", () => {
    const result = migrateEnvelope(structuredClone(makeEnvelope()));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope).toEqual(makeEnvelope());
      expect(result.envelope.projects.p1).not.toBeUndefined();
      const stored = result.envelope.projects.p1;
      expect(stored?.data).not.toBeUndefined();
    }
  });

  it("rejects unknown, missing, or malformed versions", () => {
    for (const version of [2, 0, -1, "1", null, {}]) {
      const result = migrateEnvelope({
        ...makeEnvelope(),
        version,
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostic.code).toBe("core.storage-corrupt");
    }
    const missing = makeEnvelope() as unknown as Record<string, unknown>;
    delete missing.version;
    expect(migrateEnvelope(missing).ok).toBe(false);
  });

  it("rejects non-object envelopes and non-record project collections", () => {
    for (const value of [null, "envelope", 42, [], [makeEnvelope()], true]) {
      const result = migrateEnvelope(value);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostic.code).toBe("core.storage-corrupt");
    }
    const arrayProjects = makeEnvelope();
    arrayProjects.projects = [makeEnvelope().projects] as unknown as Record<
      string,
      ProjectFixture
    >;
    expect(migrateEnvelope(arrayProjects).ok).toBe(false);
  });

  it("rejects structurally invalid stored projects", () => {
    const base = makeEnvelope();
    const cases: unknown[] = [
      {
        ...base,
        projects: { p1: { ...base.projects.p1, id: "different-key" } },
      },
      {
        ...base,
        projects: { p1: { ...base.projects.p1, id: "p1", name: "" } },
      },
      { ...base, projects: { p1: { ...base.projects.p1, revision: 0 } } },
      { ...base, projects: { p1: { ...base.projects.p1, revision: 1.5 } } },
      { ...base, projects: { p1: { ...base.projects.p1, revision: "3" } } },
      { ...base, projects: { p1: { ...base.projects.p1, createdAt: "1" } } },
      {
        ...base,
        projects: { p1: { ...base.projects.p1, updatedAt: Number.NaN } },
      },
      {
        ...base,
        projects: { p1: { ...base.projects.p1, data: { version: 1 } } },
      },
      {
        ...base,
        projects: {
          p1: {
            ...base.projects.p1,
            enabledGroupIds: ["group-a", "group-a"],
          },
        },
      },
      {
        ...base,
        projects: {
          p1: {
            ...base.projects.p1,
            grantedOrigins: ["https://a.example", "https://a.example"],
          },
        },
      },
      {
        ...base,
        projects: { p1: { ...base.projects.p1, enabledGroupIds: [42] } },
      },
      {
        ...base,
        projects: { p1: { ...base.projects.p1, grantedOrigins: [true] } },
      },
    ];
    for (const value of cases) {
      const result = migrateEnvelope(value);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostic.code).toBe("core.storage-corrupt");
    }
  });

  it("rejects a dangling active project id", () => {
    const envelope = makeEnvelope();
    envelope.activeProjectId = "missing";
    const result = migrateEnvelope(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe("core.storage-corrupt");
  });

  it("rejects hostile values without throwing", () => {
    const cyclic = makeEnvelope() as unknown as Record<string, unknown>;
    cyclic.projects = cyclic;

    const symbol = makeEnvelope() as unknown as Record<string, unknown>;
    Object.defineProperty(symbol, Symbol("hidden"), {
      enumerable: true,
      value: true,
    });

    const accessor = makeEnvelope();
    let getterRead = false;
    Object.defineProperty(accessor.projects.p1, "revision", {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 3;
      },
    });

    for (const value of [cyclic, symbol, accessor]) {
      expect(() => migrateEnvelope(value)).not.toThrow();
      const result = migrateEnvelope(value);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostic.code).toBe("core.storage-corrupt");
    }
    expect(getterRead).toBe(false);
  });

  it("uses stable data descriptors and ignores inherited properties", () => {
    const proxied = new Proxy(makeEnvelope(), {
      get(target, property, receiver) {
        if (property === "projects") return {};
        return Reflect.get(target, property, receiver);
      },
    });
    const proxyResult = migrateEnvelope(proxied);
    expect(proxyResult.ok).toBe(true);

    const protoEnvelope = makeEnvelope() as unknown as Record<string, unknown>;
    Object.setPrototypeOf(protoEnvelope, {
      projects: { evil: { id: "evil" } },
    });
    const protoResult = migrateEnvelope(protoEnvelope);
    expect(protoResult.ok).toBe(true);
    if (protoResult.ok) {
      expect(Object.keys(protoResult.envelope.projects)).toEqual(["p1"]);
    }
  });

  it("accepts frozen input and returns fresh detached output", () => {
    const frozen = deepFreeze(structuredClone(makeEnvelope()));
    const first = migrateEnvelope(frozen);
    const second = migrateEnvelope(structuredClone(frozen));

    expect(first).toEqual(second);
    if (first.ok) {
      expect(first.envelope).toEqual(makeEnvelope());
      expect(first.envelope.projects.p1).not.toBe(
        second.ok ? second.envelope.projects.p1 : undefined,
      );
    }
  });
});
