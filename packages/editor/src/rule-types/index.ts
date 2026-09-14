import { createHeaderRuleType } from "./header.js";
import { createMockRuleType } from "./mock.js";
import { queryRuleType } from "./query.js";
import { createRedirectRuleType } from "./redirect.js";
import { createRequestBodyRuleType } from "./request-body.js";
import { createResponseBodyRuleType } from "./response-body.js";

export {
  createHeaderRuleType,
  createMockRuleType,
  createRedirectRuleType,
  createRequestBodyRuleType,
  createResponseBodyRuleType,
  queryRuleType,
};
export const builtInRuleTypes = Object.freeze([
  createHeaderRuleType(),
  createRedirectRuleType(),
  queryRuleType,
  createMockRuleType(),
  createResponseBodyRuleType(),
  createRequestBodyRuleType(),
]);
