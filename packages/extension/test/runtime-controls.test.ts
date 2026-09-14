import { describe, expect, it } from "vitest";
import { runtimeControlDisabled } from "../src/runtime-controls.js";

describe("runtimeControlDisabled", () => {
  it("disables Stop when runtime is stopped or unknown", () => {
    expect(runtimeControlDisabled(undefined)).toEqual({
      start: false,
      stop: true,
    });
    expect(runtimeControlDisabled("stopped")).toEqual({
      start: false,
      stop: true,
    });
  });

  it("disables Start when runtime is starting or running", () => {
    expect(runtimeControlDisabled("starting")).toEqual({
      start: true,
      stop: false,
    });
    expect(runtimeControlDisabled("started")).toEqual({
      start: true,
      stop: false,
    });
  });

  it("keeps Start available after failure or unsupported phases", () => {
    expect(runtimeControlDisabled("failed")).toEqual({
      start: false,
      stop: true,
    });
    expect(runtimeControlDisabled("unsupported")).toEqual({
      start: false,
      stop: true,
    });
    expect(runtimeControlDisabled("error")).toEqual({
      start: false,
      stop: true,
    });
  });
});
