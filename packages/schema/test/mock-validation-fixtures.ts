import { LIMITS, type RogatioProject } from "../src/index.js";

function repeat(char: string, count: number): string {
  return char.repeat(count);
}

export function mockRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-mock",
    name: "Mock rule",
    source: { key: "url", operator: "regex", value: "^https://example\\.com/" },
    resourceTypes: ["main_frame" as const],
    priority: 100,
    type: "mock" as const,
    mock: { status: 200, body: "hello" },
    ...overrides,
  };
}

export function projectWith(rule: Record<string, unknown>): RogatioProject {
  return {
    version: 2,
    name: "Example project",
    groups: [
      {
        id: "group-main",
        name: "Main sites",
        rules: [rule as never],
      },
    ],
  };
}

/** Projects exercised by the extension browser-schema parity test. */
export function mockParityProjects(): RogatioProject[] {
  const projects: RogatioProject[] = [];

  projects.push(projectWith(mockRule()));
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 404,
          delayMs: 100,
          headers: [{ name: "Content-Type", value: "text/plain" }],
          file: "responses/not-found.bin",
        },
      }),
    ),
  );

  const ruleMissingMock = mockRule();
  delete (ruleMissingMock as { mock?: unknown }).mock;
  projects.push(projectWith(ruleMissingMock));
  projects.push(projectWith(mockRule({ unexpectedRuleField: true })));
  projects.push(
    projectWith(
      mockRule({
        mock: { status: 200, body: "x", unexpectedPayloadField: true },
      }),
    ),
  );
  projects.push(
    projectWith({
      id: "rule-mock",
      name: "Mock rule",
      source: {
        key: "url",
        operator: "regex",
        value: "^https://example\\.com/",
      },
      resourceTypes: ["main_frame" as const],
      priority: 100,
      mock: { status: 200, body: "hello" },
      unexpectedRuleField: true,
    }),
  );

  for (const status of [
    LIMITS.minMockStatus - 1,
    LIMITS.minMockStatus,
    LIMITS.maxMockStatus,
    LIMITS.maxMockStatus + 1,
  ]) {
    projects.push(projectWith(mockRule({ mock: { status, body: "" } })));
  }

  for (const delayMs of [
    -1,
    0,
    LIMITS.maxMockDelayMs,
    LIMITS.maxMockDelayMs + 1,
  ]) {
    projects.push(
      projectWith(mockRule({ mock: { status: 200, body: "x", delayMs } })),
    );
  }

  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: repeat("a", LIMITS.maxMockInlineBodyLength),
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: repeat("a", LIMITS.maxMockInlineBodyLength + 1),
        },
      }),
    ),
  );

  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          file: repeat("f", LIMITS.maxMockFilePathLength),
        },
      }),
    ),
  );
  projects.push(projectWith(mockRule({ mock: { status: 200, file: "" } })));
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          file: repeat("f", LIMITS.maxMockFilePathLength + 1),
        },
      }),
    ),
  );

  const maxHeaders = Array.from(
    { length: LIMITS.maxMockHeadersPerRule },
    (_, i) => ({ name: `h-${i}`, value: "v" }),
  );
  projects.push(
    projectWith(
      mockRule({ mock: { status: 200, body: "x", headers: maxHeaders } }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [...maxHeaders, { name: "overflow", value: "v" }],
        },
      }),
    ),
  );

  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [
            {
              name: repeat("n", LIMITS.maxMockHeaderNameLength),
              value: "v",
            },
          ],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [
            {
              name: repeat("n", LIMITS.maxMockHeaderNameLength + 1),
              value: "v",
            },
          ],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "", value: "v" }],
        },
      }),
    ),
  );

  for (const mock of [
    { body: "x" },
    { status: 200.5, body: "x" },
    { status: "200", body: "x" },
    { status: 200, body: "x", delayMs: 1.5 },
    { status: 200, body: 7 },
    { status: 200, file: 7 },
    { status: 200, body: "x", headers: {} },
    { status: 200, body: "x", headers: [{ name: "X-Test" }] },
    { status: 200, body: "x", headers: [{ value: "v" }] },
    {
      status: 200,
      body: "x",
      headers: [{ name: "X-Test", value: "v", extra: true }],
    },
  ]) {
    projects.push(projectWith(mockRule({ mock: mock as never })));
  }

  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "X-Test", value: "" }],
        },
      }),
    ),
  );

  for (const status of [204, 205, 304, 200, 201, 203, 206, 404, 599]) {
    projects.push(projectWith(mockRule({ mock: { status, body: "x" } })));
  }

  projects.push(
    projectWith(
      mockRule({
        mock: { status: 200, body: "inline", file: "responses/a.bin" },
      }),
    ),
  );
  projects.push(projectWith(mockRule({ mock: { status: 200 } })));

  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "X-\u0001", value: "v" }],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "X-Test", value: "v\u007f" }],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "Content-Length", value: "0" }],
        },
      }),
    ),
  );

  for (const name of [
    "CONTENT-LENGTH",
    "Set-Cookie",
    "Transfer-Encoding",
    "Content-Encoding",
    "Content-Length ",
    " Content-Length",
  ]) {
    projects.push(
      projectWith(
        mockRule({
          mock: { status: 200, body: "x", headers: [{ name, value: "1" }] },
        }),
      ),
    );
  }

  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [{ name: "X-A", value: "1\r\nSet-Cookie: a=b" }],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [
            { name: "X-Test", value: "1" },
            { name: "X-Test ", value: "2" },
          ],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "",
          headers: [
            { name: "Content-Type", value: "text/plain" },
            { name: "Cache-Control", value: "no-store" },
          ],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 204,
          file: "/abs",
          headers: [
            { name: "Content-Length", value: "\n" },
            { name: "content-length", value: "1" },
          ],
        },
      }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: {
          status: 200,
          body: "x",
          headers: [
            { name: "X-Test", value: "1" },
            { name: "x-test", value: "2" },
          ],
        },
      }),
    ),
  );

  for (const file of [
    "/etc/passwd",
    "responses\\a.bin",
    "responses/%2e%2e/secret",
    "responses/\u0001.bin",
    "responses/../secret.bin",
    "./responses/a.bin",
    "responses/a.bin/",
    "responses//a.bin",
    "responses/a:1.bin",
    "responses/*.bin",
    "responses/a?.bin",
    "responses/a[0].bin",
  ]) {
    projects.push(projectWith(mockRule({ mock: { status: 200, file } })));
  }

  projects.push(
    projectWith(
      mockRule({ mock: { status: 200, file: "responses/not-found.bin" } }),
    ),
  );
  projects.push(
    projectWith(
      mockRule({
        mock: { status: 200, body: "x", file: "secret-dir/a.bin" },
      }),
    ),
  );

  const mockInherited = Object.create({ body: "inherited" }) as {
    status: number;
  };
  mockInherited.status = 200;
  projects.push(projectWith(mockRule({ mock: mockInherited })));

  const mockAccessor = { status: 200 } as Record<string, unknown>;
  Object.defineProperty(mockAccessor, "file", {
    enumerable: true,
    get: () => "responses/a.bin",
  });
  projects.push(projectWith(mockRule({ mock: mockAccessor })));

  const headerThrow = { name: "X-A" } as Record<string, unknown>;
  Object.defineProperty(headerThrow, "value", {
    enumerable: true,
    get: () => {
      throw new Error("boom");
    },
  });
  projects.push(
    projectWith(
      mockRule({ mock: { status: 200, body: "x", headers: [headerThrow] } }),
    ),
  );

  const target = { status: 200, body: "x" };
  const mockProxy = new Proxy(target, {
    ownKeys() {
      return ["status", "body", "unexpected"];
    },
    getOwnPropertyDescriptor(_object, key) {
      if (key === "unexpected") {
        return {
          configurable: true,
          enumerable: true,
          value: true,
          writable: true,
        };
      }
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });
  projects.push(projectWith(mockRule({ mock: mockProxy })));

  const mockThrowingProxy = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("boom");
      },
    },
  );
  projects.push(projectWith(mockRule({ mock: mockThrowingProxy })));

  const mockCycle: Record<string, unknown> = { status: 200, body: "x" };
  mockCycle.self = mockCycle;
  projects.push(projectWith(mockRule({ mock: mockCycle })));

  const inheritedHeaders = [] as { name: string; value: string }[];
  Object.setPrototypeOf(inheritedHeaders, {
    0: { name: "X-Inherited", value: "v" },
  });
  inheritedHeaders.length = 1;
  projects.push(
    projectWith(
      mockRule({
        mock: { status: 200, body: "x", headers: inheritedHeaders },
      }),
    ),
  );

  const sparseHeaders = new Array(2) as { name: string; value: string }[];
  sparseHeaders[1] = { name: "X-A", value: "v" };
  projects.push(
    projectWith(
      mockRule({ mock: { status: 200, body: "x", headers: sparseHeaders } }),
    ),
  );

  const protoHeaders = JSON.parse(
    '[{"name":"__proto__","value":"1"},{"name":"constructor","value":"2"},{"name":"toString","value":"3"}]',
  ) as unknown;
  projects.push(
    projectWith(
      mockRule({
        mock: { status: 200, body: "x", headers: protoHeaders },
      }),
    ),
  );

  return projects;
}
