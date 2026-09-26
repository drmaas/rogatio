import { describe, expect, it } from "vitest";
import { authorizeExact, normalizeRuntimePreset } from "../src/index.js";
import {
  DEFAULT_REQUEST_URL,
  makeGrant,
  makeMatcher,
  makePresetInput,
} from "./helpers.js";

function makePolicy() {
  const result = normalizeRuntimePreset(makePresetInput());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a valid preset");
  return result.value;
}

describe("F6 exact authorization", () => {
  it("authorizes the complete exact grant tuple for a same-origin target", () => {
    const policy = makePolicy();
    const result = authorizeExact(policy, makeGrant(), DEFAULT_REQUEST_URL);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.groupId).toBe("group-main");
      expect(result.value.ruleId).toBe("rule-main");
      expect(result.value.operationId).toBe("operation-main");
      expect(result.value.target).toBe("https://example.com/data");
      expect(result.value.method).toBe("GET");
    }
  });

  it("denies every changed tuple member without fallback or wildcard behavior", () => {
    const policy = makePolicy();
    for (const change of [
      { groupId: "other-group" },
      { ruleId: "other-rule" },
      { operationId: "other-operation" },
      { kind: "confined-file", target: "approved.txt" },
      { target: "https://example.com/other" },
      { method: "HEAD" },
    ]) {
      const result = authorizeExact(
        policy,
        { ...makeGrant(), ...change },
        DEFAULT_REQUEST_URL,
      );
      expect(result).toEqual({
        ok: false,
        error: { code: "runtime.authorization-denied" },
      });
    }
  });

  it("denies a cross-origin target even when it would match the source regex", () => {
    const input = makePresetInput({
      matchers: [
        makeMatcher("rule-main", {
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/.*",
          },
        }),
      ],
    });
    const normalized = normalizeRuntimePreset(input);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const result = authorizeExact(
        normalized.value,
        makeGrant({ target: "https://evil.com/data" }),
        "https://example.com/page",
      );
      expect(result.ok).toBe(false);
    }
  });

  it("does not execute the F3 regex or invent priority precedence", () => {
    const input = makePresetInput({
      matchers: [
        makeMatcher("rule-main", {
          source: {
            key: "url",
            operator: "regex",
            value: "^never-matches$",
          },
          priority: 1000,
        }),
      ],
    });
    const normalized = normalizeRuntimePreset(input);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(
        authorizeExact(normalized.value, makeGrant(), DEFAULT_REQUEST_URL).ok,
      ).toBe(true);
    }
  });

  it("requires a concrete method and honors an explicitly narrowed omitted matcher method", () => {
    const input = makePresetInput({ matchers: [makeMatcher("rule-main")] });
    const normalized = normalizeRuntimePreset(input);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(
        authorizeExact(
          normalized.value,
          makeGrant({ method: "GET" }),
          DEFAULT_REQUEST_URL,
        ).ok,
      ).toBe(true);
      expect(
        authorizeExact(
          normalized.value,
          { ...makeGrant(), method: undefined },
          DEFAULT_REQUEST_URL,
        ),
      ).toEqual(
        expect.objectContaining({
          ok: false,
          error: { code: "runtime.authorization-denied" },
        }),
      );
    }
  });
});
