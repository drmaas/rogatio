import { readFileSync } from "node:fs";
import { compileProject } from "@rogatio/compiler";
import {
  compileUrlRegex,
  RESOURCE_TYPES,
  type RogatioProject,
  type RogatioRule,
  validateProjectDetailed,
} from "@rogatio/schema";
import { describe, expect, it } from "vitest";
import { importRequestlyExport, mergeProjects } from "../src/index.js";
import { HOST_MATCHES_SKIP_REASON } from "../src/source.js";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

function assertValid(project: RogatioProject): void {
  const schema = validateProjectDetailed(project);
  expect(schema.valid, JSON.stringify(schema)).toBe(true);
  if (!schema.valid) return;
  const compiled = compileProject(schema.data);
  expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
}

function verified(value: unknown): RogatioProject {
  const result = importRequestlyExport(value);
  expect(result.ok, result.ok ? "" : result.error).toBe(true);
  if (!result.ok) throw new Error(result.error);
  assertValid(result.project);
  return result.project;
}

function ruleNamed(project: RogatioProject, name: string): RogatioRule {
  const found = project.groups
    .flatMap((group) => group.rules)
    .find((rule) => rule.name === name);
  if (found === undefined) {
    throw new Error(
      `missing rule ${name}; have ${project.groups.flatMap((group) => group.rules.map((rule) => rule.name)).join(", ")}`,
    );
  }
  return found;
}

describe("requestly import fixtures", () => {
  it("imports an exact redirect into its group", () => {
    const result = importRequestlyExport(load("redirect.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = verified(load("redirect.json"));
    expect(project.name).toBe("Imported from Requestly");
    expect(project.description).toBe("Imported from a Requestly export.");
    expect(project.groups).toHaveLength(1);
    expect(project.groups[0]).toMatchObject({
      id: "Group_web",
      name: "Web app",
    });
    const rule = ruleNamed(project, "Search redirect");
    expect(rule).toMatchObject({
      id: "Redirect_home",
      priority: 1000,
      source: {
        key: "url",
        operator: "regex",
        value: "^https://www\\.google\\.com/$",
      },
      type: "redirect",
      redirect: { destination: "https://www.bing.com/" },
    });
    expect(rule.resourceTypes).toEqual([...RESOURCE_TYPES]);
    expect(result.report.imported).toBe(1);
    expect(result.report.changed).toBe(0);
    expect(result.report.skipped).toBe(0);
    expect(result.report.rules[0]?.status).toBe("imported");
  });

  it("rewrites wildcard redirect captures", () => {
    const result = importRequestlyExport(load("redirect-wildcard.json"));
    const project = verified(load("redirect-wildcard.json"));
    const rule = ruleNamed(project, "Old path");
    expect(rule.source.value).toBe("^https://example\\.com/old/(.*?)$");
    expect(rule.redirect?.destination).toBe("https://example.com/new/\\1");
    expect(result.ok && result.report.rules[0]?.status).toBe("changed");
    expect(result.ok && result.report.rules[0]?.changes?.join("\n")).toContain(
      "$1–$9",
    );
  });

  it("lowers a literal replace to a redirect", () => {
    const result = importRequestlyExport(load("replace.json"));
    const project = verified(load("replace.json"));
    const rule = ruleNamed(project, "Staging API");
    expect(rule.source.value).toBe("^https://api\\.example\\.com/(.*?)$");
    expect(rule.redirect?.destination).toBe(
      "https://api.staging.example.com/\\1",
    );
    expect(result.ok && result.report.rules[0]?.status).toBe("changed");
  });

  it("imports query add and remove", () => {
    const result = importRequestlyExport(load("query-param.json"));
    const project = verified(load("query-param.json"));
    const rule = ruleNamed(project, "Strip campaign params");
    expect(rule.source).toEqual({
      key: "host",
      operator: "regex",
      value: "^example\\.com$",
    });
    expect(rule.action).toEqual({
      type: "query",
      params: [
        { name: "utm_source", operation: "remove" },
        { name: "ref", operation: "set", value: "rogatio" },
      ],
    });
    expect(result.ok && result.report.rules[0]?.status).toBe("changed");
    expect(result.ok && result.report.rules[0]?.changes?.join("\n")).toContain(
      "any port",
    );
  });

  it("splits header modifications into one rule each", () => {
    const result = importRequestlyExport(load("headers.json"));
    const project = verified(load("headers.json"));
    expect(project.groups[0]?.rules).toHaveLength(2);
    const request = ruleNamed(project, "Debug headers (request X-Debug)");
    const response = ruleNamed(
      project,
      "Debug headers (response X-Frame-Options)",
    );
    expect(request).toMatchObject({
      id: "Headers_debug",
      method: "GET",
      priority: 1000,
      headerDirection: "request",
      headerOperation: "append",
      headerName: "X-Debug",
      headerValue: "1",
      resourceTypes: ["xmlhttprequest"],
    });
    expect(response).toMatchObject({
      priority: 999,
      headerDirection: "response",
      headerOperation: "remove",
      headerName: "X-Frame-Options",
    });
    expect(response.headerValue).toBeUndefined();
    expect(result.ok && result.report.imported).toBe(0);
    expect(result.ok && result.report.changed).toBe(1);
    expect(result.ok && result.report.rules[0]?.rogatioRuleIds).toEqual([
      request.id,
      response.id,
    ]);
  });

  it("imports a custom user agent as a request header", () => {
    const result = importRequestlyExport(load("user-agent.json"));
    const project = verified(load("user-agent.json"));
    expect(ruleNamed(project, "Test agent")).toMatchObject({
      id: "UserAgent_test",
      type: "header",
      headerDirection: "request",
      headerOperation: "set",
      headerName: "User-Agent",
      headerValue: "RogatioTest/1.0",
      source: { key: "url", operator: "regex", value: "example\\.com" },
    });
    expect(result.ok && result.report.rules[0]?.status).toBe("imported");
  });

  it("imports a static request body", () => {
    const result = importRequestlyExport(load("request.json"));
    const project = verified(load("request.json"));
    expect(ruleNamed(project, "Rewrite submit")).toMatchObject({
      id: "Request_submit",
      method: "POST",
      resourceTypes: ["xmlhttprequest"],
      type: "request-body",
      requestBody: { mode: "replace", body: '{"sent":true}' },
    });
    expect(result.ok && result.report.rules[0]?.status).toBe("imported");
  });

  it("imports a static response body and reports the semantic change", () => {
    const result = importRequestlyExport(load("response.json"));
    const project = verified(load("response.json"));
    const rule = ruleNamed(project, "Mock data");
    expect(rule.source.value).toBe("^https:\\/\\/example\\.com\\/data\\.json$");
    expect(rule.responseBody).toEqual({ mode: "replace", body: '{"ok":true}' });
    expect(result.ok && result.report.rules[0]?.status).toBe("changed");
    expect(result.ok && result.report.rules[0]?.changes?.join("\n")).toContain(
      "Status 200",
    );
  });

  it("imports a mixed export and lists every skipped rule", () => {
    const result = importRequestlyExport(load("mixed.json"));
    const project = verified(load("mixed.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.imported).toBe(3);
    expect(result.report.changed).toBe(4);
    expect(result.report.skipped).toBe(3);
    const skipped = result.report.rules.filter(
      (row) => row.status === "skipped",
    );
    expect(skipped.map((row) => row.name)).toEqual([
      "Block trackers",
      "Slow API",
      "Inject helper",
    ]);
    expect(skipped.map((row) => row.ruleType)).toEqual([
      "Cancel",
      "Delay",
      "Script",
    ]);
    const names = project.groups.flatMap((group) =>
      group.rules.map((rule) => rule.name),
    );
    expect(names).not.toContain("Block trackers");
    expect(names).not.toContain("Slow API");
    expect(names).not.toContain("Inject helper");
    expect(project.groups.map((group) => group.name)).toEqual([
      "Web app",
      "Ungrouped",
    ]);
    const web = project.groups[0]?.rules ?? [];
    expect(web.map((rule) => rule.priority)).toEqual([
      1000, 999, 998, 994, 993,
    ]);
    const loose = project.groups[1]?.rules ?? [];
    expect(loose.map((rule) => rule.priority)).toEqual([997, 996, 995]);
    expect(result.report.notes[0]).toContain("1000 downward");
  });
});

describe("host source authority confinement", () => {
  it("keeps host Wildcard_Matches inside the URL authority", () => {
    const result = importRequestlyExport({
      objectType: "rule",
      id: "Headers_corp",
      name: "Corp host wildcard",
      ruleType: "Headers",
      status: "Active",
      pairs: [
        {
          source: {
            key: "host",
            operator: "Wildcard_Matches",
            value: "*.corp.example.com",
          },
          modifications: {
            Request: [{ header: "X-Debug", value: "1", type: "Add" }],
            Response: [],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertValid(result.project);
    const rule = ruleNamed(result.project, "Corp host wildcard");
    expect(rule.source.key).toBe("url");
    expect(rule.source.value).toContain("([^/?#@]*?)");
    expect(rule.source.value).not.toContain("(.*?)");

    const regex = compileUrlRegex(rule.source.value);
    expect(regex).not.toBeNull();
    if (regex === null) return;

    expect(regex.test("https://attacker.test/x.corp.example.com")).toBe(false);
    expect(regex.test("https://attacker.test/#.corp.example.com")).toBe(false);
    expect(regex.test("https://api.corp.example.com/v1")).toBe(true);
    expect(regex.test("https://api.corp.example.com:8443/")).toBe(true);
  });

  it("skips host Matches pairs that cannot be confined to the host", () => {
    const result = importRequestlyExport({
      objectType: "rule",
      id: "Headers_host_re",
      name: "Host regex",
      ruleType: "Headers",
      status: "Active",
      pairs: [
        {
          source: {
            key: "host",
            operator: "Matches",
            value: "/.*\\.corp\\.example\\.com/",
          },
          modifications: {
            Request: [{ header: "X-Debug", value: "1", type: "Add" }],
            Response: [],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.skipped).toBe(1);
    expect(result.report.rules[0]?.status).toBe("skipped");
    expect(result.report.rules[0]?.reason).toBe(HOST_MATCHES_SKIP_REASON);
    expect(result.project.groups.flatMap((group) => group.rules)).toHaveLength(
      0,
    );
  });
});

describe("lossy Requestly cases", () => {
  it("skips page filters, Remove All, local redirects, and scripted bodies", () => {
    const page = importRequestlyExport({
      objectType: "rule",
      name: "Only this page",
      ruleType: "Redirect",
      pairs: [
        {
          source: {
            key: "Url",
            operator: "Contains",
            value: "example.com",
            filters: {
              pageUrl: { operator: "Contains", value: "example.com" },
            },
          },
          destination: "https://example.com/next",
        },
      ],
    });
    expect(page.ok && page.report.rules[0]?.reason).toContain("Page URL");

    const removeAll = importRequestlyExport({
      objectType: "rule",
      name: "Clear query",
      ruleType: "QueryParam",
      pairs: [
        {
          source: { key: "Url", operator: "Contains", value: "example.com" },
          modifications: [{ type: "Remove All" }],
        },
      ],
    });
    expect(removeAll.ok && removeAll.report.rules[0]?.reason).toContain(
      "Remove All",
    );

    const local = importRequestlyExport({
      objectType: "rule",
      name: "Local mock",
      ruleType: "Redirect",
      pairs: [
        {
          source: {
            key: "Url",
            operator: "Equals",
            value: "https://example.com/",
          },
          destinationType: "map_local",
          destination: "/tmp/body.txt",
        },
      ],
    });
    expect(local.ok && local.report.rules[0]?.status).toBe("skipped");
    expect(JSON.stringify(local.ok && local.project)).not.toContain(
      "/tmp/body.txt",
    );

    const code = importRequestlyExport({
      objectType: "rule",
      name: "Computed",
      ruleType: "Response",
      pairs: [
        {
          source: { key: "Url", operator: "Contains", value: "example.com" },
          response: { type: "code", value: "function(){return 'no'}" },
        },
      ],
    });
    expect(code.ok && code.report.rules[0]?.reason).toContain("JavaScript");
  });

  it("reports an inactive rule as changed and still imports it", () => {
    const result = importRequestlyExport({
      objectType: "rule",
      id: "Redirect_off",
      name: "Paused",
      ruleType: "Redirect",
      status: "Inactive",
      pairs: [
        {
          source: {
            key: "Url",
            operator: "Equals",
            value: "https://example.com/a",
          },
          destination: "https://example.com/b",
        },
      ],
    });
    expect(result.ok && result.report.rules[0]?.status).toBe("changed");
    expect(result.ok && result.report.rules[0]?.changes?.join("\n")).toContain(
      "inactive",
    );
    if (result.ok) assertValid(result.project);
  });

  it("splits a request body with no method filter into POST, PUT, and PATCH", () => {
    const result = importRequestlyExport({
      objectType: "rule",
      name: "Any write",
      ruleType: "Request",
      pairs: [
        {
          source: {
            key: "Url",
            operator: "Equals",
            value: "https://example.com/submit",
          },
          request: { type: "static", value: "{}" },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const methods = result.project.groups[0]?.rules.map((rule) => rule.method);
    expect(methods).toEqual(["POST", "PUT", "PATCH"]);
    expect(result.report.rules[0]?.status).toBe("changed");
    assertValid(result.project);
  });

  it("rejects cycles, accessors, and sparse arrays", () => {
    const cycle: Record<string, unknown> = {
      objectType: "rule",
      ruleType: "Cancel",
      name: "Loop",
    };
    cycle.self = cycle;
    expect(importRequestlyExport(cycle).ok).toBe(false);

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "ruleType", {
      enumerable: true,
      get() {
        return "Cancel";
      },
    });
    expect(importRequestlyExport(accessor).ok).toBe(false);

    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(importRequestlyExport(sparse).ok).toBe(false);

    const foreign = Object.create({ ruleType: "Cancel", name: "Hidden" });
    foreign.objectType = "rule";
    expect(importRequestlyExport(foreign).ok).toBe(false);
  });
});

describe("mergeProjects", () => {
  it("appends imported groups and renames collisions", () => {
    const imported = importRequestlyExport(load("redirect.json"));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const existing: RogatioProject = {
      version: 2,
      name: "Already here",
      description: "Keep me",
      requestBodyPolicy: { localOrigins: ["https://example.com"] },
      groups: [
        {
          id: "Group_web",
          name: "Web app",
          rules: [
            {
              id: "Redirect_home",
              name: "Search redirect",
              source: {
                key: "url",
                operator: "regex",
                value: "^https://example\\.com/$",
              },
              resourceTypes: ["main_frame"],
              priority: 10,
              type: "redirect",
              redirect: { destination: "https://example.com/stay" },
            },
          ],
        },
      ],
    };
    const merged = mergeProjects(existing, imported.project);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.project.name).toBe("Already here");
    expect(merged.project.description).toBe("Keep me");
    expect(merged.project.requestBodyPolicy).toEqual({
      localOrigins: ["https://example.com"],
    });
    expect(merged.project.groups).toHaveLength(2);
    expect(merged.project.groups[0]?.rules[0]?.redirect?.destination).toBe(
      "https://example.com/stay",
    );
    expect(merged.renamed.join("\n")).toContain("Web app");
    expect(merged.renamed.join("\n")).toContain("Redirect_home");
    assertValid(merged.project);
  });
});
