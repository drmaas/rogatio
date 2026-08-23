import type { MatcherOperation } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";

export const project: RogatioProject = {
  version: 1,
  name: "F7 test project",
  groups: [
    {
      id: "group-a",
      name: "Group A",
      origins: ["https://example.com"],
      rules: [
        {
          id: "rule-a",
          name: "Rule A",
          urlRegex: "^https://example\\.com/",
          origins: [],
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
  matcher: {
    urlRegex: { source: project.groups[0].rules[0].urlRegex, flags: "" },
    origins: ["https://example.com"],
    resourceTypes: ["main_frame", "script"],
    priority: 100,
    method: "GET",
  },
};
