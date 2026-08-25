import { createMockRuleType } from "./mock.js";
import { queryRuleType } from "./query.js";
import { createResponseBodyRuleType } from "./response-body.js";

export { createMockRuleType, createResponseBodyRuleType, queryRuleType };
export const builtInRuleTypes = Object.freeze([
  queryRuleType,
  createMockRuleType(),
  createResponseBodyRuleType(),
]);
