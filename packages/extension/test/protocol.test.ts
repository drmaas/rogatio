import { describe, expect, it } from "vitest";
import { parseRequest } from "../src/protocol.js";

describe("F7 message protocol", () => {
  it("accepts the versioned refresh request", () => {
    expect(parseRequest({ version: 1, command: "refresh" })).toEqual({
      ok: true,
      value: { version: 1, command: "refresh" },
    });
  });

  it("rejects unknown versions and commands", () => {
    expect(parseRequest({ version: 2, command: "refresh" })).toMatchObject({
      ok: false,
      code: "extension.invalid-message",
    });
    expect(parseRequest({ version: 1, command: "execute-code" })).toMatchObject(
      {
        ok: false,
        code: "extension.invalid-message",
      },
    );
  });

  it("rejects cycles without invoking arbitrary properties", () => {
    const value: Record<string, unknown> = { version: 1, command: "refresh" };
    value.self = value;

    expect(parseRequest(value)).toMatchObject({
      ok: false,
      code: "extension.invalid-message",
    });
  });

  it("preserves hostile proto keys as data without changing the result prototype", () => {
    const value: Record<string, unknown> = { version: 1, command: "refresh" };
    Object.defineProperty(value, "__proto__", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { polluted: true },
    });

    const result = parseRequest(value);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(Object.hasOwn(result.value, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(result.value)).toBeNull();
    }
  });
});
