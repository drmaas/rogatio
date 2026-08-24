import type { JSONSchemaType } from "ajv";
import { LIMITS } from "./limits.js";
import type { RogatioProject } from "./types.js";
import { HTTP_METHODS, PROJECT_VERSION, RESOURCE_TYPES } from "./types.js";

const label = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.maxLabelLength,
  pattern: "\\S",
} as const;

const id = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.maxIdLength,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
} as const;

const projectSchemaDefinition = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://rogatio.dev/schema/project-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["version", "name", "groups"],
  properties: {
    version: { type: "integer", const: PROJECT_VERSION },
    name: label,
    description: {
      type: "string",
      maxLength: LIMITS.maxDescriptionLength,
    },
    groups: {
      type: "array",
      maxItems: LIMITS.maxGroups,
      items: { $ref: "#/$defs/group" },
    },
  },
  $defs: {
    group: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "origins", "rules"],
      properties: {
        id,
        name: label,
        origins: {
          type: "array",
          maxItems: LIMITS.maxOriginsPerScope,
          uniqueItems: true,
          items: { type: "string", format: "rogatio-origin" },
        },
        rules: {
          type: "array",
          maxItems: LIMITS.maxRulesPerGroup,
          items: { $ref: "#/$defs/rule" },
        },
      },
    },
    rule: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "name",
        "urlRegex",
        "origins",
        "resourceTypes",
        "priority",
      ],
      properties: {
        id,
        name: label,
        urlRegex: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxUrlRegexLength,
          format: "rogatio-url-regex",
        },
        origins: {
          type: "array",
          maxItems: LIMITS.maxOriginsPerScope,
          uniqueItems: true,
          items: { type: "string", format: "rogatio-origin" },
        },
        resourceTypes: {
          type: "array",
          minItems: 1,
          maxItems: LIMITS.maxResourceTypesPerRule,
          uniqueItems: true,
          items: { type: "string", enum: [...RESOURCE_TYPES] },
        },
        priority: {
          type: "integer",
          minimum: LIMITS.minPriority,
          maximum: LIMITS.maxPriority,
        },
        method: { type: "string", enum: [...HTTP_METHODS] },
        type: { type: "string", enum: ["redirect", "query", "header", "mock"] },
        redirect: {
          type: "object",
          additionalProperties: false,
          required: ["destination"],
          properties: {
            destination: { type: "string" },
          },
        },
        action: { $ref: "#/$defs/queryAction" },
        headerDirection: { type: "string", enum: ["request", "response"] },
        headerOperation: { type: "string", enum: ["set", "append", "remove"] },
        headerName: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxHeaderNameLength,
        },
        headerValue: {
          type: "string",
          maxLength: LIMITS.maxHeaderValueLength,
        },
        mock: { $ref: "#/$defs/mockAction" },
      },
      allOf: [
        {
          if: {
            required: ["type"],
            properties: { type: { const: "redirect" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["redirect"],
          },
        },
        {
          if: {
            required: ["type"],
            properties: { type: { const: "query" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["action"],
          },
        },
        {
          if: {
            required: ["type"],
            properties: { type: { const: "header" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["headerDirection", "headerOperation", "headerName"],
          },
        },
        {
          if: {
            required: ["type"],
            properties: { type: { const: "mock" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["mock"],
          },
        },
        {
          if: {
            required: ["headerOperation"],
            properties: { headerOperation: { const: "set" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["headerValue"],
          },
        },
        {
          if: {
            required: ["headerOperation"],
            properties: { headerOperation: { const: "append" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["headerValue"],
          },
        },
        {
          if: {
            required: ["headerOperation"],
            properties: { headerOperation: { const: "remove" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            not: { required: ["headerValue"] },
          },
        },
      ],
    },
    queryParam: {
      type: "object",
      additionalProperties: false,
      required: ["name", "value"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxQueryNameLength,
        },
        value: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxQueryValueLength,
        },
      },
    },
    queryAction: {
      type: "object",
      additionalProperties: false,
      required: ["type", "params"],
      properties: {
        type: { const: "query" },
        params: {
          type: "array",
          minItems: 1,
          maxItems: LIMITS.maxQueryParamsPerRule,
          items: { $ref: "#/$defs/queryParam" },
        },
      },
    },
    mockHeader: {
      type: "object",
      additionalProperties: false,
      required: ["name", "value"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxMockHeaderNameLength,
        },
        value: {
          type: "string",
          maxLength: LIMITS.maxMockHeaderValueLength,
        },
      },
    },
    mockAction: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: {
          type: "integer",
          minimum: LIMITS.minMockStatus,
          maximum: LIMITS.maxMockStatus,
        },
        headers: {
          type: "array",
          maxItems: LIMITS.maxMockHeadersPerRule,
          items: { $ref: "#/$defs/mockHeader" },
        },
        delayMs: {
          type: "integer",
          minimum: 0,
          maximum: LIMITS.maxMockDelayMs,
        },
        body: {
          type: "string",
          maxLength: LIMITS.maxMockInlineBodyLength,
        },
        file: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxMockFilePathLength,
        },
      },
    },
  },
} as const;

// Ajv's JSONSchemaType cannot infer named `$defs` references, so validate the
// root data type while retaining the complete draft-2020-12 runtime schema.
export const projectSchema =
  projectSchemaDefinition as unknown as JSONSchemaType<RogatioProject>;
