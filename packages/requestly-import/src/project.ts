import {
  deriveEntityId,
  type EntityKind,
  LIMITS,
  normalizeNameKey,
  PROJECT_VERSION,
  type RogatioGroup,
  type RogatioProject,
  type RogatioRule,
  uniqueName,
} from "@rogatio/schema";
import { type MappedDraft, mapRequestlyRule } from "./map.js";
import {
  type ParsedRule,
  type ParsedUnknown,
  parseRequestlyExport,
} from "./parse.js";
import { cleanLabel, displayName, ownString } from "./record.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UNGROUPED_NAME = "Ungrouped";
const INACTIVE_CHANGE =
  "The rule was inactive in Requestly. Rogatio project files have no disabled flag, so the rule is active.";
const DESCRIPTION_CHANGE = "The rule description was not imported.";
const MISSING_GROUP_CHANGE =
  "The rule's group was not in the export. It was placed in Ungrouped.";
const PRIORITY_NOTE =
  "Priorities were assigned from 1000 downward in export order so an earlier rule wins.";
const PRIORITY_FLOOR_NOTE =
  "More than 1000 rules were imported, so the remaining rules share priority 1.";

export interface ImportReportRow {
  readonly requestlyId?: string;
  readonly name: string;
  readonly ruleType: string;
  readonly status: "imported" | "changed" | "skipped";
  readonly changes?: readonly string[];
  readonly reason?: string;
  readonly rogatioRuleIds?: readonly string[];
}

export interface ImportReport {
  readonly imported: number;
  readonly changed: number;
  readonly skipped: number;
  readonly rules: readonly ImportReportRow[];
  readonly notes: readonly string[];
  readonly unknown: readonly ParsedUnknown[];
}

export type ImportResult =
  | {
      readonly ok: true;
      readonly project: RogatioProject;
      readonly report: ImportReport;
    }
  | { readonly ok: false; readonly error: string };

interface GroupBucket {
  readonly requestlyId: string | undefined;
  id: string;
  name: string;
  readonly inactive: boolean;
  readonly rules: RogatioRule[];
}

function emptyBucket(): GroupBucket {
  return {
    requestlyId: undefined,
    id: "",
    name: "",
    inactive: false,
    rules: [],
  };
}

interface PlacedRule {
  readonly drafts: readonly MappedDraft[];
  readonly changes: string[];
  readonly reason?: string;
  readonly bucket: GroupBucket;
}

export function importRequestlyExport(value: unknown): ImportResult {
  const parsed = parseRequestlyExport(value);
  if (!parsed.ok) return parsed;

  const ids = new Set<string>();
  const names = new Set<string>();
  const buckets = new Map<string, GroupBucket>();
  const ordered: GroupBucket[] = [];

  for (const group of parsed.export.groups) {
    if (buckets.has(group.id)) continue;
    const name = uniqueName(group.name, names);
    const id = takeId(group.id, name, "group", ids, true);
    const bucket: GroupBucket = {
      requestlyId: group.id,
      id,
      name,
      inactive: group.status === "Inactive",
      rules: [],
    };
    buckets.set(group.id, bucket);
    ordered.push(bucket);
  }

  let ungrouped: GroupBucket | undefined;
  const ensureUngrouped = (): GroupBucket => {
    if (ungrouped !== undefined) return ungrouped;
    const name = uniqueName(UNGROUPED_NAME, names);
    const id = takeId("Ungrouped", name, "group", ids, true);
    ungrouped = {
      requestlyId: undefined,
      id,
      name,
      inactive: false,
      rules: [],
    };
    return ungrouped;
  };

  const rows: ImportReportRow[] = [];
  let priority: number = LIMITS.maxPriority;
  let assignedAtFloor = 0;
  let produced = 0;

  for (const rule of parsed.export.rules) {
    const placed = placeRule(rule, buckets, ensureUngrouped);
    const changes = [...placed.changes];
    const rogatioRuleIds: string[] = [];
    for (const draft of placed.drafts) {
      const labeled =
        draft.nameSuffix.length > 0
          ? `${cleanLabel(rule.name, "Imported rule")} (${draft.nameSuffix})`
          : cleanLabel(rule.name, "Imported rule");
      const storedName = uniqueName(labeled, names);
      if (storedName !== labeled) {
        changes.push(
          `The name was already used and was renamed to "${storedName}".`,
        );
      }
      const id = takeId(rule.id, storedName, "rule", ids, draft.keepId);
      if (draft.keepId && rule.id !== undefined && id !== rule.id) {
        changes.push(
          isRogatioId(rule.id)
            ? `The Requestly id "${rule.id}" was already used and became "${id}".`
            : `The Requestly id "${rule.id}" is not a Rogatio id and became "${id}".`,
        );
      }
      const next = priority;
      if (next === LIMITS.minPriority) assignedAtFloor += 1;
      else priority -= 1;
      produced += 1;
      rogatioRuleIds.push(id);
      placed.bucket.rules.push({
        ...draft.rule,
        id,
        name: storedName,
        priority: next,
        resourceTypes: [...draft.rule.resourceTypes],
      });
    }

    if (placed.drafts.length === 0) {
      rows.push({
        ...(rule.id === undefined ? {} : { requestlyId: rule.id }),
        name: displayName(rule.name),
        ruleType: rule.ruleType.length > 0 ? rule.ruleType : "unknown",
        status: "skipped",
        reason: placed.reason ?? "The rule was not imported.",
      });
      continue;
    }

    const uniqueChanges = dedupe(changes);
    rows.push({
      ...(rule.id === undefined ? {} : { requestlyId: rule.id }),
      name: displayName(rule.name),
      ruleType: rule.ruleType.length > 0 ? rule.ruleType : "unknown",
      status: uniqueChanges.length === 0 ? "imported" : "changed",
      ...(uniqueChanges.length === 0 ? {} : { changes: uniqueChanges }),
      rogatioRuleIds,
    });
  }

  for (const record of parsed.export.unknown) {
    rows.push({
      name: record.name,
      ruleType: record.type,
      status: "skipped",
      reason: "The record is not a Requestly rule.",
    });
  }

  if (ungrouped !== undefined && ungrouped.rules.length > 0) {
    ordered.push(ungrouped);
  }

  const groups = ordered.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    rules: bucket.rules,
  }));
  const limited = limitError(groups);
  if (limited !== undefined) return { ok: false, error: limited };

  const notes: string[] = [];
  if (produced > 0) notes.push(PRIORITY_NOTE);
  if (assignedAtFloor > 1) notes.push(PRIORITY_FLOOR_NOTE);

  return {
    ok: true,
    project: {
      version: PROJECT_VERSION,
      name: "Imported from Requestly",
      description: "Imported from a Requestly export.",
      groups,
    },
    report: summarize(rows, notes, parsed.export.unknown),
  };
}

function placeRule(
  rule: ParsedRule,
  buckets: ReadonlyMap<string, GroupBucket>,
  ensureUngrouped: () => GroupBucket,
): PlacedRule {
  const mapped = mapRequestlyRule(rule.raw);
  const known = rule.groupId.length > 0 ? buckets.get(rule.groupId) : undefined;
  const missingGroup = rule.groupId.length > 0 && known === undefined;
  if (mapped.status === "skipped") {
    return {
      drafts: [],
      changes: [],
      reason: mapped.reason,
      bucket: known ?? emptyBucket(),
    };
  }
  const bucket = known ?? ensureUngrouped();
  const changes = [...mapped.changes];
  if (ownString(rule.raw, "status") === "Inactive" || bucket.inactive) {
    changes.push(INACTIVE_CHANGE);
  }
  const description = ownString(rule.raw, "description") ?? "";
  if (description.trim().length > 0) changes.push(DESCRIPTION_CHANGE);
  if (missingGroup) changes.push(MISSING_GROUP_CHANGE);
  return { drafts: mapped.drafts, changes, bucket };
}

function summarize(
  rows: readonly ImportReportRow[],
  notes: readonly string[],
  unknown: readonly ParsedUnknown[],
): ImportReport {
  let imported = 0;
  let changed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status === "imported") imported += 1;
    else if (row.status === "changed") changed += 1;
    else skipped += 1;
  }
  return { imported, changed, skipped, rules: rows, notes, unknown };
}

export function isRogatioId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= LIMITS.maxIdLength &&
    ID_PATTERN.test(value)
  );
}

function takeId(
  preferred: string | undefined,
  name: string,
  kind: EntityKind,
  reserved: Set<string>,
  keep: boolean,
): string {
  if (
    keep &&
    preferred !== undefined &&
    isRogatioId(preferred) &&
    !reserved.has(preferred)
  ) {
    reserved.add(preferred);
    return preferred;
  }
  return deriveEntityId(name, kind, reserved);
}

export function limitError(
  groups: readonly RogatioGroup[],
): string | undefined {
  if (groups.length > LIMITS.maxGroups) {
    return `The import needs ${groups.length} groups, above the limit of ${LIMITS.maxGroups}.`;
  }
  let total = 0;
  for (const group of groups) {
    if (group.rules.length > LIMITS.maxRulesPerGroup) {
      return `Group "${group.name}" has ${group.rules.length} rules, above the limit of ${LIMITS.maxRulesPerGroup}.`;
    }
    total += group.rules.length;
  }
  if (total > LIMITS.maxRulesPerProject) {
    return `The import has ${total} rules, above the limit of ${LIMITS.maxRulesPerProject}.`;
  }
  return undefined;
}

function dedupe(changes: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const change of changes) {
    if (seen.has(change)) continue;
    seen.add(change);
    result.push(change);
  }
  return result;
}

export function collectIdentity(project: RogatioProject): {
  ids: Set<string>;
  names: Set<string>;
} {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const group of project.groups) {
    ids.add(group.id);
    names.add(normalizeNameKey(group.name));
    for (const rule of group.rules) {
      ids.add(rule.id);
      names.add(normalizeNameKey(rule.name));
    }
  }
  return { ids, names };
}
