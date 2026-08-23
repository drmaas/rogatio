export type { CoreDiagnostic, CoreDiagnosticCode } from "./diagnostics.js";
export { coreDiagnostic } from "./diagnostics.js";
export { InstallService } from "./install.js";
export { createEmptyEnvelope, migrateEnvelope } from "./migrate.js";
export type { RepositoryOptions } from "./repository.js";
export { MAX_PROJECTS, ProjectRepository } from "./repository.js";
export {
  initialRuntimeStates,
  RuntimeStateController,
} from "./runtime.js";
export {
  computeBadge,
  computeDeclaredOrigins,
  computeDesiredRules,
  computeRuleStatuses,
} from "./status.js";
export type {
  BadgeState,
  CoreResult,
  EnvelopeMigrationResult,
  InstallOutcome,
  InstallResult,
  MockRuntimePhase,
  MockRuntimeState,
  NativeRuntimePhase,
  NativeRuntimeState,
  RuleInstallerAdapter,
  RuleStatus,
  RuleStatusInput,
  RuleStatusKind,
  RuntimeStates,
  RuntimeTransitionResult,
  StorageAdapter,
  StoredEnvelope,
  StoredProject,
} from "./types.js";
export { ENVELOPE_VERSION } from "./types.js";
