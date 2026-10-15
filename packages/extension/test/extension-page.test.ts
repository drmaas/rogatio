import { describe, expect, it, vi } from "vitest";
import {
  createExtensionPageModel,
  isManagementTab,
  MANAGEMENT_TABS,
} from "../src/extension-page.js";

describe("management page destinations", () => {
  it("puts Console last in the top bar", () => {
    expect(MANAGEMENT_TABS.map(([tab, label]) => [tab, label])).toEqual([
      ["dashboard", "Dashboard"],
      ["workspace", "Workspace"],
      ["history", "Match history"],
      ["console", "Console"],
    ]);
    expect(MANAGEMENT_TABS.at(-1)?.[0]).toBe("console");
    expect(isManagementTab("console")).toBe(true);
    expect(isManagementTab("test")).toBe(false);
    expect(isManagementTab(undefined)).toBe(false);
  });
});

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
