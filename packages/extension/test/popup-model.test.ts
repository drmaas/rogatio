import { describe, expect, it, vi } from "vitest";
import {
  aggregateGroupStatus,
  createPopupModel,
  groupUrl,
  MANAGEMENT_PAGE,
  type PopupEnvelope,
  type PopupRuleStatus,
} from "../src/popup-model.js";

function envelope(over: Partial<PopupEnvelope> = {}): PopupEnvelope {
  return {
    activeProjectId: "project-a",
    projects: {
      "project-a": {
        name: "Alpha",
        data: {
          groups: [
            { id: "g1", name: "First", rules: [{}, {}] },
            { id: "g2", name: "Second", rules: [] },
            { id: "g3", name: "Third", rules: [{}] },
          ],
        },
        enabledGroupIds: ["g1", "g3"],
      },
    },
    ruleStatuses: [],
    ...over,
  };
}

describe("F21 popup group status aggregation", () => {
  it("reports disabled for an unenabled group regardless of rule statuses", () => {
    const statuses: PopupRuleStatus[] = [
      { groupId: "g", ruleId: "r", status: "active" },
      { groupId: "g", ruleId: "r2", status: "error" },
    ];
    expect(aggregateGroupStatus(false, statuses)).toBe("disabled");
  });

  it("reports active for an enabled empty group", () => {
    expect(aggregateGroupStatus(true, [])).toBe("active");
  });

  it("applies precedence error > needs proxy > needs permission > unsupported > active", () => {
    const statuses: PopupRuleStatus[] = [
      { groupId: "g", ruleId: "r1", status: "active" },
      { groupId: "g", ruleId: "r2", status: "needs permission" },
      { groupId: "g", ruleId: "r3", status: "unsupported" },
    ];
    expect(aggregateGroupStatus(true, statuses)).toBe("needs permission");
    expect(
      aggregateGroupStatus(true, [
        { groupId: "g", ruleId: "r", status: "needs proxy" },
        { groupId: "g", ruleId: "r2", status: "active" },
      ]),
    ).toBe("needs proxy");
    expect(
      aggregateGroupStatus(true, [
        { groupId: "g", ruleId: "r", status: "error" },
        { groupId: "g", ruleId: "r2", status: "needs proxy" },
      ]),
    ).toBe("error");
    expect(
      aggregateGroupStatus(true, [
        { groupId: "g", ruleId: "r", status: "unsupported" },
      ]),
    ).toBe("unsupported");
  });
});

describe("F21 popup model", () => {
  it("lists each active project's persisted rule in source order with truthful status", () => {
    const model = createPopupModel({
      envelope: envelope({
        ruleStatuses: [
          { groupId: "g1", ruleId: "r", status: "active" },
          { groupId: "g3", ruleId: "r", status: "needs permission" },
        ],
      }),
      send: vi.fn(async () => ({ ok: true })),
    });
    const rows = model.rows();
    expect(rows.map((r) => r.id)).toEqual(["g1-0", "g1-1", "g3-0"]);
    expect(rows[0]).toMatchObject({
      id: "g1-0",
      groupId: "g1",
      name: "Rule 1",
      enabled: true,
      status: "active",
    });
    expect(rows[1]).toMatchObject({
      id: "g1-1",
      groupId: "g1",
      enabled: true,
      status: "active",
    });
    expect(rows[2]).toMatchObject({
      id: "g3-0",
      groupId: "g3",
      enabled: true,
      status: "needs permission",
    });
    expect(model.activeProjectName).toBe("Alpha");
  });

  it("returns no rows when there is no active project", () => {
    const model = createPopupModel({
      envelope: { activeProjectId: null, projects: {}, ruleStatuses: [] },
      send: vi.fn(async () => ({ ok: true })),
    });
    expect(model.rows()).toEqual([]);
    expect(model.activeProjectName).toBeNull();
  });

  it("toggles exactly one group through the existing set-group-enabled lifecycle", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const model = createPopupModel({ envelope: envelope(), send });
    await model.toggle("g2", true);
    expect(send).toHaveBeenCalledWith({
      version: 1,
      command: "set-group-enabled",
      projectId: "project-a",
      groupId: "g2",
      enabled: true,
    });
  });

  it("does not send when there is no active project", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const model = createPopupModel({
      envelope: { activeProjectId: null, projects: {}, ruleStatuses: [] },
      send,
    });
    await model.toggle("g2", true);
    expect(send).not.toHaveBeenCalled();
  });

  it("builds management-page navigation URLs without popup-only state", () => {
    expect(model().openAppUrl()).toBe(MANAGEMENT_PAGE);
    expect(groupUrl("g3")).toBe(`${MANAGEMENT_PAGE}?group=g3`);
  });
});

function model(): ReturnType<typeof createPopupModel> {
  return createPopupModel({
    envelope: envelope(),
    send: vi.fn(async () => ({ ok: true })),
  });
}
