import { describe, expect, it } from "vitest";
import { stripReservedMarkers } from "../src/proxy.js";

describe("stripReservedMarkers (session proxy path)", () => {
  it("removes X-Rogatio-Dispatch-* headers including BodyMatch logging markers", () => {
    const stripped = stripReservedMarkers({
      host: "example.com",
      "content-type": "application/json",
      "X-Rogatio-Dispatch-BodyMatch": "3000001",
      "X-Rogatio-Dispatch-rule-1~abc": "unused",
      Authorization: "Bearer keep",
    });
    expect(stripped).toEqual({
      host: "example.com",
      "content-type": "application/json",
      Authorization: "Bearer keep",
    });
  });

  it("is case-sensitive on the reserved prefix (Chrome header names as set)", () => {
    const stripped = stripReservedMarkers({
      "x-rogatio-dispatch-bodymatch": "lower",
      "X-Rogatio-Dispatch-BodyMatch": "exact",
    });
    expect(stripped).toEqual({
      "x-rogatio-dispatch-bodymatch": "lower",
    });
  });
});
