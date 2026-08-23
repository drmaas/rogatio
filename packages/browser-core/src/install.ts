import type { MatcherOperation } from "@rogatio/compiler";
import type { CoreDiagnostic } from "./diagnostics.js";
import { coreDiagnostic } from "./diagnostics.js";
import type {
  InstallOutcome,
  InstallResult,
  RuleInstallerAdapter,
} from "./types.js";

function sameOperations(
  left: readonly MatcherOperation[],
  right: readonly MatcherOperation[],
): boolean {
  if (left.length !== right.length) return false;
  // Both sides are plain, serializable operation data produced by the same
  // pipeline, so JSON equality is a deterministic structural comparison.
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InstallService {
  private readonly installer: RuleInstallerAdapter;
  private tail: Promise<void> = Promise.resolve();

  constructor(installer: RuleInstallerAdapter) {
    this.installer = installer;
  }

  apply(desired: readonly MatcherOperation[]): Promise<InstallOutcome> {
    const run = this.tail.then(() => this.applyNow(desired));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async applyNow(
    desired: readonly MatcherOperation[],
  ): Promise<InstallOutcome> {
    let previous: readonly MatcherOperation[];
    try {
      previous = await this.installer.current();
    } catch {
      return {
        ok: false,
        recovered: false,
        diagnostics: [coreDiagnostic("core.install-failed")],
      };
    }
    if (sameOperations(desired, previous)) {
      return { ok: true, installed: previous, noop: true };
    }

    const installed = await this.tryInstall(desired);
    if (installed.ok) {
      return { ok: true, installed: desired, noop: false };
    }

    const rollback = await this.tryInstall(previous);
    if (rollback.ok) {
      return {
        ok: false,
        recovered: true,
        diagnostics: installed.diagnostics,
      };
    }
    const diagnostics: CoreDiagnostic[] = [
      ...installed.diagnostics,
      coreDiagnostic("core.recovery-failed"),
    ];
    return { ok: false, recovered: false, diagnostics };
  }

  private async tryInstall(
    operations: readonly MatcherOperation[],
  ): Promise<InstallResult> {
    try {
      return await this.installer.install(operations);
    } catch {
      return {
        ok: false,
        diagnostics: [coreDiagnostic("core.install-failed")],
      };
    }
  }
}
