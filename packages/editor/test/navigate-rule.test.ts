// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createEditor, ruleAnchorId } from "../src/index.js";

const project = {
  version: 2,
  name: "Rule navigation project",
  groups: [
    {
      id: "group-one",
      name: "One",
      rules: [
        {
          id: "rule-one",
          name: "Rule one",
          source: { key: "url", operator: "regex", value: "" },
          resourceTypes: ["main_frame"],
          priority: 100,
        },
      ],
    },
    {
      id: "group-two",
      name: "Two",
      rules: [
        {
          id: "rule-two",
          name: "Rule two",
          source: { key: "url", operator: "regex", value: "" },
          resourceTypes: ["main_frame"],
          priority: 100,
        },
      ],
    },
  ],
} as const;

function mount(initialProject: unknown = project) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({
    root,
    initialProject,
    validate: () => [],
    save: () => ({ ok: true }),
  });
  return { root, editor };
}

function activeRoute(root: HTMLElement): string | undefined {
  return (
    root
      .querySelector("[data-command='open-group-picker'][aria-current='page']")
      ?.getAttribute("data-group-id") ?? undefined
  );
}

describe("EditorController.navigateToRule", () => {
  it("routes to the owning group and focuses that rule's card", () => {
    const { root, editor } = mount();
    editor.navigateToRule("group-two", "rule-two");
    expect(activeRoute(root)).toBe("group-two");
    const card = root.querySelector(
      `#${CSS.escape(ruleAnchorId("group-two", "rule-two"))}`,
    );
    expect(card).not.toBeNull();
    expect(document.activeElement).toBe(card);
    expect(card?.getAttribute("data-rule-id")).toBe("rule-two");
    editor.destroy();
  });

  it("navigates from one group to another without a remount", () => {
    const { root, editor } = mount();
    editor.navigateToGroup("group-one");
    const before = root.querySelector("[data-rule-card]");
    editor.navigateToRule("group-two", "rule-two");
    expect(root.querySelector("[data-rule-card]")).not.toBe(before);
    expect(
      root.querySelector(
        `#${CSS.escape(ruleAnchorId("group-two", "rule-two"))}`,
      ),
    ).not.toBeNull();
    editor.destroy();
  });

  it("still routes to the group when the rule is not in the draft", () => {
    const { root, editor } = mount();
    expect(() =>
      editor.navigateToRule("group-two", "rule-missing"),
    ).not.toThrow();
    expect(
      root.querySelector(
        `#${CSS.escape(ruleAnchorId("group-two", "rule-two"))}`,
      ),
    ).not.toBeNull();
    editor.destroy();
  });

  it("falls back to the overview for an unknown group and never throws", () => {
    const { root, editor } = mount();
    editor.navigateToRule("group-one", "rule-one");
    expect(activeRoute(root)).toBe("group-one");
    expect(() =>
      editor.navigateToRule("group-missing", "rule-two"),
    ).not.toThrow();
    // The fallback is the interesting half: an unknown group must actually
    // leave the group route, not merely avoid throwing.
    expect(activeRoute(root)).toBeUndefined();
    editor.destroy();
  });

  it("tolerates non-string ids from untrusted callers", () => {
    const { root, editor } = mount();
    expect(() =>
      editor.navigateToRule(
        undefined as unknown as string,
        null as unknown as string,
      ),
    ).not.toThrow();
    expect(activeRoute(root)).toBeUndefined();

    // An object with a toString trap must be treated as a non-string, not
    // coerced: a String()-based implementation would land on group-two here.
    const trapped = {
      toString: () => "group-two",
    } as unknown as string;
    expect(() => editor.navigateToRule(trapped, "rule-two")).not.toThrow();
    expect(activeRoute(root)).toBeUndefined();
    editor.destroy();
  });

  it("smooth-scrolls by default", () => {
    const { root, editor } = mount();
    const calls: unknown[] = [];
    const card = document.createElement("div");
    card.scrollIntoView = ((options: unknown) => {
      calls.push(options);
    }) as HTMLElement["scrollIntoView"];
    const anchor = ruleAnchorId("group-two", "rule-two");
    const original = document.getElementById;
    document.getElementById = ((id: string) =>
      id === anchor
        ? card
        : original.call(document, id)) as typeof document.getElementById;

    editor.navigateToRule("group-two", "rule-two");
    document.getElementById = original;
    // Without this case a hard-coded "auto" would satisfy the reduced-motion
    // test and silently break motion for everyone else.
    expect(calls).toEqual([{ block: "start", behavior: "smooth" }]);
    editor.destroy();
    root.remove();
  });

  it("does not smooth-scroll when the user asked for reduced motion", () => {
    const { root, editor } = mount();
    const calls: unknown[] = [];
    const card = document.createElement("div");
    card.scrollIntoView = ((options: unknown) => {
      calls.push(options);
    }) as HTMLElement["scrollIntoView"];
    const anchor = ruleAnchorId("group-two", "rule-two");
    const original = document.getElementById;
    document.getElementById = ((id: string) =>
      id === anchor
        ? card
        : original.call(document, id)) as typeof document.getElementById;
    const reduced = window.matchMedia as unknown as (query: string) => {
      matches: boolean;
    };
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      query.includes("prefers-reduced-motion")
        ? { matches: true }
        : reduced(query)) as typeof window.matchMedia;

    editor.navigateToRule("group-two", "rule-two");
    window.matchMedia = previousMatchMedia;
    document.getElementById = original;
    expect(calls).toEqual([{ block: "start", behavior: "auto" }]);
    editor.destroy();
    root.remove();
  });
});
