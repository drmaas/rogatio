import { createMockRuleType } from "./mock.js";
import { queryRuleType } from "./query.js";

export { createMockRuleType, queryRuleType };
export const builtInRuleTypes = Object.freeze([
  queryRuleType,
  createMockRuleType(),
]);
