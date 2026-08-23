import type { RogatioProject, RogatioRule } from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import type {
  CoreResult,
  StorageAdapter,
  StoredEnvelope,
} from "../src/index.js";
import { ProjectRepository } from "../src/index.js";

function makeRule(
  index: number,
  overrides: Record<string, unknown> = {},
): RogatioRule & Record<string, unknown> {
  return {
    id: `rule-${index}`,
    name: `Rule ${index}`,
    urlRegex: "^https://example\\.com/",
    origins: [],
    resourceTypes: ["main_frame"],
    priority: 100 + index,
    ...overrides,
  } as RogatioRule & Record<string, unknown>;
}

function makeProject(
  name = "Project A",
  overrides: Record<string, unknown> = {},
): RogatioProject & Record<string, unknown> {
  return {
    version: 1,
    name,
    groups: [
      {
        id: "group-a",
        name: "Group A",
        origins: ["https://example.com"],
        rules: [makeRule(1)],
      },
    ],
    ...overrides,
  } as RogatioProject & Record<string, unknown>;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  )
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left as Record<string, unknown>).sort();
  const rightKeys = Object.keys(right as Record<string, unknown>).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      deepEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  );
}

class MemoryStorage implements StorageAdapter {
  private value: unknown;
  private tail: Promise<void> = Promise.resolve();

  constructor(initial?: unknown) {
    this.value = initial;
  }

  read(): Promise<unknown> {
    const run = this.tail.then(() =>
      this.value === undefined ? undefined : structuredClone(this.value),
    );
    return run;
  }

  compareAndSwap(previous: unknown, next: unknown): Promise<boolean> {
    const run = this.tail.then(() => {
      if (!deepEqual(this.value, previous)) return false;
      this.value = structuredClone(next);
      return true;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  valueOf(): unknown {
    return structuredClone(this.value);
  }
}

class FlakyStorage implements StorageAdapter {
  private failuresLeft: number;
  private value: unknown;

  constructor(initial: unknown | undefined, failures: number) {
    this.failuresLeft = failures;
    this.value = initial;
  }

  async read(): Promise<unknown> {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  async compareAndSwap(previous: unknown, next: unknown): Promise<boolean> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      return false;
    }
    if (!deepEqual(this.value, previous)) return false;
    this.value = structuredClone(next);
    return true;
  }
}

class RacingStorage implements StorageAdapter {
  private value: unknown;
  private casCalls = 0;
  private readonly raceOn: number;

  constructor(initial: unknown | undefined, raceOn: number) {
    this.value = initial;
    this.raceOn = raceOn;
  }

  async read(): Promise<unknown> {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  async compareAndSwap(previous: unknown, next: unknown): Promise<boolean> {
    this.casCalls += 1;
    if (this.casCalls === this.raceOn) {
      // Simulate a concurrent commit between read and compare-and-swap.
      const current = structuredClone(this.value) as StoredEnvelope;
      const project = current?.projects?.p1 as { revision: number } | undefined;
      if (project !== undefined) project.revision += 1;
      this.value = current;
      return false;
    }
    if (!deepEqual(this.value, previous)) return false;
    this.value = structuredClone(next);
    return true;
  }
}

function makeClock(): { now: () => number; advance: (delta?: number) => void } {
  let time = 1000;
  return {
    now: () => time,
    advance: (delta = 1) => {
      time += delta;
    },
  };
}

function expectFailure<T>(
  result: CoreResult<T>,
): asserts result is Extract<CoreResult<T>, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected operation to fail");
}

describe("ProjectRepository", () => {
  function makeRepository(storage: StorageAdapter): {
    repo: ProjectRepository;
    clock: { now: () => number; advance: (delta?: number) => void };
    ids: string[];
  } {
    const clock = makeClock();
    const ids: string[] = [];
    const repo = new ProjectRepository({
      storage,
      now: clock.now,
      generateId: () => {
        const id = ids.length === 0 ? "p1" : `p${ids.length + 1}`;
        ids.push(id);
        return id;
      },
    });
    return { repo, clock, ids };
  }

  it("creates a validated project with deterministic defaults", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    const result = await repo.createProject(makeProject());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: "p1",
        name: "Project A",
        revision: 1,
        createdAt: 1000,
        updatedAt: 1000,
        enabledGroupIds: [],
        grantedOrigins: [],
      });
      expect(result.value.data).toEqual(makeProject());
    }

    const state = await repo.state();
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.activeProjectId).toBe("p1");
      expect(Object.keys(state.value.projects)).toEqual(["p1"]);
    }
  });

  it("activates the first project and never auto-activates later ones", async () => {
    const storage = new MemoryStorage();
    const { repo, ids } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    await repo.createProject(makeProject("B"));
    expect(ids).toEqual(["p1", "p2"]);

    const state = await repo.state();
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value.activeProjectId).toBe("p1");
  });

  it("supports an explicit project id", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    const result = await repo.createProject(makeProject(), { id: "custom" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("custom");
  });

  it("rejects invalid project data without storing anything", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    const invalid = makeProject("Broken");
    delete (invalid as Record<string, unknown>).groups;
    const result = await repo.createProject(invalid);

    expectFailure(result);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.code).toBe("schema.required");
    const state = await repo.state();
    expect(state.ok).toBe(true);
    if (state.ok) expect(Object.keys(state.value.projects)).toEqual([]);
  });

  it("rejects hostile project data without throwing", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    const cyclic = makeProject("Cyclic") as unknown as Record<string, unknown>;
    cyclic.groups = cyclic;
    for (const value of [cyclic, null, 1, "project", [], {}]) {
      expect(() => repo.createProject(value)).not.toThrow();
      const result = await repo.createProject(value);
      expectFailure(result);
    }
    const state = await repo.state();
    expect(state.ok).toBe(true);
    if (state.ok) expect(Object.keys(state.value.projects)).toEqual([]);
  });

  it("enforces the 64-project cap and unique names", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    for (let index = 0; index < 64; index += 1) {
      const result = await repo.createProject(makeProject(`Name ${index}`));
      expect(result.ok).toBe(true);
    }
    const overLimit = await repo.createProject(makeProject("Name 64"));
    expectFailure(overLimit);
    expect(overLimit.diagnostics[0]?.code).toBe("core.project-limit");

    const duplicate = await repo.createProject(makeProject("Name 0"));
    expectFailure(duplicate);
    expect(duplicate.diagnostics[0]?.code).toBe("core.duplicate-name");
  });

  it("imports a new project when the name is absent and updates when present", async () => {
    const storage = new MemoryStorage();
    const { repo, clock } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    clock.advance();
    const imported = await repo.importProject(
      makeProject("A", { description: "v2" }),
    );

    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.value.id).toBe("p1");
      expect(imported.value.revision).toBe(2);
      expect(imported.value.updatedAt).toBe(1001);
      expect(imported.value.data).toMatchObject({ description: "v2" });
    }

    clock.advance();
    const fresh = await repo.importProject(makeProject("B"));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value.id).toBe("p2");
  });

  it("imports by explicit id even when the name differs", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    const result = await repo.importProject(makeProject("Renamed"), {
      id: "p1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("p1");
      expect(result.value.name).toBe("Renamed");
    }
  });

  it("resets enablement and prunes grants on data commits", async () => {
    const storage = new MemoryStorage();
    const { repo, clock } = makeRepository(storage);

    await repo.createProject(makeProject());
    await repo.setGroupEnabled("p1", "group-a", true);
    await repo.grantOrigin("p1", "https://example.com");

    clock.advance();
    const saved = await repo.saveProject(
      "p1",
      makeProject("A", {
        groups: [
          {
            id: "group-b",
            name: "Group B",
            origins: ["https://other.example"],
            rules: [makeRule(2)],
          },
        ],
      }),
      3,
    );

    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.revision).toBe(4);
      expect(saved.value.enabledGroupIds).toEqual([]);
      expect(saved.value.grantedOrigins).toEqual([]);
    }
  });

  it("preserves grants that remain declared after a data commit", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject());
    await repo.grantOrigin("p1", "https://example.com");
    const saved = await repo.saveProject("p1", makeProject("A"), 2);

    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.grantedOrigins).toEqual(["https://example.com"]);
      expect(saved.value.enabledGroupIds).toEqual([]);
    }
  });

  it("reports a conflict on stale save revisions and preserves committed state", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    await repo.setGroupEnabled("p1", "group-a", true);
    const committed = await repo.getProject("p1");

    const stale = await repo.saveProject(
      "p1",
      makeProject("A", { description: "stale" }),
      1,
    );

    expectFailure(stale);
    expect(stale.kind).toBe("conflict");
    if (stale.kind === "conflict") {
      expect(stale.current).toEqual(committed.ok ? committed.value : undefined);
    }
    expect(stale.diagnostics[0]?.code).toBe("core.conflict");

    const after = await repo.getProject("p1");
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.revision).toBe(2);
      expect(after.value.enabledGroupIds).toEqual(["group-a"]);
    }
  });

  it("fails save and switch for unknown projects", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    const save = await repo.saveProject("missing", makeProject(), 1);
    expectFailure(save);
    expect(save.diagnostics[0]?.code).toBe("core.not-found");

    const switched = await repo.switchProject("missing");
    expectFailure(switched);
    expect(switched.diagnostics[0]?.code).toBe("core.not-found");
  });

  it("switches the active project without touching enablement or grants", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    await repo.createProject(makeProject("B"));
    await repo.setGroupEnabled("p2", "group-a", true);
    await repo.grantOrigin("p2", "https://example.com");

    const result = await repo.switchProject("p2");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeProjectId).toBe("p2");

    const switched = await repo.getProject("p2");
    expect(switched.ok).toBe(true);
    if (switched.ok) {
      expect(switched.value.enabledGroupIds).toEqual(["group-a"]);
      expect(switched.value.grantedOrigins).toEqual(["https://example.com"]);
    }
  });

  it("removes projects and re-establishes the single-active invariant", async () => {
    const storage = new MemoryStorage();
    const { repo, clock } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    await repo.createProject(makeProject("B"));
    await repo.switchProject("p2");
    clock.advance();
    await repo.setGroupEnabled("p2", "group-a", true);

    const removedNonActive = await repo.removeProject("p1");
    expect(removedNonActive.ok).toBe(true);
    if (removedNonActive.ok)
      expect(removedNonActive.value.activeProjectId).toBe("p2");

    const removedActive = await repo.removeProject("p2");
    expect(removedActive.ok).toBe(true);
    if (removedActive.ok) {
      expect(removedActive.value.activeProjectId).toBeNull();
      expect(Object.keys(removedActive.value.projects)).toEqual([]);
    }
  });

  it("chooses the most recently updated remaining project after active removal", async () => {
    const storage = new MemoryStorage();
    const { repo, clock } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    await repo.createProject(makeProject("B"));
    await repo.switchProject("p1");
    clock.advance();
    await repo.setGroupEnabled("p2", "group-a", true);

    const result = await repo.removeProject("p1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeProjectId).toBe("p2");
  });

  it("ties active replacement on lexicographically smallest id", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"), { id: "zeta" });
    await repo.createProject(makeProject("B"), { id: "alpha" });
    await repo.switchProject("zeta");

    const result = await repo.removeProject("zeta");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeProjectId).toBe("alpha");
  });

  it("toggles saved group enablement and rejects unknown groups", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject());
    const enabled = await repo.setGroupEnabled("p1", "group-a", true);
    expect(enabled.ok).toBe(true);
    if (enabled.ok) {
      expect(enabled.value.enabledGroupIds).toEqual(["group-a"]);
      expect(enabled.value.revision).toBe(2);
    }

    const disabled = await repo.setGroupEnabled("p1", "group-a", false);
    expect(disabled.ok).toBe(true);
    if (disabled.ok) expect(disabled.value.enabledGroupIds).toEqual([]);

    const unknown = await repo.setGroupEnabled("p1", "nope", true);
    expectFailure(unknown);
    expect(unknown.diagnostics[0]?.code).toBe("core.not-found");
  });

  it("grants only declared origins and normalizes them", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject());
    const granted = await repo.grantOrigin("p1", "HTTPS://Example.COM:443/");
    expect(granted.ok).toBe(true);
    if (granted.ok) {
      expect(granted.value.grantedOrigins).toEqual(["https://example.com"]);
    }

    const duplicate = await repo.grantOrigin("p1", "https://example.com");
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) {
      expect(duplicate.value.grantedOrigins).toEqual(["https://example.com"]);
    }

    const undeclared = await repo.grantOrigin(
      "p1",
      "https://elsewhere.example",
    );
    expectFailure(undeclared);
    expect(undeclared.diagnostics[0]?.code).toBe("core.permission-undeclared");

    const invalid = await repo.grantOrigin("p1", "not an origin");
    expectFailure(invalid);
    expect(invalid.diagnostics[0]?.code).toBe("core.invalid-origin");
  });

  it("revokes grants idempotently", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject());
    await repo.grantOrigin("p1", "https://example.com");
    const revoked = await repo.revokeOrigin("p1", "https://example.com");
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.value.grantedOrigins).toEqual([]);

    const again = await repo.revokeOrigin("p1", "https://example.com");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.grantedOrigins).toEqual([]);
  });

  it("exports detached project data", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject());
    const exported = await repo.exportProject("p1");
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      exported.value.name = "Mutated";
      (exported.value.groups[0] as unknown as Record<string, unknown>).origins =
        [];
    }

    const stored = await repo.exportProject("p1");
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.value.name).toBe("Project A");
      expect(stored.value.groups[0]?.origins).toEqual(["https://example.com"]);
    }
  });

  it("fails closed on corrupt storage without writing", async () => {
    const storage = new MemoryStorage({ broken: true });
    const { repo } = makeRepository(storage);

    const created = await repo.createProject(makeProject());
    expectFailure(created);
    expect(created.diagnostics[0]?.code).toBe("core.storage-corrupt");

    const state = await repo.state();
    expectFailure(state);
    expect(storage.valueOf()).toEqual({ broken: true });
  });

  it("fails closed on hostile stored envelopes without throwing", async () => {
    const cyclic = {} as Record<string, unknown>;
    cyclic.self = cyclic;
    const storage = new MemoryStorage(cyclic);
    const { repo } = makeRepository(storage);

    expect(() => repo.state()).not.toThrow();
    const state = await repo.state();
    expectFailure(state);
    expect(state.diagnostics[0]?.code).toBe("core.storage-corrupt");
  });

  it("retries transient compare-and-swap failures", async () => {
    const storage = new FlakyStorage(undefined, 2);
    const { repo } = makeRepository(storage);

    const result = await repo.createProject(makeProject("A"));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("p1");
  });

  it("reports a conflict when a strict import races a concurrent commit", async () => {
    const storage = new RacingStorage(undefined, 2);
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    const raced = await repo.importProject(
      makeProject("A", { description: "v2" }),
      { expectedRevision: 1 },
    );

    expectFailure(raced);
    expect(raced.kind).toBe("conflict");
    if (raced.kind === "conflict") {
      expect(raced.current.revision).toBe(2);
      expect(raced.current.data).not.toHaveProperty("description");
    }
    expect(raced.diagnostics[0]?.code).toBe("core.conflict");
  });

  it("retries a loose import across a concurrent commit", async () => {
    const storage = new RacingStorage(undefined, 2);
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    const raced = await repo.importProject(
      makeProject("A", { description: "v3" }),
    );

    expect(raced.ok).toBe(true);
    if (raced.ok) {
      expect(raced.value.revision).toBe(3);
      expect(raced.value.data).toMatchObject({ description: "v3" });
    }
  });

  it("reports a storage conflict when compare-and-swap never succeeds", async () => {
    const storage = new FlakyStorage(undefined, Number.POSITIVE_INFINITY);
    const { repo } = makeRepository(storage);

    const result = await repo.createProject(makeProject("A"));

    expectFailure(result);
    expect(result.diagnostics[0]?.code).toBe("core.storage-conflict");
    expect(result.kind).toBe("failure");
  });

  it("returns detached snapshots from getProject and state", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject());
    const first = await repo.getProject("p1");
    const second = await repo.getProject("p1");
    expect(first.ok).toBe(true);
    if (first.ok) {
      (first.value as { name: string }).name = "Mutated";
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.name).toBe("Project A");
        expect(first.value).not.toBe(second.value);
      }
    }

    const state1 = await repo.state();
    const state2 = await repo.state();
    expect(state1.ok).toBe(true);
    if (state1.ok) {
      expect(state1.value).not.toBe(state2.ok ? state2.value : undefined);
      expect(state1.value.projects.p1).not.toBe(
        state2.ok ? state2.value.projects.p1 : undefined,
      );
    }
  });

  it("persists the envelope through the storage adapter", async () => {
    const storage = new MemoryStorage();
    const { repo } = makeRepository(storage);

    await repo.createProject(makeProject("A"));
    await repo.createProject(makeProject("B"));
    await repo.switchProject("p2");
    const raw = storage.valueOf() as StoredEnvelope;

    expect(raw.version).toBe(1);
    expect(Object.keys(raw.projects)).toEqual(["p1", "p2"]);
    expect(raw.activeProjectId).toBe("p2");
  });
});
