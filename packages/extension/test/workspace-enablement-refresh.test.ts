import { describe, expect, it } from "vitest";
import { shouldRemountEditorAfterGroupEnablement } from "../src/workspace-enablement-refresh.js";

describe("shouldRemountEditorAfterGroupEnablement", () => {
  it("remounts when the editor has no unsaved draft", () => {
    expect(shouldRemountEditorAfterGroupEnablement(false)).toBe(true);
  });

  it("preserves the mounted editor when the draft is dirty", () => {
    expect(shouldRemountEditorAfterGroupEnablement(true)).toBe(false);
  });
});
