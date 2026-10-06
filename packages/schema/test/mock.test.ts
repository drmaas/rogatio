import { describe, expect, it } from "vitest";
import {
  LIMITS,
  migrateV1Project,
  type RogatioProject,
  validateProjectDetailed,
} from "../src/index.js";

function repeat(char: string, count: number): string {
  return char.repeat(count);
}

function mockRule(overrides: Record<string, unknown> = {}) {
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

function projectWith(rule: Record<string, unknown>): RogatioProject {
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

const RULE_MOCK_PATH = "/groups/0/rules/0/mock";

function expectMockIssue(
  result: ReturnType<typeof validateProjectDetailed>,
  instancePath: string,
  keyword: string,
): void {
  expect(result.valid).toBe(false);
  if (result.valid) return;
  // Exactly one diagnostic: a single defect must not fan out into extra paths.
  expect(
    result.errors.map((error) => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
    })),
  ).toEqual([{ instancePath, keyword }]);
}

describe("@rogatio/schema mock rules", () => {
  it("accepts a valid inline mock rule", () => {
    const result = validateProjectDetailed(projectWith(mockRule()));
    expect(result).toMatchObject({ valid: true });
  });

  it("accepts a valid file-backed mock with headers and delay", () => {
    const result = validateProjectDetailed(
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
    expect(result).toMatchObject({ valid: true });
  });

  it("rejects a mock rule without a mock payload", () => {
    const rule = mockRule();
    delete (rule as { mock?: unknown }).mock;
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (error) =>
            error.instancePath === "/groups/0/rules/0/mock" &&
            (error.params as { missingProperty?: string }).missingProperty ===
              "mock",
        ),
      ).toBe(true);
    }
  });

  it("rejects an unknown property on the rule", () => {
    const result = validateProjectDetailed(
      projectWith(mockRule({ unexpectedRuleField: true })),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  it("rejects an unknown property on the mock payload", () => {
    const result = validateProjectDetailed(
      projectWith(
        mockRule({
          mock: { status: 200, body: "x", unexpectedPayloadField: true },
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  it("rejects an unknown property on a rule that only carries a mock payload", () => {
    const rule = {
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
    };
    const result = validateProjectDetailed(projectWith(rule));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });

  describe("status bounds", () => {
    it.each([
      ["below minimum", LIMITS.minMockStatus - 1, false],
      ["at minimum", LIMITS.minMockStatus, true],
      ["at maximum", LIMITS.maxMockStatus, true],
      ["above maximum", LIMITS.maxMockStatus + 1, false],
    ] as const)("status %s", (_label, status, valid) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status, body: "" } })),
      );
      expect(result.valid).toBe(valid);
    });
  });

  describe("delayMs bounds", () => {
    it.each([
      ["below minimum", -1, false],
      ["at minimum", 0, true],
      ["at maximum", LIMITS.maxMockDelayMs, true],
      ["above maximum", LIMITS.maxMockDelayMs + 1, false],
    ] as const)("delayMs %s", (_label, delayMs, valid) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, body: "x", delayMs } })),
      );
      expect(result.valid).toBe(valid);
    });
  });

  describe("inline body length", () => {
    it("accepts body at maxMockInlineBodyLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: repeat("a", LIMITS.maxMockInlineBodyLength),
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects body over maxMockInlineBodyLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: repeat("a", LIMITS.maxMockInlineBodyLength + 1),
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("file path length", () => {
    it("accepts file at maxMockFilePathLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              file: repeat("f", LIMITS.maxMockFilePathLength),
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects empty file path", () => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, file: "" } })),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects file over maxMockFilePathLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              file: repeat("f", LIMITS.maxMockFilePathLength + 1),
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("headers", () => {
    it("accepts maxMockHeadersPerRule entries", () => {
      const headers = Array.from(
        { length: LIMITS.maxMockHeadersPerRule },
        (_, i) => ({
          name: `h-${i}`,
          value: "v",
        }),
      );
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, body: "x", headers } })),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects more than maxMockHeadersPerRule entries", () => {
      const headers = Array.from(
        { length: LIMITS.maxMockHeadersPerRule + 1 },
        (_, i) => ({
          name: `h-${i}`,
          value: "v",
        }),
      );
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, body: "x", headers } })),
      );
      expect(result.valid).toBe(false);
    });

    it("accepts header name at maxMockHeaderNameLength", () => {
      const result = validateProjectDetailed(
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
      expect(result.valid).toBe(true);
    });

    it("rejects header name over maxMockHeaderNameLength", () => {
      const result = validateProjectDetailed(
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
      expect(result.valid).toBe(false);
    });

    it("rejects empty header name", () => {
      const result = validateProjectDetailed(
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
      expect(result.valid).toBe(false);
    });

    it("accepts header value at maxMockHeaderValueLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [
                {
                  name: "X-Test",
                  value: repeat("v", LIMITS.maxMockHeaderValueLength),
                },
              ],
            },
          }),
        ),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects header value over maxMockHeaderValueLength", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: {
              status: 200,
              body: "x",
              headers: [
                {
                  name: "X-Test",
                  value: repeat("v", LIMITS.maxMockHeaderValueLength + 1),
                },
              ],
            },
          }),
        ),
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("payload shape", () => {
    it.each([
      ["missing status", { body: "x" }],
      ["fractional status", { status: 200.5, body: "x" }],
      ["string status", { status: "200", body: "x" }],
      ["fractional delayMs", { status: 200, body: "x", delayMs: 1.5 }],
      ["non-string body", { status: 200, body: 7 }],
      ["non-string file", { status: 200, file: 7 }],
      ["non-array headers", { status: 200, body: "x", headers: {} }],
      [
        "header missing value",
        { status: 200, body: "x", headers: [{ name: "X-Test" }] },
      ],
      [
        "header missing name",
        { status: 200, body: "x", headers: [{ value: "v" }] },
      ],
      [
        "header with unknown property",
        {
          status: 200,
          body: "x",
          headers: [{ name: "X-Test", value: "v", extra: true }],
        },
      ],
    ] as const)("rejects %s", (_label, mock) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: mock as never })),
      );
      expect(result.valid).toBe(false);
    });

    it("accepts an empty header value", () => {
      const result = validateProjectDetailed(
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
      expect(result.valid).toBe(true);
    });
  });

  describe("semantic validation", () => {
    it("rejects mock statuses 204, 205, and 304", () => {
      for (const status of [204, 205, 304] as const) {
        const result = validateProjectDetailed(
          projectWith(mockRule({ mock: { status, body: "x" } })),
        );
        expectMockIssue(result, `${RULE_MOCK_PATH}/status`, "mock-status");
      }
    });

    it("accepts other statuses in the mock range", () => {
      for (const status of [200, 201, 203, 206, 404, 599] as const) {
        const result = validateProjectDetailed(
          projectWith(mockRule({ mock: { status, body: "x" } })),
        );
        expect(result).toMatchObject({ valid: true });
      }
    });

    it("rejects both body and file", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: { status: 200, body: "inline", file: "responses/a.bin" },
          }),
        ),
      );
      expectMockIssue(result, RULE_MOCK_PATH, "mock-body-source");
    });

    it("rejects neither body nor file", () => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200 } })),
      );
      expectMockIssue(result, RULE_MOCK_PATH, "mock-body-source");
    });

    it("rejects control characters in header names", () => {
      const result = validateProjectDetailed(
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
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/0/name`,
        "mock-header-control",
      );
    });

    it("rejects control characters in header values", () => {
      const result = validateProjectDetailed(
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
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/0/value`,
        "mock-header-control",
      );
    });

    it("rejects forbidden response-framing headers", () => {
      const result = validateProjectDetailed(
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
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/0/name`,
        "forbiddenHeader",
      );
    });

    it.each([
      ["upper-case", "CONTENT-LENGTH"],
      ["set-cookie", "Set-Cookie"],
      ["transfer-encoding", "Transfer-Encoding"],
      ["content-encoding", "Content-Encoding"],
      ["trailing space", "Content-Length "],
      ["leading space", " Content-Length"],
    ] as const)("rejects forbidden response header (%s)", (_label, name) => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: { status: 200, body: "x", headers: [{ name, value: "1" }] },
          }),
        ),
      );
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/0/name`,
        "forbiddenHeader",
      );
    });

    it("rejects CR/LF header-injection in header values", () => {
      const result = validateProjectDetailed(
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
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/0/value`,
        "mock-header-control",
      );
    });

    it("rejects padded duplicate header names", () => {
      const result = validateProjectDetailed(
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
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/1/name`,
        "uniqueMockHeaderName",
      );
    });

    it("accepts an empty inline body and distinct headers", () => {
      const result = validateProjectDetailed(
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
      expect(result).toMatchObject({ valid: true });
    });

    it("reports multiple defects in a stable source order", () => {
      const project = projectWith(
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
      );
      const expected = [
        [`${RULE_MOCK_PATH}/status`, "mock-status"],
        [`${RULE_MOCK_PATH}/file`, "mock-file-path"],
        [`${RULE_MOCK_PATH}/headers/0/value`, "mock-header-control"],
        [`${RULE_MOCK_PATH}/headers/0/name`, "forbiddenHeader"],
        [`${RULE_MOCK_PATH}/headers/1/name`, "forbiddenHeader"],
        [`${RULE_MOCK_PATH}/headers/1/name`, "uniqueMockHeaderName"],
      ];
      for (let run = 0; run < 2; run += 1) {
        const result = validateProjectDetailed(project);
        expect(result.valid).toBe(false);
        if (result.valid) return;
        expect(
          result.errors.map((error) => [error.instancePath, error.keyword]),
        ).toEqual(expected);
      }
    });

    it("rejects duplicate header names case-insensitively", () => {
      const result = validateProjectDetailed(
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
      expectMockIssue(
        result,
        `${RULE_MOCK_PATH}/headers/1/name`,
        "uniqueMockHeaderName",
      );
    });

    it.each([
      ["absolute path", "/etc/passwd"],
      ["backslashes", "responses\\a.bin"],
      ["percent escape", "responses/%2e%2e/secret"],
      ["control character", "responses/\u0001.bin"],
      ["dot segment", "responses/../secret.bin"],
      ["current-directory segment", "./responses/a.bin"],
      ["trailing slash", "responses/a.bin/"],
      ["empty segment", "responses//a.bin"],
      ["colon in segment", "responses/a:1.bin"],
      ["glob star", "responses/*.bin"],
      ["glob question", "responses/a?.bin"],
      ["glob bracket", "responses/a[0].bin"],
    ] as const)("rejects file path with %s", (_label, file) => {
      const result = validateProjectDetailed(
        projectWith(mockRule({ mock: { status: 200, file } })),
      );
      expectMockIssue(result, `${RULE_MOCK_PATH}/file`, "mock-file-path");
    });

    it("accepts a valid relative file path", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({ mock: { status: 200, file: "responses/not-found.bin" } }),
        ),
      );
      expect(result).toMatchObject({ valid: true });
    });

    it("does not leak file paths in diagnostics", () => {
      for (const badPath of [
        "/etc/passwd",
        "secret-dir/../leak-marker.bin",
        "secret-dir\\leak-marker.bin",
        "secret-dir/%2e%2e/leak-marker.bin",
        "secret-dir/*.bin",
      ]) {
        const result = validateProjectDetailed(
          projectWith(mockRule({ mock: { status: 200, file: badPath } })),
        );
        expect(result.valid).toBe(false);
        if (result.valid) return;
        const serialized = JSON.stringify(result.errors);
        expect(serialized).not.toContain("secret-dir");
        expect(serialized).not.toContain("passwd");
        expect(serialized).not.toContain("leak-marker");
      }
    });

    it("does not leak the path when body and file are both set", () => {
      const result = validateProjectDetailed(
        projectWith(
          mockRule({
            mock: { status: 200, body: "x", file: "secret-dir/a.bin" },
          }),
        ),
      );
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(JSON.stringify(result.errors)).not.toContain("secret-dir");
    });

    describe("adversarial input", () => {
      function keywords(result: ReturnType<typeof validateProjectDetailed>) {
        expect(result.valid).toBe(false);
        return result.valid ? [] : result.errors.map((error) => error.keyword);
      }

      it("ignores inherited mock fields", () => {
        const mock = Object.create({ body: "inherited" }) as { status: number };
        mock.status = 200;
        const result = validateProjectDetailed(projectWith(mockRule({ mock })));
        expectMockIssue(result, RULE_MOCK_PATH, "mock-body-source");
      });

      it("rejects accessor mock fields without invoking them", () => {
        let getterRead = false;
        const mock = { status: 200 } as Record<string, unknown>;
        Object.defineProperty(mock, "file", {
          enumerable: true,
          get: () => {
            getterRead = true;
            return "responses/a.bin";
          },
        });
        const result = validateProjectDetailed(projectWith(mockRule({ mock })));
        expect(keywords(result)).toEqual(["ownProperties"]);
        expect(getterRead).toBe(false);
      });

      it("rejects a throwing accessor on a header", () => {
        const header = { name: "X-A" } as Record<string, unknown>;
        Object.defineProperty(header, "value", {
          enumerable: true,
          get: () => {
            throw new Error("boom");
          },
        });
        const result = validateProjectDetailed(
          projectWith(
            mockRule({ mock: { status: 200, body: "x", headers: [header] } }),
          ),
        );
        expect(keywords(result)).toEqual(["ownProperties"]);
      });

      it("rejects a proxy-wrapped mock payload", () => {
        const target = { status: 200, body: "x" };
        const mock = new Proxy(target, {
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
        const result = validateProjectDetailed(projectWith(mockRule({ mock })));
        expect(keywords(result)).toEqual(["additionalProperties"]);
      });

      it("rejects a throwing proxy mock payload", () => {
        const mock = new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("boom");
            },
          },
        );
        const result = validateProjectDetailed(projectWith(mockRule({ mock })));
        expect(keywords(result)).toEqual(["ownProperties"]);
      });

      it("rejects cyclic mock references", () => {
        const mock: Record<string, unknown> = { status: 200, body: "x" };
        mock.self = mock;
        const result = validateProjectDetailed(projectWith(mockRule({ mock })));
        expect(keywords(result)).toEqual(["ownProperties"]);
      });

      it("rejects sparse header arrays and inherited entries", () => {
        const inherited = [] as { name: string; value: string }[];
        Object.setPrototypeOf(inherited, {
          0: { name: "X-Inherited", value: "v" },
        });
        inherited.length = 1;
        const sparse = new Array(2) as { name: string; value: string }[];
        sparse[1] = { name: "X-A", value: "v" };
        for (const headers of [inherited, sparse]) {
          const result = validateProjectDetailed(
            projectWith(
              mockRule({ mock: { status: 200, body: "x", headers } }),
            ),
          );
          expect(keywords(result)).toEqual(["ownProperties"]);
        }
      });

      it("treats prototype-named headers as ordinary names", () => {
        const headers = JSON.parse(
          '[{"name":"__proto__","value":"1"},{"name":"constructor","value":"2"},{"name":"toString","value":"3"}]',
        ) as unknown;
        const result = validateProjectDetailed(
          projectWith(mockRule({ mock: { status: 200, body: "x", headers } })),
        );
        expect(result).toMatchObject({ valid: true });
      });
    });
  });

  it("migrateV1Project does not introduce mock rules", () => {
    const v1 = {
      version: 1 as const,
      name: "Legacy",
      groups: [
        {
          id: "g1",
          name: "G1",
          origins: ["https://example.com"],
          rules: [
            {
              id: "r1",
              name: "Redirect",
              urlRegex: "^https://example\\.com/",
              origins: [],
              resourceTypes: ["main_frame"],
              priority: 100,
              type: "redirect",
              redirect: { destination: "https://other.example/" },
            },
          ],
        },
      ],
    };
    const result = migrateV1Project(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rule = result.project.groups[0]?.rules[0];
    expect(rule?.type).toBe("redirect");
    expect(rule).not.toHaveProperty("mock");
  });
});
