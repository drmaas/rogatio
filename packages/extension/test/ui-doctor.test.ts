import { describe, expect, it } from "vitest";
import type { DoctorReport } from "../src/doctor-report.js";
import { RELEASE_EXTENSION_ID } from "../src/extension-id.js";
import {
  buildExtensionDoctor,
  EXT_PROXY_ABSENT_FIX,
  EXT_PROXY_ABSENT_SUMMARY,
  EXT_PROXY_CLEAR_SUMMARY,
  EXT_PROXY_OTHER_FIX,
  EXT_PROXY_OTHER_SUMMARY,
  EXT_PROXY_OURS_SUMMARY,
  EXT_PROXY_POLICY_SUMMARY,
  EXT_PROXY_STALE_FIX,
  EXT_PROXY_STALE_SUMMARY,
  EXT_RULES_ERROR_FIX,
  EXT_RULES_ROOT_FIX,
  EXT_RULES_RUNTIME_FIX,
  EXT_RULES_UNROUTABLE_FIX,
  EXT_VERSION_UNAVAILABLE_SUMMARY,
  EXT_WORKER_FAIL_SUMMARY,
  type ExtensionDoctorFacts,
  serializeCombinedDiagnostics,
  tabFactsFromDryRun,
  workerUnreachableDiagnostics,
} from "../src/ui-doctor.js";
import {
  collectExtensionDoctor,
  readProxySnapshot,
} from "../src/ui-doctor-browser.js";

const DEV_ID = "abcdefghijklmnopabcdefghijklmnop";
const SECRET_URL = "https://secret.example/private/path?token=sekret";
const SECRET_ERROR = "chrome-error-RAW-secret-stack";
const SECRET_BODY = "PROJECT_BODY_SECRET";
const SECRET_KEY = "sk-doctor-secret-key";

function hostReport(): DoctorReport {
  const row = (
    id: DoctorReport["checks"][number]["id"],
    status: "pass" | "warn" | "fail",
    optional: boolean,
    summary: string,
    fix: string | null,
  ) => ({ id, status, optional, summary, fix });
  return {
    version: 1,
    ok: true,
    exitCode: 0,
    checks: [
      row("node", "pass", false, "Node 26.11.1, CLI 6.15.0.", null),
      row("project", "pass", false, "Active project is valid.", null),
      row(
        "host",
        "pass",
        false,
        "allowed_origins includes the release id.",
        null,
      ),
      row("ca", "pass", false, "Device CA is present and trusted.", null),
      row("pac", "pass", false, "Runtime answered a PAC request.", null),
      row(
        "ai",
        "warn",
        true,
        "Optional. No AI provider is configured.",
        "rogatio ai setup",
      ),
    ],
  };
}

function facts(
  overrides: Partial<ExtensionDoctorFacts> = {},
): ExtensionDoctorFacts {
  return {
    workerReached: true,
    extensionId: RELEASE_EXTENSION_ID,
    extensionVersion: "6.15.0",
    cliVersion: "6.15.0",
    native: "ok",
    phase: "stopped",
    proxy: {
      available: true,
      levelOfControl: "controllable_by_this_extension",
      mode: "direct",
    },
    siteAccess: true,
    incognito: true,
    activeProject: true,
    rulesReadable: true,
    enabledGroupCount: 1,
    statuses: [{ ruleId: "rule-1", status: "active" }],
    tab: null,
    host: hostReport(),
    ...overrides,
  };
}

function proxyApi(
  levelOfControl: string,
  mode: string,
): Parameters<typeof readProxySnapshot>[0] {
  return {
    runtime: {
      sendMessage() {},
      onMessage: { addListener() {} },
    },
    proxy: {
      settings: {
        get(_details, callback) {
          callback({
            levelOfControl: levelOfControl as "controlled_by_this_extension",
            value: { mode: mode as "pac_script" },
          });
        },
        set() {},
        clear() {},
      },
    },
  };
}

describe("extension UI doctor", () => {
  it("uses a distinct summary when the service worker does not answer", () => {
    const report = workerUnreachableDiagnostics();
    expect(report.ui.checks).toEqual([
      {
        id: "ext.worker",
        status: "fail",
        optional: false,
        summary: EXT_WORKER_FAIL_SUMMARY,
        fix: "Reload the extension at chrome://extensions",
      },
    ]);
    expect(report.host).toBeNull();
    expect(report.ok).toBe(false);
  });

  it("keeps a dev origin-forbidden fix to the install command", () => {
    const report = buildExtensionDoctor(
      facts({
        extensionId: DEV_ID,
        native: "origin-forbidden",
        host: null,
      }),
    );
    const native = report.ui.checks.find((item) => item.id === "ext.native");
    expect(native?.fix).toBe(
      `rogatio runtime install --extension-id ${DEV_ID}`,
    );
    expect(native?.summary).not.toBe(EXT_WORKER_FAIL_SUMMARY);
  });

  it("does not copy a poisoned version into a fix", () => {
    const report = buildExtensionDoctor(
      facts({
        extensionVersion: "6.15.0",
        cliVersion: "1.2.3; rm -rf /",
      }),
    );
    const version = report.ui.checks.find((item) => item.id === "ext.version");
    expect(version?.summary).toBe(EXT_VERSION_UNAVAILABLE_SUMMARY);
    expect(version?.fix).toBeNull();
    expect(serializeCombinedDiagnostics(report)).not.toContain("rm -rf");
  });

  it("points a newer extension at the matching CLI version", () => {
    const report = buildExtensionDoctor(
      facts({ extensionVersion: "6.16.0", cliVersion: "6.15.0" }),
    );
    const version = report.ui.checks.find((item) => item.id === "ext.version");
    expect(version?.fix).toBe("npm install -g @rogatio/cli@6.16.0");
  });

  it.each([
    ["error", "fail", EXT_RULES_ERROR_FIX],
    ["needs runtime", "warn", EXT_RULES_RUNTIME_FIX],
    ["needs root directory", "warn", EXT_RULES_ROOT_FIX],
  ] as const)("rules %s uses its fix", (status, expected, fix) => {
    const report = buildExtensionDoctor(
      facts({ statuses: [{ ruleId: "rule-1", status }] }),
    );
    const rules = report.ui.checks.find((item) => item.id === "ext.rules");
    expect(rules?.status).toBe(expected);
    expect(rules?.fix).toBe(fix);
    expect(rules?.summary).toContain("rule-1");
  });

  it("does not tell the user to start a runtime that is already running", () => {
    const report = buildExtensionDoctor(
      facts({
        phase: "started",
        statuses: [{ ruleId: "rule-1", status: "needs runtime" }],
      }),
    );
    const rules = report.ui.checks.find((item) => item.id === "ext.rules");
    expect(rules?.status).toBe("warn");
    expect(rules?.fix).toBe(EXT_RULES_UNROUTABLE_FIX);
    expect(rules?.summary).toContain("needs runtime");
    expect(rules?.fix).not.toContain("Start runtime");
  });

  it("hides a rule id that is not a safe token", () => {
    const report = buildExtensionDoctor(
      facts({
        statuses: [{ ruleId: SECRET_URL, status: "error" }],
      }),
    );
    const text = serializeCombinedDiagnostics(report);
    expect(text).toContain("a rule");
    expect(text).not.toContain(SECRET_URL);
    expect(text).not.toContain(SECRET_BODY);
  });
});

describe("proxy snapshot", () => {
  it("fails when another extension controls the proxy", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("controlled_by_other_extensions", "fixed_servers"),
    );
    const report = buildExtensionDoctor(facts({ phase: "started", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.summary).toBe(EXT_PROXY_OTHER_SUMMARY);
    expect(row?.fix).toBe(EXT_PROXY_OTHER_FIX);
    expect(row?.status).toBe("fail");
  });

  it("fails when policy owns the proxy", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("not_controllable", "fixed_servers"),
    );
    const report = buildExtensionDoctor(facts({ phase: "started", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.summary).toBe(EXT_PROXY_POLICY_SUMMARY);
    expect(row?.fix).toBeNull();
  });

  it("warns when a PAC script is still installed after stop", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("controlled_by_this_extension", "pac_script"),
    );
    const report = buildExtensionDoctor(facts({ phase: "stopped", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.summary).toBe(EXT_PROXY_STALE_SUMMARY);
    expect(row?.fix).toBe(EXT_PROXY_STALE_FIX);
    expect(row?.status).toBe("warn");
  });

  it("passes when this extension controls the proxy", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("controlled_by_this_extension", "pac_script"),
    );
    const report = buildExtensionDoctor(facts({ phase: "started", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.summary).toBe(EXT_PROXY_OURS_SUMMARY);
    expect(row?.status).toBe("pass");
  });

  it("fails when the runtime is started but the proxy is not ours", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("controllable_by_this_extension", "direct"),
    );
    const report = buildExtensionDoctor(facts({ phase: "started", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.summary).toBe(EXT_PROXY_ABSENT_SUMMARY);
    expect(row?.fix).toBe(EXT_PROXY_ABSENT_FIX);
  });

  it.each(["starting", "failed"] as const)(
    "does not call a %s PAC script stale",
    async (phase) => {
      const proxy = await readProxySnapshot(
        proxyApi("controlled_by_this_extension", "pac_script"),
      );
      const report = buildExtensionDoctor(facts({ phase, proxy }));
      const row = report.ui.checks.find((item) => item.id === "ext.proxy");
      expect(row?.status).toBe("pass");
      expect(row?.summary).toBe(EXT_PROXY_CLEAR_SUMMARY);
      expect(row?.fix).toBeNull();
    },
  );

  it("fails when the runtime failed and another extension controls the proxy", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("controlled_by_other_extensions", "fixed_servers"),
    );
    const report = buildExtensionDoctor(facts({ phase: "failed", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.status).toBe("fail");
    expect(row?.summary).toBe(EXT_PROXY_OTHER_SUMMARY);
    expect(row?.fix).toBe(EXT_PROXY_OTHER_FIX);
  });

  it("fails when the runtime failed and policy owns the proxy", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("not_controllable", "fixed_servers"),
    );
    const report = buildExtensionDoctor(facts({ phase: "failed", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.status).toBe("fail");
    expect(row?.summary).toBe(EXT_PROXY_POLICY_SUMMARY);
    expect(row?.fix).toBeNull();
  });

  it("passes when the runtime is starting and another extension controls the proxy", async () => {
    const proxy = await readProxySnapshot(
      proxyApi("controlled_by_other_extensions", "pac_script"),
    );
    const report = buildExtensionDoctor(facts({ phase: "starting", proxy }));
    const row = report.ui.checks.find((item) => item.id === "ext.proxy");
    expect(row?.status).toBe("pass");
    expect(row?.summary).toBe(EXT_PROXY_CLEAR_SUMMARY);
  });
});

const redirectProject = {
  version: 2,
  name: "Preview",
  groups: [
    {
      id: "ads",
      name: "Ads",
      rules: [
        {
          id: "old-path",
          name: "Old path",
          source: {
            key: "url",
            operator: "regex",
            value: "^https://example\\.com/old/(.*)$",
          },
          resourceTypes: ["main_frame"],
          priority: 1,
          method: "GET",
          type: "redirect",
          redirect: { destination: "https://example.com/new/$1" },
        },
      ],
    },
  ],
};

describe("current tab", () => {
  it("lists the dimension that missed and never stores the URL", async () => {
    const report = await collectExtensionDoctor({
      surface: "popup",
      extensionId: RELEASE_EXTENSION_ID,
      phase: "stopped",
      chrome: {
        storage: {
          local: { get: async () => ({}), set: async () => undefined },
        },
        action: {
          setBadgeText: async () => undefined,
          setBadgeBackgroundColor: async () => undefined,
        },
        runtime: {
          id: RELEASE_EXTENSION_ID,
          getManifest: () => ({ version: "6.15.0" }),
          sendMessage() {},
          onMessage: { addListener() {} },
          lastError: { message: SECRET_ERROR },
        },
        tabs: {
          query(_query, callback) {
            callback([{ url: SECRET_URL }]);
          },
        },
        permissions: {
          contains(_permission, callback) {
            callback(true);
          },
        },
        extension: {
          isAllowedIncognitoAccess(callback) {
            callback(false);
          },
        },
        proxy: {
          settings: {
            get(_details, callback) {
              callback({
                levelOfControl: "controllable_by_this_extension",
                value: { mode: "direct" },
              });
            },
            set() {},
            clear() {},
          },
        },
      },
      project: {
        ...redirectProject,
        groups: [
          {
            ...redirectProject.groups[0],
            rules: [
              redirectProject.groups[0]?.rules[0],
              {
                id: "rewrite-body",
                name: "Rewrite",
                source: {
                  key: "url",
                  operator: "regex",
                  value: "^https://example\\.com/body$",
                },
                resourceTypes: ["xmlhttprequest"],
                priority: 2,
                method: "POST",
                type: "request-body",
                requestBody: { mode: "replace", body: SECRET_BODY },
              },
            ],
          },
        ],
      },
      enabledGroupIds: ["ads"],
      statuses: [{ ruleId: "old-path", status: "active" }],
      rulesReadable: true,
      activeProject: true,
      native: "disconnected",
      cliVersion: null,
      host: null,
    });
    const text = serializeCombinedDiagnostics(report);
    const tab = report.ui.checks.find((item) => item.id === "ext.tab");
    expect(tab?.summary).toContain("old-path");
    expect(tab?.summary).toContain("source unmatched");
    expect(tab?.summary).toContain("method matched");
    expect(tab?.summary).toContain("resourceType matched");
    expect(text).not.toContain(SECRET_URL);
    expect(text).not.toContain("private/path");
    expect(text).not.toContain("token=sekret");
    expect(text).not.toContain(SECRET_ERROR);
    expect(text).not.toContain(SECRET_BODY);
    expect(text).not.toContain(SECRET_KEY);
    expect(report.host).toBeNull();
  });

  it("drops the URL when copying dry-run facts", () => {
    const facts = tabFactsFromDryRun(
      {
        results: [
          {
            url: SECRET_URL,
            rules: [
              {
                ruleId: "old-path",
                groupId: "ads",
                matched: false,
                source: { state: "unmatched", detail: SECRET_URL },
                method: { state: "matched", detail: "GET" },
                resourceType: { state: "matched", detail: "main_frame" },
              },
            ],
          },
        ],
        errors: [],
      },
      ["ads"],
      [],
    );
    expect(JSON.stringify(facts)).not.toContain(SECRET_URL);
  });
});
