import type { MatcherOperation } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";

export const project: RogatioProject = {
  version: 2,
  name: "F7 test project",
  groups: [
    {
      id: "group-a",
      name: "Group A",
      rules: [
        {
          id: "rule-a",
          name: "Rule A",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/",
          },
          resourceTypes: ["main_frame", "script"],
          priority: 100,
          method: "GET",
        },
      ],
    },
  ],
};

export const operation: MatcherOperation = {
  kind: "matcher",
  groupId: "group-a",
  ruleId: "rule-a",
  name: "Rule A",
  redactSensitiveInLogs: false,
  matcher: {
    source: {
      key: "url",
      operator: "regex",
      value: "^https://example\\.com/",
    },
    resourceTypes: ["main_frame", "script"],
    priority: 100,
    method: "GET",
  },
};
