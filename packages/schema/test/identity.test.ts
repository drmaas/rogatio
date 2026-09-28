import { describe, expect, it } from "vitest";
import {
  deriveEntityId,
  LIMITS,
  normalizeNameKey,
  uniqueName,
} from "../src/index.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function expectValidId(id: string): void {
  expect(ID_PATTERN.test(id)).toBe(true);
  expect(id.length).toBeLessThanOrEqual(LIMITS.maxIdLength);
  expect(id.length).toBeGreaterThan(0);
}

describe("normalizeNameKey", () => {
  it("trims, collapses internal whitespace, and lowercases", () => {
    expect(normalizeNameKey("  Ads   Blocker  ")).toBe("ads blocker");
  });

  it("treats case-only and spacing-only differences as the same name", () => {
    expect(normalizeNameKey("Ads Blocker")).toBe(
      normalizeNameKey("ads  blocker"),
    );
    expect(normalizeNameKey("ADS BLOCKER")).toBe(
      normalizeNameKey("ads blocker"),
    );
  });

  it("collapses tabs and newlines the same as spaces", () => {
    expect(normalizeNameKey("ads\t\nblocker")).toBe("ads blocker");
  });

  it("keeps non-ASCII letters, because only whitespace is collapsed", () => {
    expect(normalizeNameKey("Café Blöck")).toBe("café blöck");
  });

  it("is total for empty and whitespace-only input", () => {
    expect(normalizeNameKey("")).toBe("");
    expect(normalizeNameKey("   ")).toBe("");
  });
});

describe("deriveEntityId", () => {
  it("pascal-cases a lower-cased name", () => {
    expect(deriveEntityId("ads blocker", "rule", new Set())).toBe("AdsBlocker");
    expect(deriveEntityId("Block Analytics Scripts", "group", new Set())).toBe(
      "BlockAnalyticsScripts",
    );
  });

  it("splits on every run of non-alphanumeric characters", () => {
    expect(deriveEntityId("ads--blocker__v2", "rule", new Set())).toBe(
      "AdsBlockerV2",
    );
    expect(deriveEntityId("  spaced   out  ", "rule", new Set())).toBe(
      "SpacedOut",
    );
  });

  it("is case-insensitive, because it lower-cases first", () => {
    expect(deriveEntityId("ADS BLOCKER", "rule", new Set())).toBe("AdsBlocker");
  });

  it("leaves an already single token capitalized once", () => {
    expect(deriveEntityId("ads", "rule", new Set())).toBe("Ads");
  });

  it("falls back to the kind when the name yields no tokens", () => {
    expect(deriveEntityId("🎉 🎉", "group", new Set())).toBe("Group");
    expect(deriveEntityId("🎉 🎉", "rule", new Set())).toBe("Rule");
    expect(deriveEntityId("---", "rule", new Set())).toBe("Rule");
    expect(deriveEntityId("   ", "group", new Set())).toBe("Group");
  });

  it("appends an incrementing integer on collision", () => {
    const reserved = new Set<string>();
    expect(deriveEntityId("ads blocker", "rule", reserved)).toBe("AdsBlocker");
    expect(deriveEntityId("ads blocker", "rule", reserved)).toBe("AdsBlocker2");
    expect(deriveEntityId("ads blocker", "rule", reserved)).toBe("AdsBlocker3");
  });

  it("appends an integer to the fallback id as well", () => {
    const reserved = new Set<string>();
    expect(deriveEntityId("🎉", "group", reserved)).toBe("Group");
    expect(deriveEntityId("✨", "group", reserved)).toBe("Group2");
  });

  it("keeps distinct names that reduce to one token sequence distinct", () => {
    const reserved = new Set<string>();
    expect(deriveEntityId("ads-blocker", "rule", reserved)).toBe("AdsBlocker");
    expect(deriveEntityId("Ads Blocker", "rule", reserved)).toBe("AdsBlocker2");
  });

  it("truncates so the id and its suffix both fit the bound", () => {
    const name = "a".repeat(200);
    const reserved = new Set<string>();
    const first = deriveEntityId(name, "rule", reserved);
    expectValidId(first);
    expect(first).toHaveLength(LIMITS.maxIdLength);

    // A second colliding id must also fit, suffix included.
    reserved.add(first);
    const second = deriveEntityId(name, "rule", reserved);
    expectValidId(second);
    expect(second).toHaveLength(LIMITS.maxIdLength);
    expect(second).not.toBe(first);
  });

  it("permits a leading digit, which the id pattern allows", () => {
    const id = deriveEntityId("123 ads", "rule", new Set());
    expect(id).toBe("123Ads");
    expectValidId(id);
  });

  it("keeps a name that already ends in digits intact", () => {
    expect(deriveEntityId("new rule", "rule", new Set())).toBe("NewRule");
    expect(deriveEntityId("rule 2", "rule", new Set())).toBe("Rule2");
  });

  it("drops non-ASCII letters from the id rather than emitting them", () => {
    const id = deriveEntityId("Café", "rule", new Set());
    expectValidId(id);
    expect(id).toBe("Caf");
  });

  it("reserves what it returns", () => {
    const reserved = new Set<string>();
    const id = deriveEntityId("ads blocker", "rule", reserved);
    expect(reserved.has(id)).toBe(true);
  });

  it("is pure with respect to its inputs", () => {
    const name = "ads blocker";
    const a = deriveEntityId(name, "rule", new Set<string>());
    const b = deriveEntityId(name, "rule", new Set<string>());
    expect(a).toBe(b);
  });

  it("tolerates a non-string name without throwing", () => {
    expect(deriveEntityId(undefined, "rule", new Set())).toBe("Rule");
    expect(deriveEntityId(null, "group", new Set())).toBe("Group");
    expect(deriveEntityId(42, "group", new Set())).toBe("Group");
    expect(deriveEntityId({}, "group", new Set())).toBe("Group");
  });
});

describe("uniqueName", () => {
  it("returns the base name when it is free", () => {
    const reserved = new Set<string>();
    expect(uniqueName("New rule", reserved)).toBe("New rule");
  });

  it("appends an incrementing integer, comparing case- and space-insensitively", () => {
    const reserved = new Set<string>();
    expect(uniqueName("New rule", reserved)).toBe("New rule");
    expect(uniqueName("New rule", reserved)).toBe("New rule 2");
    // The base is returned as handed in; only the comparison is normalized, so
    // the function never has to remember an earlier spelling.
    expect(uniqueName("new  RULE", reserved)).toBe("new  RULE 3");
  });

  it("keeps the base label readable rather than mangling it", () => {
    const reserved = new Set<string>();
    reserved.add(normalizeNameKey("Ads blocker"));
    expect(uniqueName("Ads blocker", reserved)).toBe("Ads blocker 2");
  });

  it("reserves what it returns under its normalized key", () => {
    const reserved = new Set<string>();
    uniqueName("New rule", reserved);
    expect(reserved.has(normalizeNameKey("New rule"))).toBe(true);
  });

  it("stays within the label bound", () => {
    const reserved = new Set<string>();
    const base = "a".repeat(LIMITS.maxLabelLength);
    const first = uniqueName(base, reserved);
    const second = uniqueName(base, reserved);
    expect(first.length).toBeLessThanOrEqual(LIMITS.maxLabelLength);
    expect(second.length).toBeLessThanOrEqual(LIMITS.maxLabelLength);
    expect(second).not.toBe(first);
    expect(normalizeNameKey(second)).not.toBe(normalizeNameKey(first));
  });
});
