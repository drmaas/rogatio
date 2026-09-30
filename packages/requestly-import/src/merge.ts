import {
  deriveEntityId,
  PROJECT_VERSION,
  type RogatioGroup,
  type RogatioProject,
  type RogatioRule,
  uniqueName,
} from "@rogatio/schema";
import { collectIdentity, isRogatioId, limitError } from "./project.js";

export type MergeResult =
  | {
      readonly ok: true;
      readonly project: RogatioProject;
      readonly renamed: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

export function mergeProjects(
  existing: RogatioProject,
  imported: RogatioProject,
): MergeResult {
  const current = cloneProject(existing);
  if (current === undefined) {
    return {
      ok: false,
      error: "The existing project is not a version-2 Rogatio project.",
    };
  }
  const incoming = cloneProject(imported);
  if (incoming === undefined) {
    return { ok: false, error: "The imported project is not JSON data." };
  }

  const { ids, names } = collectIdentity(current);
  const renamed: string[] = [];
  const appended: RogatioGroup[] = [];

  for (const group of incoming.groups) {
    const name = uniqueName(group.name, names);
    if (name !== group.name) {
      renamed.push(
        `Imported group name "${group.name}" was already used and became "${name}".`,
      );
    }
    const id = retakeId(group.id, name, "group", ids, renamed, "group");
    const rules: RogatioRule[] = [];
    for (const rule of group.rules) {
      const ruleName = uniqueName(rule.name, names);
      if (ruleName !== rule.name) {
        renamed.push(
          `Imported rule name "${rule.name}" was already used and became "${ruleName}".`,
        );
      }
      const ruleId = retakeId(rule.id, ruleName, "rule", ids, renamed, "rule");
      rules.push({ ...rule, id: ruleId, name: ruleName });
    }
    appended.push({ id, name, rules });
  }

  const groups = [...current.groups, ...appended];
  const limited = limitError(groups);
  if (limited !== undefined) return { ok: false, error: limited };

  const project: RogatioProject = {
    version: PROJECT_VERSION,
    name: current.name,
    ...(current.description === undefined
      ? {}
      : { description: current.description }),
    groups,
    ...(current.requestBodyPolicy === undefined
      ? {}
      : { requestBodyPolicy: current.requestBodyPolicy }),
  };
  return { ok: true, project, renamed };
}

function retakeId(
  preferred: string,
  name: string,
  kind: "group" | "rule",
  reserved: Set<string>,
  renamed: string[],
  label: "group" | "rule",
): string {
  if (isRogatioId(preferred) && !reserved.has(preferred)) {
    reserved.add(preferred);
    return preferred;
  }
  const next = deriveEntityId(name, kind, reserved);
  renamed.push(
    isRogatioId(preferred)
      ? `Imported ${label} id "${preferred}" was already used and became "${next}".`
      : `Imported ${label} id "${preferred}" is not a Rogatio id and became "${next}".`,
  );
  return next;
}

function cloneProject(value: RogatioProject): RogatioProject | undefined {
  let cloned: unknown;
  try {
    cloned = JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
    return undefined;
  }
  const record = cloned as Record<string, unknown>;
  if (record.version !== PROJECT_VERSION || typeof record.name !== "string") {
    return undefined;
  }
  if (!Array.isArray(record.groups)) return undefined;
  return record as unknown as RogatioProject;
}
