import { describe, expect, it } from "vitest";
import { MOCK_LISTENER_PREFIX } from "../src/mock-listener.js";

describe("mock listener prefix", () => {
  it("matches the runtime route", () => {
    expect(MOCK_LISTENER_PREFIX).toBe("/.rogatio/mock/");
  });
});
