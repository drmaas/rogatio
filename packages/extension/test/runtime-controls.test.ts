import { describe, expect, it } from "vitest";
import { runtimeControlDisabled } from "../src/runtime-controls.js";

describe("runtimeControlDisabled", () => {
  it("enables Start and disables Stop when phase is undefined (defaults to stopped)", () => {
    expect(runtimeControlDisabled(undefined)).toEqual({
      start: false,
      stop: true,
    });
  });

  it("enables Start and disables Stop when stopped", () => {
    expect(runtimeControlDisabled("stopped")).toEqual({
      start: false,
      stop: true,
    });
  });

  it("disables Start and enables Stop when starting", () => {
    expect(runtimeControlDisabled("starting")).toEqual({
      start: true,
      stop: false,
    });
  });

  it("disables Start and enables Stop when started", () => {
    expect(runtimeControlDisabled("started")).toEqual({
      start: true,
      stop: false,
    });
  });

  it("enables Start and disables Stop when failed", () => {
    expect(runtimeControlDisabled("failed")).toEqual({
      start: false,
      stop: true,
    });
  });

  it("enables Start and disables Stop when unsupported", () => {
    expect(runtimeControlDisabled("unsupported")).toEqual({
      start: false,
      stop: true,
    });
  });

  it("enables Start and disables Stop when error", () => {
    expect(runtimeControlDisabled("error")).toEqual({
      start: false,
      stop: true,
    });
  });
});
