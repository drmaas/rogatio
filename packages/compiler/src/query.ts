import type { RogatioQueryAction } from "@rogatio/schema";

export interface DnrQueryParam {
  /** Chrome Declarative Net Request QueryKeyValue.key */
  readonly key: string;
  readonly value: string;
  readonly replaceOnly: false;
}

export interface DnrQueryTransform {
  addOrReplaceParams?: DnrQueryParam[];
  removeParams?: string[];
}

function resolveQueryParamOperation(
  param: RogatioQueryAction["params"][number],
): "set" | "remove" {
  return param.operation ?? "set";
}

export function queryActionToDNR(
  action: RogatioQueryAction,
): DnrQueryTransform {
  const addOrReplaceParams: DnrQueryParam[] = [];
  const removeParams: string[] = [];

  for (const param of action.params) {
    if (resolveQueryParamOperation(param) === "remove") {
      removeParams.push(param.name);
      continue;
    }
    if (typeof param.value !== "string") continue;
    addOrReplaceParams.push({
      key: param.name,
      value: param.value,
      replaceOnly: false,
    });
  }

  const result: DnrQueryTransform = {};
  if (addOrReplaceParams.length > 0) {
    result.addOrReplaceParams = addOrReplaceParams;
  }
  if (removeParams.length > 0) {
    result.removeParams = removeParams;
  }
  return result;
}

export function applyQueryTransform(
  url: string,
  action: RogatioQueryAction,
): string {
  const target = new URL(url);
  const { addOrReplaceParams = [], removeParams = [] } =
    queryActionToDNR(action);
  const removeNames = new Set(removeParams);
  const setByName = new Map<string, string>();
  for (const param of addOrReplaceParams) {
    setByName.set(param.key, param.value);
  }

  const existing: Array<[string, string]> = [];
  for (const [key, value] of target.searchParams) existing.push([key, value]);

  const replaced = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const [key, value] of existing) {
    if (removeNames.has(key)) continue;
    if (setByName.has(key)) {
      if (!replaced.has(key)) {
        replaced.add(key);
        out.push([key, setByName.get(key) as string]);
      }
      continue;
    }
    out.push([key, value]);
  }
  for (const [name, value] of setByName) {
    if (!replaced.has(name)) out.push([name, value]);
  }

  const result = new URLSearchParams();
  for (const [key, value] of out) result.append(key, value);

  const query = result.toString();
  return `${target.origin}${target.pathname}${
    query ? `?${query}` : ""
  }${target.hash}`;
}
