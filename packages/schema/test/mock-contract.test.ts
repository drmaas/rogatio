import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/limits.js";
import { projectSchema } from "../src/schema.js";

type SchemaNode = {
  readonly additionalProperties?: boolean;
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: readonly string[];
  readonly $defs?: Readonly<Record<string, SchemaNode>>;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly maxItems?: number;
  readonly items?: SchemaNode;
  readonly type?: string;
};

const schema = projectSchema as unknown as SchemaNode;
const rule = schema.$defs?.rule;
const mockAction = schema.$defs?.mockAction;

describe("mock rule contract", () => {
  it("pins the rule type enum and the mock action property set", () => {
    expect(rule?.additionalProperties).toBe(false);
    expect(rule?.properties?.type?.enum).toEqual([
      "redirect",
      "query",
      "header",
      "response-body",
      "request-body",
      "mock",
    ]);
    expect(mockAction?.additionalProperties).toBe(false);
    expect(mockAction?.required).toEqual(["status"]);
    expect(Object.keys(mockAction?.properties ?? {})).toEqual([
      "status",
      "headers",
      "delayMs",
      "body",
      "file",
    ]);
  });

  it("reads every mock bound from LIMITS", () => {
    const status = mockAction?.properties?.status;
    const headers = mockAction?.properties?.headers;
    const header = schema.$defs?.mockHeader;
    expect(status?.minimum).toBe(LIMITS.minMockStatus);
    expect(status?.maximum).toBe(LIMITS.maxMockStatus);
    expect(headers?.maxItems).toBe(LIMITS.maxMockHeadersPerRule);
    expect(header?.properties?.name?.maxLength).toBe(
      LIMITS.maxMockHeaderNameLength,
    );
    expect(header?.properties?.value?.maxLength).toBe(
      LIMITS.maxMockHeaderValueLength,
    );
    expect(mockAction?.properties?.body?.maxLength).toBe(
      LIMITS.maxMockInlineBodyLength,
    );
    expect(mockAction?.properties?.delayMs?.maximum).toBe(
      LIMITS.maxMockDelayMs,
    );
    expect(mockAction?.properties?.file?.maxLength).toBe(
      LIMITS.maxMockFilePathLength,
    );
  });
});
