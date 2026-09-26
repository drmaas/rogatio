// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "../src/index.js";
import type {
  AIAssistChunk,
  AIAssistRequest,
  AIProposal,
  EditorController,
  RuleProposal,
} from "../src/types.js";

const baseProject = {
  version: 2,
  name: "AI Assist project",
  groups: [
    {
      id: "group-one",
      name: "One",
      rules: [] as unknown[],
    },
  ],
} as const;

function sourceRegex(value: string) {
  return { key: "url" as const, operator: "regex" as const, value };
}

const live: { root?: HTMLElement; editor?: EditorController } = {};

afterEach(() => {
  live.editor?.destroy();
  live.root?.remove();
  live.editor = undefined;
  live.root = undefined;
  for (const el of document.querySelectorAll(".ai-assist-panel")) {
    el.remove();
  }
});

function proposalFor(rule: RuleProposal): AIProposal {
  return {
    explanation: "Test proposal",
    rules: [rule],
  };
}

function mountEditor(
  aiAssist: NonNullable<Parameters<typeof createEditor>[0]["aiAssist"]>,
  validate: () =>
    | []
    | ReturnType<
        NonNullable<Parameters<typeof createEditor>[0]["validate"]>
      > = () => [],
  initialProject?: Parameters<typeof createEditor>[0]["initialProject"],
): { root: HTMLElement; editor: EditorController } {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({
    root,
    initialProject: initialProject ?? structuredClone(baseProject),
    validate,
    save: () => ({ ok: true }),
    aiAssist,
  });
  live.root = root;
  live.editor = editor;
  return { root, editor };
}

function openAssistPanel(): {
  panel: HTMLElement;
  textarea: HTMLTextAreaElement;
  send: HTMLButtonElement;
} {
  const root = live.root;
  expect(root).toBeTruthy();
  const button = Array.from(root?.querySelectorAll("button") ?? []).find(
    (el) => el.textContent === "AI Assist",
  );
  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const panels = document.querySelectorAll(".ai-assist-panel");
  const panel = panels[panels.length - 1];
  expect(panel).toBeInstanceOf(HTMLElement);
  const textarea = panel?.querySelector("textarea");
  const send = Array.from(panel?.querySelectorAll("button") ?? []).find(
    (el) => el.textContent === "Send",
  );
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
  expect(send).toBeInstanceOf(HTMLButtonElement);
  return {
    panel: panel as HTMLElement,
    textarea: textarea as HTMLTextAreaElement,
    send: send as HTMLButtonElement,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe("@rogatio/editor AI Assist wire", () => {
  it("Send invokes aiAssist with generate request when draft is valid (AC-001)", async () => {
    const requests: AIAssistRequest[] = [];

    mountEditor(async function* (
      request: AIAssistRequest,
    ): AsyncIterable<AIAssistChunk> {
      requests.push(request);
      yield { type: "token", content: "Thinking…" };
      yield {
        type: "done",
        proposal: proposalFor({
          kind: "redirect",
          groupId: "group-one",
          name: "Redirect",
          source: sourceRegex("^https://api\\.example/"),
          action: { destination: "https://mock.example/$1" },
        }),
      };
    });

    const { textarea, send } = openAssistPanel();
    textarea.value = "Add a redirect for api.example";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe("generate");
    expect(requests[0]?.prompt).toBe("Add a redirect for api.example");
    expect(requests[0]?.context.activeGroupId).toBeUndefined();
    expect(requests[0]?.context.project.name).toBe("AI Assist project");
  });

  it("Send uses kind fix when diagnostics exist (AC-001)", async () => {
    const requests: AIAssistRequest[] = [];

    mountEditor(
      async (request) => {
        requests.push(request);
        return {
          proposal: proposalFor({
            kind: "redirect",
            groupId: "group-one",
            name: "Fixed",
            source: sourceRegex("^https://ok\\.example/"),
            action: { destination: "https://mock.example/" },
          }),
        };
      },
      () => [
        {
          code: "schema.invalid-regex",
          severity: "error",
          path: "/groups/0/rules/0/source/value",
          message: "bad regex",
        },
      ],
    );

    const { textarea, send } = openAssistPanel();
    textarea.value = "Fix the regex";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(requests[0]?.kind).toBe("fix");
    expect(requests[0]?.context.diagnostics).toHaveLength(1);
  });

  it("streams tokens and surfaces errors in the panel (AC-002)", async () => {
    mountEditor(async function* (): AsyncIterable<AIAssistChunk> {
      yield { type: "token", content: "Hello " };
      yield { type: "token", content: "world" };
      yield {
        type: "error",
        error: { code: "ai.provider", message: "provider down" },
      };
    });

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "stream please";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(panel.textContent).toContain("Hello world");
    expect(panel.textContent).toContain("provider down");
  });

  it("Apply maps proposal kinds onto draft fields (AC-003, AC-004)", async () => {
    const kinds: RuleProposal["kind"][] = [
      "redirect",
      "query",
      "header",
      "response-body",
      "request-body",
    ];
    const actions: Record<RuleProposal["kind"], unknown> = {
      redirect: { destination: "https://mock.example/$1" },
      query: {
        type: "query",
        params: [{ name: "q", operation: "set", value: "1" }],
      },
      header: {
        direction: "request",
        operation: "set",
        name: "X-Test",
        value: "1",
      },
      "response-body": { mode: "replace", body: "ok" },
      "request-body": { mode: "replace", body: '{"a":1}' },
    };

    for (const kind of kinds) {
      live.editor?.destroy();
      live.root?.remove();
      for (const el of document.querySelectorAll(".ai-assist-panel")) {
        el.remove();
      }

      const { editor } = mountEditor(
        async function* (): AsyncIterable<AIAssistChunk> {
          yield {
            type: "done",
            proposal: proposalFor({
              kind,
              groupId: "group-one",
              name: `Rule ${kind}`,
              source: sourceRegex("^https://example\\.com/"),
              action: actions[kind],
            }),
          };
        },
      );

      const { panel, textarea, send } = openAssistPanel();
      textarea.value = `make ${kind}`;
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      const apply = Array.from(panel.querySelectorAll("button")).find(
        (el) => el.textContent === "Apply Rule",
      );
      expect(apply, `Apply Rule for ${kind}`).toBeTruthy();
      apply?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const draft = editor.getDraft();
      const group = draft.groups.find((g) => g.id === "group-one");
      const found = group?.rules.find((r) => r.name === `Rule ${kind}`);
      const fields = found as unknown as Record<string, unknown> | undefined;
      expect(fields, `rule for ${kind}`).toBeTruthy();
      expect(fields?.type).toBe(kind);

      if (kind === "redirect") {
        expect(fields?.redirect).toEqual(actions.redirect);
        expect(fields?.action).toBeUndefined();
      } else if (kind === "query") {
        expect(fields?.action).toEqual(actions.query);
      } else if (kind === "header") {
        expect(fields?.headerDirection).toBe("request");
        expect(fields?.headerOperation).toBe("set");
        expect(fields?.headerName).toBe("X-Test");
        expect(fields?.headerValue).toBe("1");
        expect(fields?.action).toBeUndefined();
      } else if (kind === "response-body") {
        expect(fields?.responseBody).toEqual(actions["response-body"]);
        expect(fields?.action).toBeUndefined();
      } else if (kind === "request-body") {
        expect(fields?.requestBody).toEqual(actions["request-body"]);
        expect(fields?.action).toBeUndefined();
      }
    }
  });

  it("Apply repairs the offending rule in place for fix requests (AC-003)", async () => {
    const brokenProject = {
      version: 2,
      name: "Fix project",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-broken",
              name: "Broken",
              source: { key: "url", operator: "regex", value: "[" },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "redirect",
              redirect: { destination: "https://mock.example/old" },
            },
          ],
        },
      ],
    };
    const requests: AIAssistRequest[] = [];
    const { editor } = mountEditor(
      async (request) => {
        requests.push(request);
        return {
          proposal: proposalFor({
            kind: "redirect",
            groupId: "group-one",
            name: "Fixed",
            source: sourceRegex("^https://one\\.example/ok$"),
            action: { destination: "https://mock.example/new" },
          }),
        };
      },
      () => [
        {
          code: "schema.invalid-regex",
          severity: "error",
          path: "/groups/0/rules/0/source/value",
          message: "bad regex",
        },
      ],
      brokenProject,
    );

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "Fix the broken rule";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(requests[0]?.kind).toBe("fix");

    Array.from(panel.querySelectorAll("button"))
      .find((el) => el.textContent === "Apply Rule")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const group = editor.getDraft().groups.find((g) => g.id === "group-one");
    expect(group?.rules).toHaveLength(1);
    const rule = group?.rules[0] as unknown as Record<string, unknown>;
    expect(rule.id).toBe("rule-broken");
    expect(rule.name).toBe("Fixed");
    expect((rule.source as { value: string }).value).toBe(
      "^https://one\\.example/ok$",
    );
    expect(rule.type).toBe("redirect");
    expect(rule.redirect).toEqual({ destination: "https://mock.example/new" });
  });

  it("Apply appends surplus fix-proposal rules beyond the repair targets (AC-003)", async () => {
    const brokenProject = {
      version: 2,
      name: "Fix project",
      groups: [
        {
          id: "group-one",
          name: "One",
          rules: [
            {
              id: "rule-broken",
              name: "Broken",
              source: { key: "url", operator: "regex", value: "[" },
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "redirect",
              redirect: { destination: "https://mock.example/old" },
            },
          ],
        },
      ],
    };
    const { editor } = mountEditor(
      async () => ({
        proposal: {
          explanation: "fix plus extra",
          rules: [
            {
              kind: "redirect",
              groupId: "group-one",
              name: "Fixed",
              source: sourceRegex("^https://one\\.example/ok$"),
              action: { destination: "https://mock.example/new" },
            },
            {
              kind: "redirect",
              groupId: "group-one",
              name: "Surplus",
              source: sourceRegex("^https://one\\.example/extra$"),
              action: { destination: "https://mock.example/extra" },
            },
          ] as RuleProposal[],
        },
      }),
      () => [
        {
          code: "schema.invalid-regex",
          severity: "error",
          path: "/groups/0/rules/0/source/value",
          message: "bad regex",
        },
      ],
      brokenProject,
    );

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "Fix the broken rule";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    Array.from(panel.querySelectorAll("button"))
      .find((el) => el.textContent === "Apply Rule")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const group = editor.getDraft().groups.find((g) => g.id === "group-one");
    expect(group?.rules).toHaveLength(2);
    const rules = (group?.rules ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    const [first, second] = rules;
    expect(first.id).toBe("rule-broken");
    expect(first.name).toBe("Fixed");
    expect(second.name).toBe("Surplus");
    expect(String(second.id)).not.toBe("rule-broken");
  });

  it("accepts schema-shaped header action keys (AC-004)", async () => {
    const { editor } = mountEditor(async () => ({
      proposal: proposalFor({
        kind: "header",
        groupId: "group-one",
        name: "Schema header",
        source: sourceRegex("^https://example\\.com/"),
        action: {
          headerDirection: "response",
          headerOperation: "append",
          headerName: "X-Schema",
          headerValue: "yes",
        },
      }),
    }));

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "header";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    Array.from(panel.querySelectorAll("button"))
      .find((el) => el.textContent === "Apply Rule")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(rule.headerDirection).toBe("response");
    expect(rule.headerOperation).toBe("append");
    expect(rule.headerName).toBe("X-Schema");
    expect(rule.headerValue).toBe("yes");
  });

  it("ignores prototype-polluting keys on header action (AC-004)", async () => {
    const polluted = JSON.parse(
      '{"headerDirection":"request","headerOperation":"set","headerName":"X","headerValue":"1","__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;

    const { editor } = mountEditor(async () => ({
      proposal: proposalFor({
        kind: "header",
        groupId: "group-one",
        name: "Safe header",
        source: sourceRegex("^https://example\\.com/"),
        action: polluted,
      }),
    }));

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "header";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    Array.from(panel.querySelectorAll("button"))
      .find((el) => el.textContent === "Apply Rule")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const rule = editor.getDraft().groups[0]?.rules[0] as unknown as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(rule, "__proto__")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(rule.headerName).toBe("X");
  });

  it("ignores concurrent Send while a request is in flight", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    mountEditor(async function* (): AsyncIterable<AIAssistChunk> {
      calls += 1;
      await gate;
      yield {
        type: "done",
        proposal: proposalFor({
          kind: "redirect",
          groupId: "group-one",
          name: "Once",
          source: sourceRegex("^https://example\\.com/"),
          action: { destination: "https://mock.example/" },
        }),
      };
    });

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "first";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    textarea.value = "second";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(calls).toBe(1);
    expect(panel.textContent).not.toContain("second");
    release();
    await flush();
  });

  it("surfaces handler throws as panel system errors", async () => {
    mountEditor(async () => {
      throw new Error("boom from host");
    });

    const { panel, textarea, send } = openAssistPanel();
    textarea.value = "explode";
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(panel.textContent).toContain("boom from host");
  });
});
