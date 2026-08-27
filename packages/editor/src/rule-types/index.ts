import { createMockRuleType } from "./mock.js";
import { queryRuleType } from "./query.js";
import { createRequestBodyRuleType } from "./request-body.js";
import { createResponseBodyRuleType } from "./response-body.js";

export {
  createMockRuleType,
  createRequestBodyRuleType,
  createResponseBodyRuleType,
  queryRuleType,
};
export const builtInRuleTypes = Object.freeze([
  queryRuleType,
  createMockRuleType(),
  createResponseBodyRuleType(),
  createRequestBodyRuleType(),
]);
