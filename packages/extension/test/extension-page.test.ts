import { describe, expect, it, vi } from "vitest";
import { createExtensionPageModel } from "../src/extension-page.js";

describe("F7 extension page model", () => {
  it("does not switch when only the pending selector changes", () => {
    const switchProject = vi.fn();
    const model = createExtensionPageModel({
      activeProjectId: "project-a",
      projectIds: ["project-a", "project-b"],
      switchProject,
    });

    model.select("project-b");

    expect(model.pendingProjectId()).toBe("project-b");
    expect(switchProject).not.toHaveBeenCalled();
    model.switch();
    expect(switchProject).toHaveBeenCalledWith("project-b");
  });
});
