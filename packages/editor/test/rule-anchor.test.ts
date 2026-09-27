import { describe, expect, it } from "vitest";
import { ruleAnchorId } from "../src/index.js";

/**
 * The rule anchor id is a DOM identity derived from two ids that arrive from
 * committed storage on one side and a validated draft on the other. It has to
 * be injective, or `getElementById` resolves to the wrong rule and a rule link
 * silently scrolls somewhere else.
 */
describe("ruleAnchorId", () => {
  it("keeps the group and rule boundary unambiguous", () => {
    // The collision the old `rogatio-rule-${group}-${rule}` format could not
    // avoid: these two pairs produced the same element id.
    expect(ruleAnchorId("a-b", "c")).not.toBe(ruleAnchorId("a", "b-c"));
    expect(ruleAnchorId("a-b-c", "d")).not.toBe(ruleAnchorId("a-b", "c-d"));
    expect(ruleAnchorId("a", "b")).not.toBe(ruleAnchorId("a-b", ""));
    expect(ruleAnchorId("ab", "c")).not.toBe(ruleAnchorId("a", "bc"));
  });

  it("separates the segments with a character a schema-legal id cannot contain", () => {
    // Schema id pattern is ^[A-Za-z0-9][A-Za-z0-9._-]*$, so a colon in the joined
    // anchor can only be the separator and never part of an id.
    expect(ruleAnchorId("a", "b")).toBe("rogatio-rule-a:b");
    expect(ruleAnchorId("a.b", "c-d")).toBe("rogatio-rule-a.b:c-d");
  });

  it("stays distinct for untrusted ids that break naive joins", () => {
    const hostile = [
      "a:b",
      "a%3Ab",
      "rogatio-rule-a:b",
      " with space ",
      "../escape",
      "a\nb",
      "a?b",
      "a#b",
      // Non-ASCII and a NUL, which is legal in a JS string and illegal in a
      // source file, so it is written as an escape.
      "é",
      "\0",
      "",
    ];
    const ids = new Set<string>();
    for (const groupId of hostile) {
      for (const ruleId of hostile) {
        ids.add(ruleAnchorId(groupId, ruleId));
      }
    }
    // 12 x 12 pairs must all collapse to distinct anchors.
    expect(ids.size).toBe(hostile.length * hostile.length);
  });

  it("does not produce a selector-breaking id for hostile input", () => {
    for (const value of ["a b", "a.b", "a:b", "a#b", 'a"b', "a'b", "a[b]"]) {
      const id = ruleAnchorId(value, value);
      // No whitespace, and no CSS metacharacter that would break a
      // querySelector on the id.
      expect(id).not.toMatch(/\s/);
      expect(id).toMatch(/^[\w%:.~-]+$/);
    }
  });

  it("never returns an empty anchor or collides with the prefix alone", () => {
    expect(ruleAnchorId("", "")).toBe("rogatio-rule-:");
    expect(ruleAnchorId("", "")).not.toBe("rogatio-rule");
  });

  it("handles ids at the schema length limit without truncation collisions", () => {
    const long = "a".repeat(64);
    expect(ruleAnchorId(long, long)).not.toBe(ruleAnchorId(`${long}a`, long));
  });
});
