import type { MatcherOperation } from "@rogatio/compiler";
import type { RogatioProject } from "@rogatio/schema";
import type { CoreDiagnostic } from "./diagnostics.js";

export const ENVELOPE_VERSION = 1 as const;

export interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly data: RogatioProject;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly enabledGroupIds: readonly string[];
  readonly grantedOrigins: readonly string[];
}

export interface StoredEnvelope {
  readonly version: typeof ENVELOPE_VERSION;
  readonly projects: Readonly<Record<string, StoredProject>>;
  readonly activeProjectId: string | null;
}

/**
 * The persistence boundary. `read` returns the raw stored value (or undefined
 * when empty); `compareAndSwap` atomically replaces the stored value only when
 * it structurally equals `previous`. The adapter is the authority on atomicity;
 * implementations must serialize concurrent operations.
 */
export interface StorageAdapter {
  read(): Promise<unknown>;
  compareAndSwap(previous: unknown, next: unknown): Promise<boolean>;
}

/**
 * The rule-installation boundary. `current` reports what is installed now;
 * `install` atomically replaces the installed set and reports failure with
 * stable diagnostics. The adapter is the authority on atomicity; implementations
 * must serialize concurrent operations.
 */
export interface RuleInstallerAdapter {
  current(): Promise<readonly MatcherOperation[]>;
  install(operations: readonly MatcherOperation[]): Promise<InstallResult>;
}

export type InstallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly CoreDiagnostic[] };

export type InstallOutcome =
  | {
      readonly ok: true;
      readonly installed: readonly MatcherOperation[];
      readonly noop: boolean;
    }
  | {
      readonly ok: false;
      readonly recovered: boolean;
      readonly diagnostics: readonly CoreDiagnostic[];
    };

export type RuleStatusKind =
  | "active"
  | "disabled"
  | "needs permission"
  | "needs proxy"
  | "unsupported"
  | "error";

export interface RuleStatus {
  readonly groupId: string;
  readonly ruleId: string;
  readonly status: RuleStatusKind;
  readonly diagnostics?: readonly CoreDiagnostic[];
}

export interface BadgeState {
  readonly text: string;
  readonly attention: boolean;
}

export interface RuleStatusInput {
  readonly operations: readonly MatcherOperation[];
  readonly enabledGroupIds: readonly string[];
  readonly grantedOrigins: readonly string[];
  readonly installedRuleIds: readonly string[];
}

export type CoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: "conflict";
      readonly current: StoredProject;
      readonly diagnostics: readonly CoreDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly kind: "failure";
      readonly diagnostics: readonly CoreDiagnostic[];
    };

export type EnvelopeMigrationResult =
  | { readonly ok: true; readonly envelope: StoredEnvelope }
  | { readonly ok: false; readonly diagnostic: CoreDiagnostic };

export type MockRuntimePhase =
  | "disconnected"
  | "checking"
  | "connected"
  | "failed";

export interface MockRuntimeState {
  readonly phase: MockRuntimePhase;
  readonly lastCheck: {
    readonly at: number;
    readonly ok: boolean;
    readonly message?: string;
  } | null;
}

export type NativeRuntimePhase = "stopped" | "starting" | "started" | "failed";

export interface NativeRuntimeState {
  readonly phase: NativeRuntimePhase;
  readonly lastError?: string;
}

export interface RuntimeStates {
  readonly mock: MockRuntimeState;
  readonly native: NativeRuntimeState;
}

export type RuntimeTransitionResult =
  | { readonly ok: true; readonly value: RuntimeStates }
  | {
      readonly ok: false;
      readonly kind: "failure";
      readonly diagnostics: readonly CoreDiagnostic[];
    };
