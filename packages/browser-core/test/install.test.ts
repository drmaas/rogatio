import type { MatcherOperation } from "@rogatio/compiler";
import { describe, expect, it } from "vitest";
import type {
  CoreDiagnostic,
  InstallResult,
  RuleInstallerAdapter,
} from "../src/index.js";
import { InstallService } from "../src/index.js";

const INSTALL_DIAGNOSTIC: CoreDiagnostic = {
  code: "core.install-failed",
  severity: "error",
  path: "",
  message: "The rule installer rejected the operation set.",
  params: {},
};

function makeOperation(ruleId: string, priority = 100): MatcherOperation {
  return {
    kind: "matcher",
    groupId: "g1",
    ruleId,
    matcher: {
      urlRegex: { source: "^https://example\\.com/", flags: "" },
      origins: ["https://example.com"],
      resourceTypes: ["main_frame"],
      priority,
    },
  };
}

class RecordingInstaller implements RuleInstallerAdapter {
  installed: MatcherOperation[] = [];
  calls: string[] = [];
  installFailuresLeft = 0;

  async current(): Promise<readonly MatcherOperation[]> {
    this.calls.push("current");
    return structuredClone(this.installed);
  }

  async install(
    operations: readonly MatcherOperation[],
  ): Promise<InstallResult> {
    this.calls.push("install");
    if (this.installFailuresLeft > 0) {
      this.installFailuresLeft -= 1;
      return { ok: false, diagnostics: [INSTALL_DIAGNOSTIC] };
    }
    this.installed = structuredClone(operations) as MatcherOperation[];
    return { ok: true };
  }
}

describe("InstallService", () => {
  it("treats an identical installed set as a no-op", async () => {
    const installer = new RecordingInstaller();
    installer.installed = [makeOperation("r1")];
    const service = new InstallService(installer);

    const outcome = await service.apply([makeOperation("r1")]);

    expect(outcome).toEqual({
      ok: true,
      noop: true,
      installed: [makeOperation("r1")],
    });
    expect(installer.calls).toEqual(["current"]);
  });

  it("installs a changed set atomically through the adapter", async () => {
    const installer = new RecordingInstaller();
    const service = new InstallService(installer);

    const outcome = await service.apply([
      makeOperation("r1"),
      makeOperation("r2"),
    ]);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.noop).toBe(false);
      expect(outcome.installed.map(({ ruleId }) => ruleId)).toEqual([
        "r1",
        "r2",
      ]);
    }
    expect(installer.calls).toEqual(["current", "install"]);
    expect(installer.installed.map(({ ruleId }) => ruleId)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("rolls back to the previous set when installation fails", async () => {
    const installer = new RecordingInstaller();
    installer.installed = [makeOperation("old")];
    installer.installFailuresLeft = 1;
    const service = new InstallService(installer);

    const outcome = await service.apply([makeOperation("new")]);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.recovered).toBe(true);
      expect(outcome.diagnostics.map(({ code }) => code)).toEqual([
        "core.install-failed",
      ]);
    }
    expect(installer.installed.map(({ ruleId }) => ruleId)).toEqual(["old"]);
    expect(installer.calls).toEqual(["current", "install", "install"]);
  });

  it("reports unrecovered failure when rollback also fails", async () => {
    const installer = new RecordingInstaller();
    installer.installed = [makeOperation("old")];
    installer.installFailuresLeft = 2;
    const service = new InstallService(installer);

    const outcome = await service.apply([makeOperation("new")]);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.recovered).toBe(false);
      expect(outcome.diagnostics.map(({ code }) => code)).toEqual([
        "core.install-failed",
        "core.recovery-failed",
      ]);
    }
  });

  it("reports a read failure without attempting installation", async () => {
    const installer = {
      async current(): Promise<readonly MatcherOperation[]> {
        throw new Error("storage unavailable");
      },
      async install(): Promise<{ ok: true }> {
        return { ok: true };
      },
    };
    const service = new InstallService(installer);

    const outcome = await service.apply([makeOperation("r1")]);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.recovered).toBe(false);
      expect(outcome.diagnostics[0]?.code).toBe("core.install-failed");
    }
  });

  it("serializes concurrent apply calls", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const installer: RuleInstallerAdapter = {
      async current(): Promise<readonly MatcherOperation[]> {
        return [];
      },
      async install(
        operations: readonly MatcherOperation[],
      ): Promise<InstallResult> {
        order.push(operations[0]?.ruleId ?? "empty");
        if (order.length === 1) await gate;
        return { ok: true };
      },
    };
    const service = new InstallService(installer);

    const first = service.apply([makeOperation("first")]);
    const second = service.apply([makeOperation("second")]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first"]);
    releaseFirst();
    await first;
    await second;
    expect(order).toEqual(["first", "second"]);
  });
});
