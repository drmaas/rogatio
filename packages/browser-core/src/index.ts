export type { CoreDiagnostic, CoreDiagnosticCode } from "./diagnostics.js";
export { coreDiagnostic } from "./diagnostics.js";
export { InstallService } from "./install.js";
export {
  createEmptyEnvelope,
  isAbsoluteMockFileRoot,
  migrateEnvelope,
  normalizeMockFileRoot,
} from "./migrate.js";
export type { RepositoryOptions } from "./repository.js";
export { MAX_PROJECTS, ProjectRepository } from "./repository.js";
export {
  computeBadge,
  computeDesiredRules,
  computeRuleStatuses,
} from "./status.js";
export type {
  BadgeState,
  CoreResult,
  EnvelopeMigrationResult,
  InstallOutcome,
  InstallResult,
  NativeRuntimePhase,
  RuleInstallerAdapter,
  RuleStatus,
  RuleStatusInput,
  RuleStatusKind,
  StorageAdapter,
  StoredEnvelope,
  StoredProject,
} from "./types.js";
export { ENVELOPE_VERSION } from "./types.js";
