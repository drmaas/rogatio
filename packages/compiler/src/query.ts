import type { RogatioQueryAction } from "@rogatio/schema";

export interface DnrQueryParam {
  readonly name: string;
  readonly value: string;
  readonly replaceOnly: false;
}

export function queryParamsToDNR(action: RogatioQueryAction): DnrQueryParam[] {
  return action.params.map((param) => ({
    name: param.name,
    value: param.value,
    replaceOnly: false,
  }));
}

export function applyQueryTransform(
  url: string,
  action: RogatioQueryAction,
): string {
  const target = new URL(url);
  const actionByName = new Map<string, string>();
  for (const param of action.params) actionByName.set(param.name, param.value);

  const existing: Array<[string, string]> = [];
  for (const [key, value] of target.searchParams) existing.push([key, value]);

  const replaced = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const [key, value] of existing) {
    if (actionByName.has(key)) {
      if (!replaced.has(key)) {
        replaced.add(key);
        out.push([key, actionByName.get(key) as string]);
      }
      continue;
    }
    out.push([key, value]);
  }
  for (const param of action.params) {
    if (!replaced.has(param.name)) out.push([param.name, param.value]);
  }

  const result = new URLSearchParams();
  for (const [key, value] of out) result.append(key, value);

  const query = result.toString();
  return `${target.origin}${target.pathname}${
    query ? `?${query}` : ""
  }${target.hash}`;
}
