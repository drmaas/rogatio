import { cleanLabel, displayName, isRecord, ownString } from "./record.js";
import { asRecords, snapshotJson } from "./snapshot.js";

export interface ParsedRule {
  readonly raw: Record<string, unknown>;
  readonly id: string | undefined;
  readonly name: string;
  readonly ruleType: string;
  readonly groupId: string;
}

export interface ParsedGroup {
  readonly id: string;
  readonly name: string;
  readonly status: string | undefined;
}

export interface ParsedUnknown {
  readonly name: string;
  readonly type: string;
}

export interface ParsedExport {
  readonly groups: readonly ParsedGroup[];
  readonly rules: readonly ParsedRule[];
  readonly unknown: readonly ParsedUnknown[];
}

export type ParseResult =
  | { readonly ok: true; readonly export: ParsedExport }
  | { readonly ok: false; readonly error: string };

export function parseRequestlyExport(value: unknown): ParseResult {
  const snapshot = snapshotJson(value);
  if (!snapshot.ok) return snapshot;
  const records = rootRecords(snapshot.value);
  if (records === null) {
    return {
      ok: false,
      error:
        "Requestly export must be a JSON array of rules and groups, a single rule, or an object with a rules array.",
    };
  }

  const groups: ParsedGroup[] = [];
  const rules: ParsedRule[] = [];
  const unknown: ParsedUnknown[] = [];
  const seenRuleIds = new Set<string>();

  const addRule = (record: Record<string, unknown>, groupId: string): void => {
    const id = ownString(record, "id");
    if (id !== undefined && id.length > 0) {
      if (seenRuleIds.has(id)) return;
      seenRuleIds.add(id);
    }
    const ruleType = ownString(record, "ruleType") ?? "";
    rules.push({
      raw: record,
      id: id !== undefined && id.length > 0 ? id : undefined,
      name: ownString(record, "name") ?? "",
      ruleType,
      groupId,
    });
  };

  for (const record of records) {
    const objectType = ownString(record, "objectType");
    if (objectType === "group") {
      const id = ownString(record, "id");
      if (id === undefined || id.length === 0) {
        unknown.push({
          name: displayName(ownString(record, "name") ?? ""),
          type: "group",
        });
        continue;
      }
      groups.push({
        id,
        name: cleanLabel(ownString(record, "name") ?? "", "Imported group"),
        status: ownString(record, "status"),
      });
      const children = record.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (!isRecord(child)) continue;
          const childType = ownString(child, "objectType");
          const childRuleType = ownString(child, "ruleType");
          if (childType === "group" || childRuleType === undefined) continue;
          const childGroup = ownString(child, "groupId");
          addRule(
            child,
            childGroup !== undefined && childGroup.length > 0 ? childGroup : id,
          );
        }
      }
      continue;
    }

    if (objectType === "rule" || ownString(record, "ruleType") !== undefined) {
      addRule(record, ownString(record, "groupId") ?? "");
      continue;
    }

    unknown.push({
      name: displayName(ownString(record, "name") ?? ""),
      type: objectType ?? "unknown",
    });
  }

  return { ok: true, export: { groups, rules, unknown } };
}

function rootRecords(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) return asRecords(value);
  if (!isRecord(value)) return null;
  if (
    ownString(value, "objectType") === "rule" ||
    ownString(value, "ruleType") !== undefined
  ) {
    return [value];
  }
  if (!Object.hasOwn(value, "rules")) return null;
  const rules = asRecords(value.rules);
  if (rules === null) return null;
  const groupsValue = Object.hasOwn(value, "groups")
    ? value.groups
    : Object.hasOwn(value, "updatedGroups")
      ? value.updatedGroups
      : [];
  if (groupsValue === undefined) return rules;
  if (!Array.isArray(groupsValue)) return null;
  const groups = asRecords(groupsValue);
  if (groups === null) return null;
  return [...rules, ...groups];
}
