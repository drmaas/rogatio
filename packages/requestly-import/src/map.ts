import {
  type HttpMethod,
  hasLoneSurrogate,
  isForbiddenHeader,
  LIMITS,
  type ResourceType,
  type RogatioQueryParam,
  type RogatioRule,
  type SourceCondition,
  validateRedirectDestination,
} from "@rogatio/schema";
import { isRecord, ownBoolean, ownString } from "./record.js";
import { mapReplace } from "./replace.js";
import { convertSource, type ResolvedFilters, readFilters } from "./source.js";

const REQUEST_BODY_METHODS = ["POST", "PUT", "PATCH"] as const;
const DYNAMIC_FUNCTION = /rq_[A-Za-z0-9_]*\s*\(/;

export interface MappedDraft {
  readonly nameSuffix: string;
  readonly keepId: boolean;
  readonly rule: Omit<RogatioRule, "id" | "name" | "priority">;
}

export type MapResult =
  | {
      readonly status: "mapped";
      readonly drafts: readonly MappedDraft[];
      readonly changes: readonly string[];
    }
  | { readonly status: "skipped"; readonly reason: string };

export function mapRequestlyRule(rule: Record<string, unknown>): MapResult {
  const ruleType = ownString(rule, "ruleType") ?? "";
  if (ruleType === "Cancel") {
    return { status: "skipped", reason: "Cancel rules are not supported." };
  }
  if (ruleType === "Delay") {
    return { status: "skipped", reason: "Delay rules are not supported." };
  }
  if (ruleType === "Script") {
    return { status: "skipped", reason: "Script rules are not supported." };
  }
  if (ruleType === "Redirect") return mapRedirect(rule);
  if (ruleType === "Replace") return mapReplaceRule(rule);
  if (ruleType === "QueryParam") return mapQuery(rule);
  if (ruleType === "Headers") return mapHeaders(rule);
  if (ruleType === "UserAgent") return mapUserAgent(rule);
  if (ruleType === "Request") return mapRequest(rule);
  if (ruleType === "Response") return mapResponse(rule);
  if (ruleType.length === 0) {
    return { status: "skipped", reason: "The rule type is missing." };
  }
  return {
    status: "skipped",
    reason: `Unsupported rule type "${ruleType}".`,
  };
}

function mapRedirect(rule: Record<string, unknown>): MapResult {
  const pairs = readPairs(rule);
  if (!pairs.ok) return { status: "skipped", reason: pairs.reason };
  const drafts: MappedDraft[] = [];
  const changes: string[] = [];
  const failures: string[] = [];
  if (ownBoolean(rule, "preserveCookie") === true) {
    changes.push("preserveCookie was not imported.");
  }
  for (const pair of pairs.pairs) {
    const built = buildRedirectPair(pair);
    if (!built.ok) {
      failures.push(built.reason);
      continue;
    }
    changes.push(...built.changes);
    drafts.push(...built.drafts);
  }
  if (drafts.length === 0) {
    return {
      status: "skipped",
      reason: failures[0] ?? "The redirect rule has no supported pairs.",
    };
  }
  if (pairs.pairs.length > 1) {
    changes.unshift(
      "Redirect pairs were split into separate rules. Requestly applies pairs in sequence to the rewritten URL; each imported rule matches the original request.",
    );
  }
  return { status: "mapped", drafts: tagIds(drafts), changes: dedupe(changes) };
}

function buildRedirectPair(pair: Record<string, unknown>):
  | {
      readonly ok: true;
      readonly drafts: readonly MappedDraft[];
      readonly changes: string[];
    }
  | { readonly ok: false; readonly reason: string } {
  const destinationType = ownString(pair, "destinationType") ?? "url";
  if (
    destinationType === "map_local" ||
    destinationType === "mock_or_file_picker"
  ) {
    return {
      ok: false,
      reason: "A local-file or mock redirect destination is not supported.",
    };
  }
  if (destinationType !== "url") {
    return {
      ok: false,
      reason: `Unsupported redirect destination type "${destinationType}".`,
    };
  }
  const destination = ownString(pair, "destination");
  if (destination === undefined || destination.length === 0) {
    return { ok: false, reason: "The redirect destination is missing." };
  }
  const prepared = preparePair(pair);
  if (!prepared.ok) return prepared;
  const rewritten = rewriteDestination(destination);
  const issues = validateRedirectDestination(
    rewritten.destination,
    prepared.source.value,
  );
  if (issues.length > 0) {
    return {
      ok: false,
      reason:
        "The redirect destination is not an absolute http(s) URL. Capture groups cannot stand in for the scheme or host.",
    };
  }
  const applied = applyMethods(prepared, {
    source: prepared.base.source,
    resourceTypes: prepared.base.resourceTypes,
    type: "redirect",
    redirect: { destination: rewritten.destination },
  });
  const changes = [
    ...prepared.changes,
    ...rewritten.changes,
    ...applied.changes,
  ];
  noteDynamic(destination, changes);
  return { ok: true, changes, drafts: applied.drafts };
}

function mapReplaceRule(rule: Record<string, unknown>): MapResult {
  const pairs = readPairs(rule);
  if (!pairs.ok) return { status: "skipped", reason: pairs.reason };
  const drafts: MappedDraft[] = [];
  const changes: string[] = [];
  const failures: string[] = [];
  for (const pair of pairs.pairs) {
    const source = pairSource(pair);
    if (!source.ok) {
      failures.push(source.reason);
      continue;
    }
    const from = ownString(pair, "from");
    const to = ownString(pair, "to");
    if (from === undefined || to === undefined) {
      failures.push("The replace pair is missing from or to.");
      continue;
    }
    const replaced = mapReplace(source.source, from, to);
    if (!replaced.ok) {
      failures.push(replaced.reason);
      continue;
    }
    const prepared = preparePair(pair);
    if (!prepared.ok) {
      failures.push(prepared.reason);
      continue;
    }
    changes.push(...prepared.filterChanges, ...replaced.changes);
    for (const redirect of replaced.redirects) {
      const applied = applyMethods(
        prepared,
        {
          source: redirect.source,
          resourceTypes: prepared.base.resourceTypes,
          type: "redirect",
          redirect: { destination: redirect.destination },
        },
        redirect.nameSuffix,
      );
      changes.push(...applied.changes);
      drafts.push(...applied.drafts);
    }
  }
  if (drafts.length === 0) {
    return {
      status: "skipped",
      reason: failures[0] ?? "The replace rule has no supported pairs.",
    };
  }
  if (pairs.pairs.length > 1) {
    changes.unshift(
      "Replace pairs were split into separate rules. Requestly applies pairs in sequence to the rewritten URL.",
    );
  }
  return { status: "mapped", drafts: tagIds(drafts), changes: dedupe(changes) };
}

function mapQuery(rule: Record<string, unknown>): MapResult {
  const pairs = readPairs(rule);
  if (!pairs.ok) return { status: "skipped", reason: pairs.reason };
  const drafts: MappedDraft[] = [];
  const changes: string[] = [];
  const failures: string[] = [];
  for (const pair of pairs.pairs) {
    const prepared = preparePair(pair);
    if (!prepared.ok) {
      failures.push(prepared.reason);
      continue;
    }
    const mods = readModificationList(pair);
    if (!mods.ok) {
      failures.push(mods.reason);
      continue;
    }
    if (mods.mods.some((mod) => ownString(mod, "type") === "Remove All")) {
      failures.push("Remove All query parameters is not supported.");
      continue;
    }
    const params: RogatioQueryParam[] = [];
    const seen = new Set<string>();
    const pairFailures: string[] = [];
    let droppedDuplicate = false;
    for (const mod of mods.mods) {
      const type = ownString(mod, "type");
      const name = ownString(mod, "param");
      if (
        name === undefined ||
        name.length === 0 ||
        name.length > LIMITS.maxQueryNameLength
      ) {
        pairFailures.push("A query parameter name is missing or too long.");
        continue;
      }
      if (type === "Remove") {
        if (seen.has(name)) droppedDuplicate = true;
        seen.add(name);
        params.push({ name, operation: "remove" });
        continue;
      }
      if (type !== "Add") {
        pairFailures.push(
          type === undefined
            ? "A query modification type is missing."
            : `Unsupported query modification "${type}".`,
        );
        continue;
      }
      const value = ownString(mod, "value") ?? "";
      if (value.length === 0 || value.length > LIMITS.maxQueryValueLength) {
        pairFailures.push("A query parameter value is missing or too long.");
        continue;
      }
      if (hasLoneSurrogate(value)) {
        pairFailures.push(
          "A query parameter value contains an invalid character.",
        );
        continue;
      }
      const action = ownString(mod, "actionWhenParamExists");
      if (action === "Ignore") {
        changes.push(
          "Add with Ignore was imported as set, which overwrites an existing parameter. Requestly leaves an existing parameter unchanged.",
        );
      } else if (action !== "Overwrite") {
        changes.push(
          "Add was imported as set, which overwrites an existing parameter instead of appending another value.",
        );
      }
      const escaped = escapeDollars(value);
      if (escaped !== value) {
        changes.push(
          "A literal $ in a query value was escaped so it is not read as a capture reference.",
        );
      }
      noteDynamic(value, changes);
      if (seen.has(name)) droppedDuplicate = true;
      seen.add(name);
      params.push({ name, operation: "set", value: escaped });
    }
    if (droppedDuplicate) {
      changes.push(
        "An earlier modification of the same query parameter was dropped.",
      );
    }
    const deduped = lastParamWins(params);
    if (deduped.length === 0) continue;
    const limited = deduped.slice(0, LIMITS.maxQueryParamsPerRule);
    if (limited.length < deduped.length) {
      changes.push(
        `Query parameters after the first ${LIMITS.maxQueryParamsPerRule} were dropped.`,
      );
    }
    if (limited.length === 0) {
      failures.push(
        ...pairFailures,
        "The query rule has no supported modifications.",
      );
      continue;
    }
    for (const failure of pairFailures) {
      changes.push(`Dropped a query modification: ${failure}`);
    }
    const applied = applyMethods(prepared, {
      source: prepared.base.source,
      resourceTypes: prepared.base.resourceTypes,
      type: "query",
      action: { type: "query", params: limited },
    });
    changes.push(...prepared.changes, ...applied.changes);
    drafts.push(...applied.drafts);
  }
  if (drafts.length === 0) {
    return {
      status: "skipped",
      reason: failures[0] ?? "The query rule has no supported modifications.",
    };
  }
  if (drafts.length > 1) {
    changes.unshift(
      "Query pairs were split into separate rules. Requestly applies every matching pair.",
    );
  }
  return { status: "mapped", drafts: tagIds(drafts), changes: dedupe(changes) };
}

function mapHeaders(rule: Record<string, unknown>): MapResult {
  const pairs = readPairs(rule);
  if (!pairs.ok) return { status: "skipped", reason: pairs.reason };
  const drafts: MappedDraft[] = [];
  const changes: string[] = [];
  const failures: string[] = [];
  for (const pair of pairs.pairs) {
    const prepared = preparePair(pair);
    if (!prepared.ok) {
      failures.push(prepared.reason);
      continue;
    }
    const mods = headerModifications(pair);
    if (mods.length === 0) {
      failures.push("The header rule has no supported modifications.");
      continue;
    }
    const pairFailures: string[] = [];
    let produced = 0;
    for (const mod of mods) {
      const header = ownString(mod.record, "header");
      const type = ownString(mod.record, "type");
      if (
        header === undefined ||
        header.length === 0 ||
        header.length > LIMITS.maxHeaderNameLength
      ) {
        pairFailures.push("A header name is missing or too long.");
        continue;
      }
      if (isForbiddenHeader(header, mod.direction)) {
        pairFailures.push(
          `Header "${header}" is forbidden on ${mod.direction} headers.`,
        );
        continue;
      }
      const operation = headerOperation(type);
      if (operation === null) {
        pairFailures.push(
          type === undefined
            ? "A header modification type is missing."
            : `Unsupported header modification "${type}".`,
        );
        continue;
      }
      if (operation.change !== undefined) changes.push(operation.change);
      const value = ownString(mod.record, "value") ?? "";
      if (operation.kind !== "remove") {
        if (value.length > LIMITS.maxHeaderValueLength) {
          pairFailures.push("A header value exceeds the length limit.");
          continue;
        }
        if (hasLoneSurrogate(value)) {
          pairFailures.push("A header value contains an invalid character.");
          continue;
        }
      }
      const escaped = escapeDollars(value);
      if (operation.kind !== "remove" && escaped !== value) {
        changes.push(
          "A literal $ in a header value was escaped so it is not read as a capture reference.",
        );
      }
      if (operation.kind !== "remove") noteDynamic(value, changes);
      const suffix = `${mod.direction} ${header}`;
      const applied = applyMethods(
        prepared,
        {
          source: prepared.base.source,
          resourceTypes: prepared.base.resourceTypes,
          type: "header",
          headerDirection: mod.direction,
          headerOperation: operation.kind,
          headerName: header,
          ...(operation.kind === "remove" ? {} : { headerValue: escaped }),
        },
        suffix,
      );
      changes.push(...applied.changes);
      drafts.push(...applied.drafts);
      produced += 1;
    }
    if (produced > 0) {
      changes.push(...prepared.changes);
      for (const failure of pairFailures) {
        changes.push(`Dropped a header modification: ${failure}`);
      }
    } else {
      failures.push(...pairFailures);
    }
    if (produced > 1) {
      changes.push("Header modifications were split into one rule per header.");
    }
  }
  if (drafts.length === 0) {
    return {
      status: "skipped",
      reason: failures[0] ?? "The header rule has no supported modifications.",
    };
  }
  const tagged = tagIds(drafts);
  if (tagged.length === 1 && tagged[0] !== undefined) {
    return {
      status: "mapped",
      drafts: [{ ...tagged[0], nameSuffix: "", keepId: true }],
      changes: dedupe(changes),
    };
  }
  return { status: "mapped", drafts: tagged, changes: dedupe(changes) };
}

function mapUserAgent(rule: Record<string, unknown>): MapResult {
  const pairs = readPairs(rule);
  if (!pairs.ok) return { status: "skipped", reason: pairs.reason };
  const drafts: MappedDraft[] = [];
  const changes: string[] = [];
  const failures: string[] = [];
  for (const pair of pairs.pairs) {
    const prepared = preparePair(pair);
    if (!prepared.ok) {
      failures.push(prepared.reason);
      continue;
    }
    const userAgent = ownString(pair, "userAgent");
    if (userAgent === undefined || userAgent.length === 0) {
      failures.push("The user-agent string is missing.");
      continue;
    }
    if (
      userAgent.length > LIMITS.maxHeaderValueLength ||
      hasLoneSurrogate(userAgent)
    ) {
      failures.push("The user-agent string is too long or invalid.");
      continue;
    }
    if (isForbiddenHeader("User-Agent", "request")) {
      failures.push('Header "User-Agent" is forbidden on request headers.');
      continue;
    }
    const envType = ownString(pair, "envType");
    if (envType === "browser" || envType === "device") {
      changes.push(
        "The browser or device preset was imported as the stored user-agent string.",
      );
    }
    const escaped = escapeDollars(userAgent);
    if (escaped !== userAgent) {
      changes.push(
        "A literal $ in the user-agent was escaped so it is not read as a capture reference.",
      );
    }
    noteDynamic(userAgent, changes);
    const applied = applyMethods(prepared, {
      source: prepared.base.source,
      resourceTypes: prepared.base.resourceTypes,
      type: "header",
      headerDirection: "request",
      headerOperation: "set",
      headerName: "User-Agent",
      headerValue: escaped,
    });
    changes.push(...prepared.changes, ...applied.changes);
    drafts.push(...applied.drafts);
  }
  if (drafts.length === 0) {
    return {
      status: "skipped",
      reason: failures[0] ?? "The user-agent rule has no supported pairs.",
    };
  }
  if (drafts.length > 1) {
    changes.unshift("User-agent pairs were split into separate rules.");
  }
  return { status: "mapped", drafts: tagIds(drafts), changes: dedupe(changes) };
}

function mapRequest(rule: Record<string, unknown>): MapResult {
  return mapBody(rule, "request");
}

function mapResponse(rule: Record<string, unknown>): MapResult {
  return mapBody(rule, "response");
}

function mapBody(
  rule: Record<string, unknown>,
  kind: "request" | "response",
): MapResult {
  const pairs = readPairs(rule);
  if (!pairs.ok) return { status: "skipped", reason: pairs.reason };
  const drafts: MappedDraft[] = [];
  const changes: string[] = [];
  const failures: string[] = [];
  for (const pair of pairs.pairs) {
    const prepared = preparePair(pair);
    if (!prepared.ok) {
      failures.push(prepared.reason);
      continue;
    }
    const bodyRecord = pair[kind];
    if (!isRecord(bodyRecord)) {
      failures.push(`The ${kind} body is missing.`);
      continue;
    }
    const type = ownString(bodyRecord, "type");
    if (type === "code") {
      failures.push(`JavaScript ${kind} functions are not supported.`);
      continue;
    }
    if (type === "local_file") {
      failures.push("A local-file response is not supported.");
      continue;
    }
    if (type !== "static") {
      failures.push(
        type === undefined
          ? `The ${kind} body type is missing.`
          : `Unsupported ${kind} body type "${type}".`,
      );
      continue;
    }
    const value = ownString(bodyRecord, "value") ?? "";
    const limit =
      kind === "request"
        ? LIMITS.maxRequestBodyBytes
        : LIMITS.maxResponseBodyBytes;
    if (value.length === 0 || value.length > limit || hasLoneSurrogate(value)) {
      failures.push(`The ${kind} body is empty, too large, or invalid.`);
      continue;
    }
    const escaped = escapeDollars(value);
    if (escaped !== value) {
      changes.push(
        "A literal $ in the body was escaped so it is not read as a capture reference.",
      );
    }
    noteDynamic(value, changes);
    if (kind === "response") {
      const status = ownString(bodyRecord, "statusCode");
      const statusNote =
        status !== undefined && status.length > 0
          ? ` Status ${status} was not imported.`
          : "";
      changes.push(
        `Requestly static responses replace the response and may skip the upstream request.${statusNote} Rogatio fetches the upstream response and replaces its body, keeping the upstream status and headers.`,
      );
      const applied = applyMethods(prepared, {
        source: prepared.base.source,
        resourceTypes: prepared.base.resourceTypes,
        type: "response-body",
        responseBody: { mode: "replace", body: escaped },
      });
      changes.push(...prepared.changes, ...applied.changes);
      drafts.push(...applied.drafts);
      continue;
    }
    const narrowed = narrowRequestBody(
      prepared.filters,
      prepared.base.resourceTypes,
    );
    if (!narrowed.ok) {
      failures.push(narrowed.reason);
      continue;
    }
    changes.push(...prepared.changes, ...narrowed.changes);
    for (const method of narrowed.methods) {
      drafts.push(
        draftOf(
          {
            source: prepared.base.source,
            resourceTypes: ["xmlhttprequest"],
            method,
            type: "request-body",
            requestBody: { mode: "replace", body: escaped },
          },
          narrowed.methods.length > 1 ? method : "",
        ),
      );
    }
  }
  if (drafts.length === 0) {
    return {
      status: "skipped",
      reason: failures[0] ?? `The ${kind} rule has no supported pairs.`,
    };
  }
  if (kind === "response" && drafts.length > 1) {
    changes.unshift(
      "Response pairs were split into separate rules. Requestly runs the first pair only.",
    );
  }
  return { status: "mapped", drafts: tagIds(drafts), changes: dedupe(changes) };
}

interface PreparedPair {
  readonly source: SourceCondition;
  readonly filters: ResolvedFilters;
  readonly sourceChanges: readonly string[];
  readonly filterChanges: readonly string[];
  readonly changes: readonly string[];
  readonly base: {
    readonly source: SourceCondition;
    readonly resourceTypes: ResourceType[];
    readonly method?: HttpMethod;
  };
}

function preparePair(
  pair: Record<string, unknown>,
):
  | ({ readonly ok: true } & PreparedPair)
  | { readonly ok: false; readonly reason: string } {
  const sourceRecord = pairSource(pair);
  if (!sourceRecord.ok) return sourceRecord;
  const converted = convertSource(sourceRecord.source);
  if (!converted.ok) return converted;
  const filters = readFilters(sourceRecord.source);
  if (!filters.ok) return filters;
  const method =
    filters.filters.methods !== "all" && filters.filters.methods.length === 1
      ? filters.filters.methods[0]
      : undefined;
  const sourceChanges = converted.converted.changes;
  const filterChanges = filters.filters.changes;
  return {
    ok: true,
    source: converted.converted.source,
    filters: filters.filters,
    sourceChanges,
    filterChanges,
    changes: [...sourceChanges, ...filterChanges],
    base: {
      source: converted.converted.source,
      resourceTypes: [...filters.filters.resourceTypes],
      ...(method === undefined ? {} : { method }),
    },
  };
}

function narrowRequestBody(
  filters: ResolvedFilters,
  resourceTypes: readonly ResourceType[],
):
  | {
      readonly ok: true;
      readonly methods: readonly ("POST" | "PUT" | "PATCH")[];
      readonly changes: string[];
    }
  | { readonly ok: false; readonly reason: string } {
  const changes: string[] = [];
  if (resourceTypes.length !== 1 || resourceTypes[0] !== "xmlhttprequest") {
    if (!resourceTypes.includes("xmlhttprequest")) {
      return {
        ok: false,
        reason:
          "Request-body rules only match xmlhttprequest, which this rule does not include.",
      };
    }
    changes.push(
      "Request-body rules only match xmlhttprequest. Other resource types were dropped.",
    );
  }
  const allowed = REQUEST_BODY_METHODS;
  if (filters.methods === "all") {
    changes.push(
      "The request had no method filter. It was split into POST, PUT, and PATCH, the methods Rogatio request-body rules allow.",
    );
    return { ok: true, methods: [...allowed], changes };
  }
  const methods = allowed.filter((method) => filters.methods.includes(method));
  const dropped = filters.methods.filter(
    (method) => !allowed.includes(method as (typeof allowed)[number]),
  );
  if (methods.length === 0) {
    return {
      ok: false,
      reason: "Request-body rules only support POST, PUT, and PATCH.",
    };
  }
  if (dropped.length > 0) {
    changes.push(
      `Dropped request methods other than POST, PUT, and PATCH: ${dropped.join(", ")}.`,
    );
  }
  if (methods.length > 1) {
    changes.push(
      "The request was split into one rule per method because a request-body rule stores one method.",
    );
  }
  return { ok: true, methods, changes };
}

function pairSource(
  pair: Record<string, unknown>,
):
  | { readonly ok: true; readonly source: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string } {
  const source = pair.source;
  if (!isRecord(source)) {
    return { ok: false, reason: "The source condition is missing." };
  }
  return { ok: true, source };
}

function readPairs(
  rule: Record<string, unknown>,
):
  | { readonly ok: true; readonly pairs: readonly Record<string, unknown>[] }
  | { readonly ok: false; readonly reason: string } {
  const pairs = rule.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { ok: false, reason: "The rule has no pairs." };
  }
  const records: Record<string, unknown>[] = [];
  for (const pair of pairs) {
    if (!isRecord(pair)) {
      return { ok: false, reason: "A rule pair is not an object." };
    }
    records.push(pair);
  }
  return { ok: true, pairs: records };
}

function readModificationList(
  pair: Record<string, unknown>,
):
  | { readonly ok: true; readonly mods: readonly Record<string, unknown>[] }
  | { readonly ok: false; readonly reason: string } {
  const modifications = pair.modifications;
  if (!Array.isArray(modifications) || modifications.length === 0) {
    return { ok: false, reason: "The query rule has no modifications." };
  }
  const mods: Record<string, unknown>[] = [];
  for (const mod of modifications) {
    if (!isRecord(mod)) {
      return { ok: false, reason: "A query modification is not an object." };
    }
    mods.push(mod);
  }
  return { ok: true, mods };
}

function headerModifications(
  pair: Record<string, unknown>,
): { record: Record<string, unknown>; direction: "request" | "response" }[] {
  const modifications = pair.modifications;
  if (isRecord(modifications)) {
    const found: {
      record: Record<string, unknown>;
      direction: "request" | "response";
    }[] = [];
    for (const direction of ["Request", "Response"] as const) {
      const list = modifications[direction];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        found.push({
          record: entry,
          direction: direction === "Request" ? "request" : "response",
        });
      }
    }
    if (found.length > 0) return found;
  }
  if (ownString(pair, "header") !== undefined) {
    const target = ownString(pair, "target");
    return [
      {
        record: pair,
        direction: target === "Response" ? "response" : "request",
      },
    ];
  }
  return [];
}

function headerOperation(type: string | undefined): {
  kind: "set" | "append" | "remove";
  change?: string;
} | null {
  if (type === "Add") return { kind: "append" };
  if (type === "Remove") return { kind: "remove" };
  if (type === "Modify") {
    return {
      kind: "set",
      change:
        "Modify updates an existing header only. It was imported as set, which also adds the header when it is absent.",
    };
  }
  if (type === "Replace") {
    return {
      kind: "set",
      change: "Header Replace was imported as set.",
    };
  }
  return null;
}

function rewriteDestination(destination: string): {
  destination: string;
  changes: string[];
} {
  let output = "";
  let captures = false;
  let dollars = false;
  for (let index = 0; index < destination.length; index += 1) {
    const char = destination[index];
    if (char !== "$") {
      output += char ?? "";
      continue;
    }
    const next = destination[index + 1];
    if (next !== undefined && next >= "1" && next <= "9") {
      output += `\\${next}`;
      captures = true;
      index += 1;
      continue;
    }
    output += "$$";
    dollars = true;
  }
  const changes: string[] = [];
  if (captures) {
    changes.push(
      "Redirect capture references were rewritten from $1–$9 to \\1–\\9.",
    );
  }
  if (dollars) {
    changes.push(
      "A literal $ in the redirect destination was escaped so it is not read as a capture reference.",
    );
  }
  return { destination: output, changes };
}

function lastParamWins(
  params: readonly RogatioQueryParam[],
): RogatioQueryParam[] {
  const order: string[] = [];
  const byName = new Map<string, RogatioQueryParam>();
  for (const param of params) {
    if (!byName.has(param.name)) order.push(param.name);
    byName.set(param.name, param);
  }
  const result: RogatioQueryParam[] = [];
  for (const name of order) {
    const param = byName.get(name);
    if (param !== undefined) result.push(param);
  }
  return result;
}

function noteDynamic(value: string, changes: string[]): void {
  if (!DYNAMIC_FUNCTION.test(value)) return;
  const message =
    "A Requestly dynamic function was kept as literal text and is not evaluated.";
  if (!changes.includes(message)) changes.push(message);
}

function escapeDollars(value: string): string {
  return value.replaceAll("$", "$$");
}

function draftOf(
  rule: Omit<RogatioRule, "id" | "name" | "priority">,
  nameSuffix = "",
): MappedDraft {
  return { nameSuffix, keepId: false, rule };
}

function tagIds(drafts: readonly MappedDraft[]): MappedDraft[] {
  return drafts.map((draft, index) => ({
    ...draft,
    keepId: index === 0,
  }));
}

function applyMethods(
  prepared: PreparedPair,
  rule: Omit<RogatioRule, "id" | "name" | "priority" | "method">,
  nameSuffix = "",
): { drafts: MappedDraft[]; changes: string[] } {
  const methodFilter = prepared.filters.methods;
  if (methodFilter === "all" || methodFilter.length <= 1) {
    const method = prepared.base.method;
    return {
      changes: [],
      drafts: [
        draftOf(
          {
            ...rule,
            ...(method === undefined ? {} : { method }),
          },
          nameSuffix,
        ),
      ],
    };
  }
  return {
    changes: [
      `Request methods were split into separate rules (${methodFilter.join(", ")}). Rogatio stores one method on a rule.`,
    ],
    drafts: methodFilter.map((method) =>
      draftOf(
        { ...rule, method },
        nameSuffix.length > 0 ? `${nameSuffix} ${method}` : method,
      ),
    ),
  };
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
