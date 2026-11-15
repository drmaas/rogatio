import { describe, expect, it } from "vitest";
import {
  INTERCEPT_PROXY_LOOPBACK_NAMES,
  isAllowedLoopbackHost,
} from "../src/loopback-host.js";

const EDITOR_NAMES = ["127.0.0.1", "localhost"] as const;
const PORT = 34567;

describe("isAllowedLoopbackHost", () => {
  it("accepts the editor names with the bound port", () => {
    expect(isAllowedLoopbackHost(`127.0.0.1:${PORT}`, PORT, EDITOR_NAMES)).toBe(
      true,
    );
    expect(isAllowedLoopbackHost(`localhost:${PORT}`, PORT, EDITOR_NAMES)).toBe(
      true,
    );
  });

  it("accepts bracketed ::1 only when that name is listed", () => {
    expect(isAllowedLoopbackHost(`[::1]:${PORT}`, PORT, EDITOR_NAMES)).toBe(
      false,
    );
    expect(
      isAllowedLoopbackHost(
        `[::1]:${PORT}`,
        PORT,
        INTERCEPT_PROXY_LOOPBACK_NAMES,
      ),
    ).toBe(true);
  });

  it("rejects a foreign host, the wrong port, and a missing host", () => {
    expect(
      isAllowedLoopbackHost(`evil.example:${PORT}`, PORT, EDITOR_NAMES),
    ).toBe(false);
    expect(isAllowedLoopbackHost("127.0.0.1:80", PORT, EDITOR_NAMES)).toBe(
      false,
    );
    expect(isAllowedLoopbackHost("127.0.0.1", PORT, EDITOR_NAMES)).toBe(false);
    expect(isAllowedLoopbackHost(undefined, PORT, EDITOR_NAMES)).toBe(false);
    expect(isAllowedLoopbackHost(`127.0.0.1:${PORT}`, 0, EDITOR_NAMES)).toBe(
      false,
    );
    expect(isAllowedLoopbackHost(`127.0.0.1:${PORT}`, 1.5, EDITOR_NAMES)).toBe(
      false,
    );
  });
});
