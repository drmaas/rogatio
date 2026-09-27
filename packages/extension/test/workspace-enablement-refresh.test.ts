import { describe, expect, it } from "vitest";
import { shouldRemountEditorAfterGroupEnablement } from "../src/workspace-enablement-refresh.js";

describe("shouldRemountEditorAfterGroupEnablement", () => {
  it("keeps the editor mounted so the heading button and route survive", () => {
    expect(shouldRemountEditorAfterGroupEnablement()).toBe(false);
  });
});
