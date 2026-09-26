import { describe, expect, it } from "vitest";
import {
  countUrlCapturingGroups,
  migrateV1Project,
  regexProvenInsideOrigins,
} from "../src/index.js";

const v1Base = {
  version: 1 as const,
  name: "Migrate me",
  groups: [
    {
      id: "g1",
      name: "G1",
      origins: ["https://example.com"],
      rules: [
        {
          id: "r1",
          name: "R1",
          urlRegex: "^https://example\\.com/old/(.*)$",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 100,
          type: "redirect",
          redirect: { destination: "https://example.com/new/\\1" },
        },
      ],
    },
  ],
};

describe("migrateV1Project", () => {
  it("byte-preserves urlRegex as source.value and drops origins", () => {
    const result = migrateV1Project(v1Base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.version).toBe(2);
    const rule = result.project.groups[0]?.rules[0];
    expect(rule?.source).toEqual({
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/old/(.*)$",
    });
    expect(rule).not.toHaveProperty("origins");
    expect(rule).not.toHaveProperty("urlRegex");
    expect(result.project.groups[0]).not.toHaveProperty("origins");
    expect(countUrlCapturingGroups(rule?.source.value ?? "")).toBe(1);
    expect(
      result.notices.some((n) => n.code === "migration.initiator-policy"),
    ).toBe(true);
    // Anchored literal host inside old origins → no widen notice for the rule.
    expect(
      result.notices.some((n) => n.code === "migration.possible-scope-widen"),
    ).toBe(false);
  });

  it("warns when the regex cannot be proven inside old origins", () => {
    const wide = structuredClone(v1Base);
    wide.groups[0].rules[0].urlRegex = ".*";
    const result = migrateV1Project(wide);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.notices.some(
        (n) =>
          n.code === "migration.possible-scope-widen" &&
          n.path === "/groups/0/rules/0",
      ),
    ).toBe(true);
  });

  it("never synthesizes key host", () => {
    const result = migrateV1Project(v1Base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.groups[0]?.rules[0]?.source.key).toBe("url");
  });

  it("preserves invalid regex bytes and warns", () => {
    const broken = structuredClone(v1Base);
    broken.groups[0].rules[0].urlRegex = "(";
    const result = migrateV1Project(broken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.groups[0]?.rules[0]?.source.value).toBe("(");
    expect(
      result.notices.filter(
        (notice) => notice.code === "migration.initiator-policy",
      ),
    ).toHaveLength(1);
  });

  it("warns for both schemes unless both origins are in the old set", () => {
    const dual = structuredClone(v1Base);
    dual.groups[0].rules[0].urlRegex = "^https?://example\\.com/";
    const missingHttp = migrateV1Project(dual);
    expect(missingHttp.ok).toBe(true);
    if (!missingHttp.ok) return;
    expect(
      missingHttp.notices.some(
        (notice) => notice.code === "migration.possible-scope-widen",
      ),
    ).toBe(true);

    dual.groups[0].origins = ["https://example.com", "http://example.com"];
    const both = migrateV1Project(dual);
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(
      both.notices.some(
        (notice) => notice.code === "migration.possible-scope-widen",
      ),
    ).toBe(false);
  });

  it("does not treat a non-default port as the default origin", () => {
    const ported = structuredClone(v1Base);
    ported.groups[0].rules[0].urlRegex = "^https://example\\.com:8080/";
    const result = migrateV1Project(ported);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.notices.some(
        (notice) => notice.code === "migration.possible-scope-widen",
      ),
    ).toBe(true);
  });

  it("sorts widening notices by group then rule and emits initiator once", () => {
    const project = structuredClone(v1Base);
    project.groups.push({
      id: "g2",
      name: "G2",
      origins: [],
      rules: [
        {
          id: "r2",
          name: "R2",
          urlRegex: ".*",
          origins: [],
          resourceTypes: ["main_frame"],
          priority: 1,
          type: "redirect",
          redirect: { destination: "https://example.com/" },
        },
      ],
    });
    project.groups[0].rules[0].urlRegex = ".*";
    const result = migrateV1Project(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const widen = result.notices.filter(
      (notice) => notice.code === "migration.possible-scope-widen",
    );
    expect(widen.map((notice) => notice.path)).toEqual([
      "/groups/0/rules/0",
      "/groups/1/rules/0",
    ]);
    expect(result.notices.at(-1)?.code).toBe("migration.initiator-policy");
  });

  it("rejects adversarial and non-v1 input", () => {
    expect(migrateV1Project(null).ok).toBe(false);
    expect(migrateV1Project({ version: 2, name: "x", groups: [] }).ok).toBe(
      false,
    );
    const proto = Object.create({ version: 1, name: "x", groups: [] });
    expect(migrateV1Project(proto).ok).toBe(false);
    const sparse = {
      version: 1,
      name: "x",
      groups: [],
    };
    sparse.groups.length = 1;
    expect(migrateV1Project(sparse).ok).toBe(false);

    const cyclic: { version: number; name: string; groups: unknown[] } = {
      version: 1,
      name: "x",
      groups: [],
    };
    cyclic.groups.push(cyclic);
    expect(migrateV1Project(cyclic).ok).toBe(false);

    let getterRead = false;
    const accessor = {
      version: 1,
      name: "x",
      groups: [
        {
          id: "g",
          name: "G",
          origins: ["https://example.com"],
          rules: [
            {
              id: "r",
              name: "R",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 1,
            },
          ],
        },
      ],
    };
    Object.defineProperty(accessor.groups[0].rules[0], "urlRegex", {
      enumerable: true,
      get() {
        getterRead = true;
        throw new Error("accessor-secret");
      },
    });
    const accessorResult = migrateV1Project(accessor);
    expect(accessorResult.ok).toBe(false);
    if (!accessorResult.ok) {
      expect(accessorResult.error).toBe("migration.invalid-input");
      expect(accessorResult.error).not.toContain("accessor-secret");
    }
    expect(getterRead).toBe(false);

    expect(
      migrateV1Project({
        version: 1,
        name: "x",
        groups: [
          {
            id: "g",
            name: "G",
            origins: ["https://example.com"],
            rules: [
              {
                id: "r",
                name: "R",
                urlRegex: 1,
                origins: [],
                resourceTypes: ["main_frame"],
                priority: 1,
              },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe("regexProvenInsideOrigins", () => {
  it("accepts anchored literal hosts present in the set", () => {
    expect(
      regexProvenInsideOrigins(
        "^https://example\\.com/path",
        new Set(["https://example.com"]),
      ),
    ).toBe(true);
    expect(
      regexProvenInsideOrigins(".*", new Set(["https://example.com"])),
    ).toBe(false);
    expect(regexProvenInsideOrigins("^https://example\\.com/", new Set())).toBe(
      false,
    );
    expect(
      regexProvenInsideOrigins(
        "^https://example\\.com",
        new Set(["https://example.com"]),
      ),
    ).toBe(false);
    expect(
      regexProvenInsideOrigins(
        "^https://example\\.com:8080/",
        new Set(["https://example.com"]),
      ),
    ).toBe(false);
    expect(
      regexProvenInsideOrigins(
        "^https://example\\.com:8080/",
        new Set(["https://example.com:8080"]),
      ),
    ).toBe(true);
    expect(
      regexProvenInsideOrigins(
        "^https?://example\\.com/",
        new Set(["https://example.com"]),
      ),
    ).toBe(false);
    expect(
      regexProvenInsideOrigins(
        "^https?://example\\.com/",
        new Set(["https://example.com", "http://example.com"]),
      ),
    ).toBe(true);
  });
});
