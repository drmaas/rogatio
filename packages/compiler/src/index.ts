export type {
  HeaderAction,
  HeaderDirection,
  HeaderOperationKind,
  ResponseBodyAction,
  RogatioQueryAction,
} from "@rogatio/schema";
export { compileProject } from "./compile.js";
export { diagnosticMessages } from "./diagnostics.js";
export { validateMatcherShape } from "./matcher.js";
export { isPacSafeSource } from "./pac-safety.js";
export {
  applyQueryTransform,
  type DnrQueryTransform,
  queryActionToDNR,
} from "./query.js";
export {
  type RuleMatchContext,
  selectWinningOperation,
  type WinnerResult,
} from "./selector.js";
export {
  decodePacSteer,
  encodePacSteer,
  literalHostname,
  literalUrl,
  PAC_STEER_MARKER,
  type SteeredOrigin,
  sameOrigin,
  sourceMatches,
  steeredRequestOrigin,
} from "./source-match.js";
export type {
  CompileResult,
  CompilerDiagnostic,
  CompilerDiagnosticCode,
  HeaderOperation,
  MatcherOperation,
  MockOperation,
  NormalizedMatcher,
  QueryOperation,
  RedirectOperation,
  RequestBodyOperation,
  ResponseBodyOperation,
  RogatioOperation,
} from "./types.js";
