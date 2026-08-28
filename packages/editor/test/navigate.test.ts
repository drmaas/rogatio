import { describe, expect, it } from "vitest";
import { type ResolvedRoute, resolveGroupRoute } from "../src/editor.js";

describe("F21 editor deep-link route resolution", () => {
  it("routes to the group when the id exists in the project", () => {
    const resolved: ResolvedRoute = resolveGroupRoute(
      "group-2",
      new Set(["group-1", "group-2"]),
    );
    expect(resolved).toEqual({ kind: "group", groupId: "group-2" });
  });

  it("falls back to the project overview for an unknown or empty id", () => {
    expect(resolveGroupRoute("missing", new Set(["group-1"]))).toEqual({
      kind: "project",
    });
    expect(resolveGroupRoute(null, new Set(["group-1"]))).toEqual({
      kind: "project",
    });
    expect(resolveGroupRoute(undefined, new Set(["group-1"]))).toEqual({
      kind: "project",
    });
  });
});
