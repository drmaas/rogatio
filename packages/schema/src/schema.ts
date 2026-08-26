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
    requestBodyPolicy: { $ref: "#/$defs/requestBodyPolicyConfig" },
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
        type: {
          type: "string",
          enum: [
            "redirect",
            "query",
            "header",
            "mock",
            "response-body",
            "request-body",
          ],
        },
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
        responseBody: { $ref: "#/$defs/responseBodyAction" },
        requestBody: { $ref: "#/$defs/requestBodyAction" },
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
            required: ["type"],
            properties: { type: { const: "response-body" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["responseBody"],
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
            required: ["type"],
            properties: { type: { const: "response-body" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["responseBody"],
          },
        },
        {
          if: {
            required: ["type"],
            properties: { type: { const: "request-body" } },
          },
          // biome-ignore lint/suspicious/noThenProperty: AJV conditional schema keyword
          then: {
            required: ["requestBody", "method", "resourceTypes"],
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
    responseBodyReplacement: {
      type: "object",
      additionalProperties: false,
      required: ["pattern", "replacement"],
      properties: {
        pattern: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxResponseBodyPatternLength,
          format: "rogatio-url-regex",
        },
        replacement: {
          type: "string",
          maxLength: LIMITS.maxResponseBodyReplacementLength,
        },
      },
    },
    responseBodyAction: {
      type: "object",
      additionalProperties: false,
      required: ["replacements"],
      properties: {
        replacements: {
          type: "array",
          minItems: 1,
          maxItems: LIMITS.maxResponseBodyReplacements,
          items: { $ref: "#/$defs/responseBodyReplacement" },
        },
      },
    },
    requestBodyReplaceAction: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "body"],
      properties: {
        mode: { const: "replace" },
        body: {
          type: "string",
          maxLength: LIMITS.maxRequestBodyBytes,
        },
      },
    },
    requestBodyRegexAction: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "pattern", "replacement"],
      properties: {
        mode: { const: "regex" },
        pattern: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.maxRequestBodyPatternLength,
          format: "rogatio-url-regex",
        },
        replacement: {
          type: "string",
          maxLength: LIMITS.maxRequestBodyReplacementLength,
        },
      },
    },
    requestBodyAction: {
      oneOf: [
        { $ref: "#/$defs/requestBodyReplaceAction" },
        { $ref: "#/$defs/requestBodyRegexAction" },
      ],
    },
    requestBodyPolicyConfig: {
      type: "object",
      additionalProperties: false,
      properties: {
        localOrigins: {
          type: "array",
          maxItems: LIMITS.maxLocalOrigins,
          uniqueItems: true,
          items: { type: "string", format: "rogatio-origin" },
        },
      },
    },
  },
} as const;

// Ajv's JSONSchemaType cannot infer named `$defs` references, so validate the
// root data type while retaining the complete draft-2020-12 runtime schema.
export const projectSchema =
  projectSchemaDefinition as unknown as JSONSchemaType<RogatioProject>;
