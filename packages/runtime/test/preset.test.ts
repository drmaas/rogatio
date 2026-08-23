import { describe, expect, it } from "vitest";
import {
  normalizeRuntimePreset,
  RUNTIME_LIMITS,
  type RuntimePresetV1,
} from "../src/index.js";
import {
  cloneLimits,
  makeGrant,
  makeMatcher,
  makePresetInput,
} from "./helpers.js";

function expectInvalid(value: unknown) {
  const result = normalizeRuntimePreset(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected an invalid preset");
  expect(result.error.code).toBe("runtime.invalid-preset");
  return result.error;
}

describe("F6 runtime preset", () => {
  it("normalizes a detached immutable preset and computes a digest", () => {
    const input = makePresetInput();
    const result = normalizeRuntimePreset(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.value.canonicalBytes).toBeInstanceOf(Uint8Array);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.limits)).toBe(true);
      expect(Object.isFrozen(result.value.matchers)).toBe(true);
      expect(Object.isFrozen(result.value.grants)).toBe(true);
      expect(result.value.matchers).not.toBe(input.matchers);
      expect(result.value.grants).not.toBe(input.grants);
      expect(result.value.grants[0]).not.toBe(input.grants[0]);

      const mutableInput = input as unknown as {
        grants: Array<{ target: string }>;
      };
      mutableInput.grants[0].target = "https://changed.example/data";
      expect(result.value.grants[0]?.target).toBe("https://example.com/data");
    }
  });

  it("canonicalizes equivalent insertion and grant order identically", () => {
    const first = makePresetInput({
      grants: [
        makeGrant({ operationId: "operation-z" }),
        makeGrant({ operationId: "operation-a" }),
      ],
      matchers: [
        makeMatcher("rule-main"),
        makeMatcher("rule-second", { origins: ["https://second.example"] }),
      ],
    });
    const second: RuntimePresetV1 = {
      grants: [
        {
          method: "GET",
          target: "https://example.com/data",
          kind: "outbound-http",
          operationId: "operation-a",
          ruleId: "rule-main",
          groupId: "group-main",
        },
        {
          method: "GET",
          target: "https://example.com/data",
          kind: "outbound-http",
          operationId: "operation-z",
          ruleId: "rule-main",
          groupId: "group-main",
        },
      ],
      matchers: [
        makeMatcher("rule-main"),
        makeMatcher("rule-second", { origins: ["https://second.example"] }),
      ],
      limits: cloneLimits(),
      version: 1,
    };

    const firstResult = normalizeRuntimePreset(first);
    const secondResult = normalizeRuntimePreset(second);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (firstResult.ok && secondResult.ok) {
      expect([...firstResult.value.canonicalBytes]).toEqual([
        ...secondResult.value.canonicalBytes,
      ]);
      expect(firstResult.value.digest).toBe(secondResult.value.digest);
    }
  });

  it("changes the digest when an authorized field changes", () => {
    const fields: RuntimePresetV1[] = [
      makePresetInput({
        grants: [makeGrant({ target: "https://example.com/other" })],
      }),
      makePresetInput({
        grants: [makeGrant({ operationId: "operation-other" })],
      }),
      makePresetInput({
        grants: [makeGrant({ method: "HEAD" })],
        matchers: [makeMatcher("rule-main", { method: "HEAD" })],
      }),
      makePresetInput({
        matchers: [makeMatcher("rule-main", { priority: 101 })],
      }),
      makePresetInput({
        grants: [makeGrant({ kind: "confined-file", target: "approved.txt" })],
      }),
    ];
    const base = normalizeRuntimePreset(makePresetInput());

    expect(base.ok).toBe(true);
    if (base.ok) {
      for (const field of fields) {
        const changed = normalizeRuntimePreset(field);
        expect(changed.ok).toBe(true);
        if (changed.ok)
          expect(changed.value.digest).not.toBe(base.value.digest);
      }
    }
  });

  it("does not include secrets, timestamps, or filesystem roots in digest bytes", () => {
    const result = normalizeRuntimePreset(makePresetInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      const canonical = new TextDecoder().decode(result.value.canonicalBytes);
      expect(canonical).not.toContain("capability");
      expect(canonical).not.toContain("/private/root");
      expect(canonical).not.toContain("timestamp");
      // sessionLifetimeMs is a limit field name, not a secret value
    }
  });

  it("rejects mismatched matcher identity, method, origin, and operation kind", () => {
    expectInvalid(
      makePresetInput({
        grants: [makeGrant({ ruleId: "missing-rule" })],
      }),
    );
    expectInvalid(
      makePresetInput({
        matchers: [makeMatcher("rule-main", { method: "GET" })],
        grants: [makeGrant({ method: "HEAD" })],
      }),
    );
    expectInvalid(
      makePresetInput({
        grants: [makeGrant({ target: "https://other.example/data" })],
      }),
    );
    expectInvalid(
      makePresetInput({
        grants: [makeGrant({ kind: "confined-file", target: "../secret" })],
      }),
    );
    expectInvalid(
      makePresetInput({
        grants: [makeGrant({ method: "POST" })],
      }),
    );
  });

  it("rejects malformed URLs and logical paths before any I/O", () => {
    for (const target of [
      "http://example.com/data",
      "https://user:pass@example.com/data",
      "https://example.com/data#fragment",
      "https://example.com\\data",
      "https://example.com:8443/data",
      "https://example.com/%",
    ]) {
      expectInvalid(makePresetInput({ grants: [makeGrant({ target })] }));
    }

    for (const target of ["", "../secret", "/absolute", "dir\\file", "a%2fb"]) {
      expectInvalid(
        makePresetInput({
          grants: [makeGrant({ kind: "confined-file", target })],
        }),
      );
    }
  });

  it("rejects hostile object shapes without invoking accessors", () => {
    const accessor = makePresetInput() as unknown as Record<string, unknown>;
    let read = false;
    Object.defineProperty(accessor, "version", {
      enumerable: true,
      get: () => {
        read = true;
        return 1;
      },
    });
    expectInvalid(accessor);
    expect(read).toBe(false);

    const cyclic = makePresetInput() as unknown as Record<string, unknown>;
    cyclic.cycle = cyclic;
    expectInvalid(cyclic);

    const sparse = [] as unknown[];
    sparse.length = 1;
    expectInvalid({ ...makePresetInput(), matchers: sparse });

    const symbols = makePresetInput();
    Object.defineProperty(symbols, Symbol("secret"), { value: true });
    expectInvalid(symbols);

    const proxy = new Proxy(makePresetInput(), {
      getOwnPropertyDescriptor() {
        throw new Error("proxy trap must not escape");
      },
    });
    expectInvalid(proxy);
  });

  it("rejects unknown fields, wrong version, and an oversized canonical preset", () => {
    expectInvalid({ ...makePresetInput(), version: 2 });
    expectInvalid({ ...makePresetInput(), unexpected: true });
    expectInvalid({
      ...makePresetInput(),
      grants: [
        makeGrant({ target: `https://example.com/${"a".repeat(300_000)}` }),
      ],
    });
  });

  it("exports frozen resource limits", () => {
    expect(Object.isFrozen(RUNTIME_LIMITS)).toBe(true);
    expect(RUNTIME_LIMITS.maxPresetBytes).toBe(262_144);
    expect(RUNTIME_LIMITS.maxRedirects).toBe(0);
  });
});
